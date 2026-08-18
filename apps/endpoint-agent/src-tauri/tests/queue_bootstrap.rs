use std::path::{Path, PathBuf};

use agent_core::contract::{Activity, AgentInfo, Event, EventPayload, Privacy, Source};
use secret_store::MemorySecretStore;
use workinsight_agent_lib::enrollment::{save_config, EnrollmentIdentity};
use workinsight_agent_lib::queue_bootstrap::{
    open_product_queue, resolve_queue_key, StartupError, SECRET_KEY_QUEUE,
};

const PLAINTEXT_MARKER: &str = "plaintext_queue_marker_task6";
const SECRET_KEY_LITERAL: &[u8; 32] = b"SECRET_QUEUE_KEY_DO_NOT_LEAK!!!!";

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "aw-qboot-{name}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|t| t.as_nanos())
            .unwrap_or(0)
    ));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn sample_event(seq: u64, marker: &str) -> Event {
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
                app_id: marker.into(),
                app_name: marker.into(),
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

fn sqlite_files(path: &Path) -> Vec<PathBuf> {
    let mut files = vec![path.to_path_buf()];
    if let Some(name) = path.file_name() {
        let name = name.to_string_lossy();
        files.push(path.with_file_name(format!("{name}-wal")));
        files.push(path.with_file_name(format!("{name}-shm")));
    }
    files
}

fn files_contain_marker(path: &Path, marker: &str) -> bool {
    let needle = marker.as_bytes();
    sqlite_files(path).into_iter().any(|p| {
        std::fs::read(p)
            .map(|bytes| bytes.windows(needle.len()).any(|w| w == needle))
            .unwrap_or(false)
    })
}

fn expect_missing_key<T>(result: Result<T, StartupError>) -> StartupError {
    match result {
        Err(err) => err,
        Ok(_) => panic!("expected MissingQueueKey, product queue opened"),
    }
}

#[test]
fn missing_queue_key_fails_closed_without_creating_db() {
    let dir = tmp("missing");
    let path = dir.join("queue.db");
    assert!(!path.exists());

    let err = expect_missing_key(open_product_queue(&path, None));
    assert!(
        matches!(err, StartupError::MissingQueueKey),
        "missing key must be MissingQueueKey, got {err}"
    );
    assert!(
        !path.exists(),
        "missing key must not create the product queue database"
    );

    let err = expect_missing_key(open_product_queue(&path, Some(&[])));
    assert!(matches!(err, StartupError::MissingQueueKey));
    assert!(!path.exists());

    let err = expect_missing_key(open_product_queue(&path, Some(&[0u8; 31])));
    assert!(matches!(err, StartupError::MissingQueueKey));
    assert!(!path.exists());

    let err = expect_missing_key(open_product_queue(&path, Some(&[0u8; 33])));
    assert!(matches!(err, StartupError::MissingQueueKey));
    assert!(!path.exists());

    let display = err.to_string();
    assert!(
        !display.contains("SECRET_QUEUE_KEY"),
        "StartupError Display must not contain secret bytes: {display}"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn invalid_key_display_omits_secret_bytes() {
    let dir = tmp("display");
    let path = dir.join("queue.db");
    let err = expect_missing_key(open_product_queue(&path, Some(&SECRET_KEY_LITERAL[..8])));
    let display = err.to_string();
    let debug = format!("{err:?}");
    assert!(matches!(err, StartupError::MissingQueueKey));
    assert!(
        !display.contains("SECRET_QUEUE_KEY"),
        "Display leaked key material: {display}"
    );
    assert!(
        !debug.contains("SECRET_QUEUE_KEY"),
        "Debug leaked key material: {debug}"
    );
    assert!(!path.exists());
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn thirty_two_byte_key_opens_encrypted_queue() {
    let dir = tmp("enc");
    let path = dir.join("queue.db");
    let key = *SECRET_KEY_LITERAL;

    let mut store = open_product_queue(&path, Some(&key)).expect("32-byte key must open");
    store
        .push(&sample_event(1, PLAINTEXT_MARKER))
        .expect("encrypted push");
    drop(store);

    assert!(path.exists(), "encrypted open may create the database");
    assert!(
        !files_contain_marker(&path, PLAINTEXT_MARKER),
        "event payload must not appear as plaintext in the SQLite file"
    );

    let store = open_product_queue(&path, Some(&key)).expect("reopen encrypted");
    let batch = store.pending_batch(10).expect("decrypt with same key");
    assert_eq!(batch.len(), 1);
    match &batch[0].payload {
        EventPayload::FocusSegment { activity } => {
            assert_eq!(activity.app_name, PLAINTEXT_MARKER);
        }
        other => panic!("expected focus segment, got {other:?}"),
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn enrolled_product_source_has_no_plain_fallback() {
    let lib = include_str!("../src/lib.rs");
    assert!(
        !lib.contains("falling back to plain store"),
        "product collector must not fall back to a plain store"
    );
    assert!(
        !lib.contains("permissions_ok: true"),
        "health must not hard-code permissions_ok"
    );

    let boot = include_str!("../src/queue_bootstrap.rs");
    let stripped = boot.replace("LocalStore::open_encrypted", "");
    assert!(
        !stripped.contains("LocalStore::open(") && !stripped.contains("LocalStore::open_plain"),
        "product queue opener must not call plaintext LocalStore::open"
    );
}

#[test]
fn enrolled_missing_queue_key_fails_closed_without_minting() {
    let dir = tmp("enrolled-missing-key");
    save_config(
        &dir,
        &EnrollmentIdentity {
            org_id: "org_test".into(),
            subject_id: "sub_test".into(),
            device_id: "dev_test".into(),
            api_base_url: "https://monitor.example.com".into(),
            policy_version: 1,
            enrolled_at: "2026-08-10T00:00:00Z".into(),
        },
    )
    .unwrap();
    let enrolled = workinsight_agent_lib::enrollment::load_config(&dir).is_some();
    assert!(enrolled, "fixture must look enrolled");

    let mut store = MemorySecretStore::new();
    assert!(
        resolve_queue_key(&mut store, enrolled).is_none(),
        "enrolled agent with no 32-byte key must not mint"
    );
    assert!(
        store.get(SECRET_KEY_QUEUE).is_err(),
        "fail-closed path must not persist a synthesized key"
    );

    store.put(SECRET_KEY_QUEUE, &[1u8; 8]).unwrap();
    assert!(resolve_queue_key(&mut store, true).is_none());
    assert_eq!(
        store.get(SECRET_KEY_QUEUE).unwrap().len(),
        8,
        "invalid stored key must not be replaced when enrolled"
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn first_run_mints_and_persists_queue_key() {
    let mut store = MemorySecretStore::new();
    let key = resolve_queue_key(&mut store, false).expect("first persist may mint");
    assert_eq!(key.len(), 32);
    assert_eq!(store.get(SECRET_KEY_QUEUE).unwrap(), key);
    assert_eq!(resolve_queue_key(&mut store, true).unwrap(), key);
}
