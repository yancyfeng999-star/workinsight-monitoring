use crate::LocalStore;
use agent_core::contract::{Activity, AgentInfo, Event, EventPayload, Privacy, Source};

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
            version: "0.1.0".into(),
            os: "macos".into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_ack_cycle() {
        let dir = std::env::temp_dir().join(format!("aw-store-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("db-wal"));

        let mut store = LocalStore::open(path.to_str().unwrap()).unwrap();
        assert_eq!(store.next_sequence(), 1);
        assert_eq!(store.reserve_sequence().unwrap(), 1);
        assert_eq!(store.reserve_sequence().unwrap(), 2);
        store.push(&sample_event(1, "Finder")).unwrap();
        store.push(&sample_event(2, "Xcode")).unwrap();
        assert_eq!(store.count_unacked().unwrap(), 2);
        let batch = store.pending_batch(10).unwrap();
        assert_eq!(batch.len(), 2);
        store.ack(&[1]).unwrap();
        assert_eq!(store.count_unacked().unwrap(), 1);
        assert_eq!(store.next_sequence(), 3, "high-water mark survives ack");
        assert_eq!(
            store.reserve_sequence().unwrap(),
            3,
            "reserve never reuses acked seq"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn queue_full_errors() {
        let dir = std::env::temp_dir().join(format!("aw-store-full-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        let _ = std::fs::remove_file(&path);

        let mut store = LocalStore::open_with_limit(path.to_str().unwrap(), 2).unwrap();
        store.push(&sample_event(1, "A")).unwrap();
        store.push(&sample_event(2, "B")).unwrap();
        let err = store.push(&sample_event(3, "C"));
        assert!(matches!(err, Err(crate::queue::StoreError::QueueFull)));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn idempotent_push() {
        let dir = std::env::temp_dir().join(format!("aw-store-idem-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.db");
        let _ = std::fs::remove_file(&path);

        let mut store = LocalStore::open(path.to_str().unwrap()).unwrap();
        let e = sample_event(1, "A");
        store.push(&e).unwrap();
        store.push(&e).unwrap();
        assert_eq!(store.count_unacked().unwrap(), 1);

        let _ = std::fs::remove_file(&path);
    }
}
