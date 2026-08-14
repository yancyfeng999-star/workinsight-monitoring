use agent_core::contract::Event;
use local_store::LocalStore;
use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum UploaderError {
    #[error("store error: {0}")]
    Store(#[from] local_store::StoreError),
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("http status {0}")]
    Status(reqwest::StatusCode),
    #[error("invalid batch ack in 2xx response")]
    InvalidAck,
    #[error("credential error: {0}")]
    Credential(reqwest::StatusCode),
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchAckEntry {
    pub sequence_no: u64,
    pub event_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchAckRejection {
    pub sequence_no: u64,
    pub event_id: String,
    pub code: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BatchAck {
    pub accepted: Vec<BatchAckEntry>,
    pub rejected: Vec<BatchAckRejection>,
    pub server_time: String,
}

pub struct Uploader {
    client: reqwest::Client,
    endpoint: String,
    token: Option<String>,
    batch_size: usize,
}

impl Uploader {
    pub fn new(endpoint: &str, batch_size: usize) -> Self {
        Uploader {
            client: reqwest::Client::new(),
            endpoint: endpoint.to_string(),
            token: None,
            batch_size,
        }
    }

    pub fn with_token(endpoint: &str, token: &str, batch_size: usize) -> Self {
        Uploader {
            client: reqwest::Client::new(),
            endpoint: endpoint.to_string(),
            token: Some(token.to_string()),
            batch_size,
        }
    }

    /// Upload a pending batch and delete ONLY the events the server accepted.
    /// Returns number of accepted events. 2xx without a valid BatchAck is an
    /// error: events are never deleted on "HTTP 200 + no ack".
    pub async fn upload_pending(&self, store: &mut LocalStore) -> Result<usize, UploaderError> {
        let events = store.pending_batch(self.batch_size)?;
        if events.is_empty() {
            return Ok(0);
        }
        self.upload_events(store, &events).await
    }

    pub async fn upload_events(
        &self,
        store: &mut LocalStore,
        events: &[Event],
    ) -> Result<usize, UploaderError> {
        let payload = serde_json::json!({
            "events": events.iter().map(|e| serde_json::to_value(e).unwrap_or_default()).collect::<Vec<_>>(),
        });
        let mut req = self.client.post(&self.endpoint).json(&payload);
        if let Some(t) = &self.token {
            req = req.bearer_auth(t);
        }
        let resp = req.send().await?;
        let status = resp.status();
        if status.is_client_error() {
            if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                return Err(UploaderError::Credential(status));
            }
            return Err(UploaderError::Status(status));
        }
        if !status.is_success() {
            return Err(UploaderError::Status(status));
        }

        let ack: BatchAck = match resp.json().await {
            Ok(a) => a,
            Err(_) => return Err(UploaderError::InvalidAck),
        };

        let mut accepted = 0usize;
        for a in &ack.accepted {
            if store.seq_event_id(a.sequence_no).as_deref() == Some(a.event_id.as_str()) {
                store.ack(&[a.sequence_no])?;
                accepted += 1;
            }
        }
        for r in &ack.rejected {
            if !r.retryable {
                if let Ok(payload) = store.event_payload(r.sequence_no) {
                    let _ = store.quarantine(r.sequence_no, &r.event_id, &payload, &r.code);
                }
            }
            // retryable stays queued for the next attempt with backoff
        }
        Ok(accepted)
    }
}

pub fn encode_batch(events: &[Event]) -> Vec<u8> {
    serde_json::to_vec(&events).unwrap_or_default()
}
