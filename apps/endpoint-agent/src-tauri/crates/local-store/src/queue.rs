use agent_core::contract::Event;
use rusqlite::{params, Connection};
use secret_store::envelope::{decrypt_payload, encrypt_payload, Envelope};
use thiserror::Error;

pub const DEFAULT_MAX_EVENTS: usize = 100_000;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("queue full")]
    QueueFull,
    #[error("encryption error: {0}")]
    Crypto(#[from] secret_store::EncryptionError),
    #[error("queue key missing: open with a 32-byte key or use open_plain for tests")]
    MissingKey,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Encrypted,
    Plain,
}

pub struct LocalStore {
    conn: Connection,
    max_events: usize,
    key: Option<[u8; 32]>,
    mode: Mode,
}

impl LocalStore {
    pub fn open_plain(path: &str) -> Result<Self, StoreError> {
        Self::open_with_limit_and_key(path, DEFAULT_MAX_EVENTS, None, Mode::Plain)
    }

    pub fn open_encrypted(path: &str, key: &[u8]) -> Result<Self, StoreError> {
        if key.len() != 32 {
            return Err(StoreError::MissingKey);
        }
        let mut k = [0u8; 32];
        k.copy_from_slice(key);
        Self::open_with_limit_and_key(path, DEFAULT_MAX_EVENTS, Some(k), Mode::Encrypted)
    }

    pub fn open(path: &str) -> Result<Self, StoreError> {
        // backward-compatible entry: plain mode, used by existing tests and
        // thin-slice tooling; the product path uses open_encrypted.
        Self::open_plain(path)
    }

    pub fn open_with_limit(path: &str, max_events: usize) -> Result<Self, StoreError> {
        Self::open_with_limit_and_key(path, max_events, None, Mode::Plain)
    }

    fn open_with_limit_and_key(
        path: &str,
        max_events: usize,
        key: Option<[u8; 32]>,
        mode: Mode,
    ) -> Result<Self, StoreError> {
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS events (
                sequence_no INTEGER PRIMARY KEY,
                event_id TEXT NOT NULL UNIQUE,
                payload TEXT NOT NULL,
                queued_at TEXT NOT NULL,
                acked INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS quarantine (
                sequence_no INTEGER PRIMARY KEY,
                event_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                reason TEXT NOT NULL,
                quarantined_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_acked ON events(acked, sequence_no);",
        )?;
        Ok(LocalStore {
            conn,
            max_events,
            key,
            mode,
        })
    }

    pub fn push(&mut self, event: &Event) -> Result<(), StoreError> {
        if self.count_unacked()? >= self.max_events {
            return Err(StoreError::QueueFull);
        }
        let payload = serde_json::to_string(event)?;
        let stored = match self.mode {
            Mode::Plain => payload,
            Mode::Encrypted => {
                let k = self.key.as_ref().ok_or(StoreError::MissingKey)?;
                let env = encrypt_payload(payload.as_bytes(), k)?;
                format!("{}|{}", env.nonce_b64, env.ciphertext_b64)
            }
        };
        let queued_at = event.started_at.to_rfc3339();
        self.conn.execute(
            "INSERT OR IGNORE INTO events (sequence_no, event_id, payload, queued_at) VALUES (?1, ?2, ?3, ?4)",
            params![event.sequence_no as i64, event.event_id, stored, queued_at],
        )?;
        Ok(())
    }

    pub fn reserve_sequence(&mut self) -> Result<u64, StoreError> {
        let tx = self.conn.transaction()?;
        // ensure watermark row exists
        tx.execute(
            "INSERT OR IGNORE INTO metadata (key, value) VALUES ('next_sequence', 0)",
            [],
        )?;
        let current: i64 = tx.query_row(
            "SELECT value FROM metadata WHERE key = 'next_sequence'",
            [],
            |r| r.get(0),
        )?;
        let next = current + 1;
        tx.execute(
            "UPDATE metadata SET value = ?1 WHERE key = 'next_sequence'",
            params![next],
        )?;
        tx.commit()?;
        Ok(next as u64)
    }

    pub fn next_sequence(&self) -> u64 {
        self.conn
            .query_row(
                "SELECT COALESCE(MAX(value), 0) + 1 FROM metadata WHERE key = 'next_sequence'",
                [],
                |r| r.get::<_, i64>(0),
            )
            .unwrap_or(1) as u64
    }

    pub fn pending_batch(&self, limit: usize) -> Result<Vec<Event>, StoreError> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload FROM events WHERE acked = 0 ORDER BY sequence_no LIMIT ?1")?;
        let rows = stmt.query_map([limit as i64], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows {
            let stored = row?;
            let payload = match self.mode {
                Mode::Plain => stored,
                Mode::Encrypted => {
                    let k = self.key.as_ref().ok_or(StoreError::MissingKey)?;
                    let (nonce_b64, ciphertext_b64) = stored
                        .split_once('|')
                        .ok_or_else(|| StoreError::Crypto(secret_store::EncryptionError::Base64))?;
                    let env = Envelope {
                        nonce_b64: nonce_b64.to_string(),
                        ciphertext_b64: ciphertext_b64.to_string(),
                    };
                    String::from_utf8(decrypt_payload(&env, k)?).map_err(|_| {
                        StoreError::Json(serde_json::Error::io(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            "non-utf8 payload",
                        )))
                    })?
                }
            };
            out.push(serde_json::from_str(&payload)?);
        }
        Ok(out)
    }

    pub fn ack(&mut self, sequence_nos: &[u64]) -> Result<(), StoreError> {
        for seq in sequence_nos {
            self.conn.execute(
                "DELETE FROM events WHERE sequence_no = ?1",
                params![*seq as i64],
            )?;
        }
        Ok(())
    }

    pub fn quarantine(
        &mut self,
        sequence_no: u64,
        event_id: &str,
        payload: &str,
        reason: &str,
    ) -> Result<(), StoreError> {
        self.conn.execute(
            "INSERT OR IGNORE INTO quarantine (sequence_no, event_id, payload, reason, quarantined_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                sequence_no as i64,
                event_id,
                payload,
                reason,
                chrono::Utc::now().to_rfc3339()
            ],
        )?;
        self.conn.execute(
            "DELETE FROM events WHERE sequence_no = ?1",
            params![sequence_no as i64],
        )?;
        Ok(())
    }

    pub fn quarantine_count(&self) -> Result<usize, StoreError> {
        let n: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM quarantine", [], |r| r.get(0))?;
        Ok(n as usize)
    }

    pub fn count_unacked(&self) -> Result<usize, StoreError> {
        let n: i64 =
            self.conn
                .query_row("SELECT COUNT(*) FROM events WHERE acked = 0", [], |r| {
                    r.get(0)
                })?;
        Ok(n as usize)
    }

    pub fn event_payload(&self, sequence_no: u64) -> Result<String, StoreError> {
        self.conn
            .query_row(
                "SELECT payload FROM events WHERE sequence_no = ?1",
                params![sequence_no as i64],
                |r| r.get::<_, String>(0),
            )
            .map_err(Into::into)
    }

    pub fn seq_event_id(&self, sequence_no: u64) -> Option<String> {
        self.conn
            .query_row(
                "SELECT event_id FROM events WHERE sequence_no = ?1",
                params![sequence_no as i64],
                |r| r.get::<_, String>(0),
            )
            .ok()
    }

    pub fn oldest_queued_at(&self) -> Result<Option<String>, StoreError> {
        self.conn
            .query_row(
                "SELECT MIN(queued_at) FROM events WHERE acked = 0",
                [],
                |r| r.get(0),
            )
            .map_err(Into::into)
    }
}
