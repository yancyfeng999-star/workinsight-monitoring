use agent_core::contract::{Activity, AgentInfo, Event, EventPayload, Privacy, Source};
use local_store::LocalStore;
use secret_store::envelope::random_key;

fn sample_event(seq: u64, name: &str) -> Event {
    let now = chrono::Utc::now();
    Event {
        schema_version: 1,
        event_id: agent_core::generate_event_id(),
        org_id: "org_test".into(),
        device_id: "dev_test".into(),
        subject_id: "sub_test".into(),
        sequence_no: seq,
        source: Source::System,
        started_at: now,
        ended_at: now + chrono::Duration::seconds(60),
        timezone: "Asia/Shanghai".into(),
        payload: EventPayload::FocusSegment {
            activity: Activity {
                app_id: name.into(),
                app_name: name.into(),
                window_title: None,
                browser: None,
                registrable_domain: None,
                url_path: None,
            },
        },
        privacy: Privacy::Normal,
        agent: AgentInfo {
            version: "0.1.1".into(),
            os: "macos".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("aw-enc-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn raw_payloads(path: &std::path::Path) -> Vec<String> {
        let conn = rusqlite::Connection::open(path).unwrap();
        let mut stmt = conn
            .prepare("SELECT payload FROM events ORDER BY sequence_no")
            .unwrap();
        let rows = stmt.query_map([], |r| r.get::<_, String>(0)).unwrap();
        rows.map(|r| r.unwrap()).collect()
    }

    #[test]
    fn token_never_in_plaintext_sqlite() {
        let dir = tmp("tok");
        let path = dir.join("q.db");
        let key = random_key();
        let mut store = LocalStore::open_encrypted(path.to_str().unwrap(), &key).unwrap();
        let mut ev = sample_event(1, "X");
        if let EventPayload::FocusSegment { activity } = &mut ev.payload {
            activity.app_name = "device_token_plaintext_marker".into();
        }
        store.push(&ev).unwrap();
        drop(store);

        let stored = raw_payloads(&path);
        assert_eq!(stored.len(), 1);
        assert!(
            !stored[0].contains("device_token_plaintext_marker"),
            "payload must not be stored in plaintext"
        );
        assert!(
            !stored[0].contains("com.apple"),
            "app fields must be encrypted too"
        );
        assert!(
            stored[0].contains('|'),
            "encrypted envelope format expected"
        );

        // reopen with correct key decrypts
        let store2 = LocalStore::open_encrypted(path.to_str().unwrap(), &key).unwrap();
        let batch = store2.pending_batch(10).unwrap();
        assert_eq!(batch.len(), 1);
        if let EventPayload::FocusSegment { activity } = &batch[0].payload {
            assert_eq!(activity.app_name, "device_token_plaintext_marker");
        } else {
            panic!("expected focus segment");
        }
        let _ = dir;
    }

    #[test]
    fn wrong_key_cannot_decrypt() {
        let dir = tmp("key");
        let path = dir.join("q.db");
        let key = random_key();
        let mut store = LocalStore::open_encrypted(path.to_str().unwrap(), &key).unwrap();
        store.push(&sample_event(1, "Secret")).unwrap();
        drop(store);

        let wrong = random_key();
        let store2 = LocalStore::open_encrypted(path.to_str().unwrap(), &wrong).unwrap();
        assert!(
            store2.pending_batch(10).is_err(),
            "wrong key must fail to read payloads"
        );
        let _ = dir;
    }

    #[test]
    fn same_payload_different_nonce_each_time() {
        let dir = tmp("nonce");
        let path = dir.join("q.db");
        let key = random_key();
        let mut store = LocalStore::open_encrypted(path.to_str().unwrap(), &key).unwrap();
        store.push(&sample_event(1, "A")).unwrap();
        store.push(&sample_event(2, "A")).unwrap();
        drop(store);
        let stored = raw_payloads(&path);
        assert_eq!(stored.len(), 2);
        let cipher_a = stored[0].rsplit('|').next().unwrap().to_string();
        let cipher_b = stored[1].rsplit('|').next().unwrap().to_string();
        assert_ne!(cipher_a, cipher_b, "ciphertexts must differ (fresh nonce)");
        let _ = dir;
    }
}
