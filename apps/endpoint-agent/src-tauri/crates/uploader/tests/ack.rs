use std::io::{Read, Write};
use std::net::TcpListener;

use agent_core::contract::{Activity, AgentInfo, Event, EventPayload, Privacy, Source};
use local_store::LocalStore;
use uploader::Uploader;

fn sample_event(seq: u64) -> Event {
    let now = chrono::Utc::now();
    Event {
        schema_version: 1,
        event_id: format!("evt_{seq}"),
        org_id: "org_1".into(),
        device_id: "dev_1".into(),
        subject_id: "sub_1".into(),
        sequence_no: seq,
        source: Source::System,
        started_at: now,
        ended_at: now + chrono::Duration::seconds(60),
        timezone: "UTC".into(),
        payload: EventPayload::FocusSegment {
            activity: Activity {
                app_id: "com.a".into(),
                app_name: "A".into(),
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

fn tmp_store(name: &str) -> LocalStore {
    let dir = std::env::temp_dir().join(format!("aw-ack-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let p = dir.join("q.db");
    let _ = std::fs::remove_file(&p);
    LocalStore::open_plain(p.to_str().unwrap()).unwrap()
}

fn start_mock_server() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    (listener, format!("http://{addr}/v1/activity-batches"))
}

fn read_http_body(stream: &mut std::net::TcpStream) -> String {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 8192];
    loop {
        let n = stream.read(&mut tmp).unwrap();
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if buf.windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8_lossy(&buf).to_string()
}

#[test]
fn partial_ack_deletes_only_accepted() {
    let mut store = tmp_store("partial");
    store.push(&sample_event(1)).unwrap();
    store.push(&sample_event(2)).unwrap();
    store.push(&sample_event(3)).unwrap();

    let (listener, url) = start_mock_server();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_http_body(&mut stream);
        let body = r#"{"accepted":[{"sequence_no":1,"event_id":"evt_1"}],
                        "rejected":[{"sequence_no":2,"event_id":"evt_2","code":"invalid_schema","retryable":false},
                                    {"sequence_no":3,"event_id":"evt_3","code":"invalid_schema","retryable":false}],
                        "server_time":"2026-08-10T00:00:00Z"}"#;
        let resp = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(resp.as_bytes()).unwrap();
    });

    let uploader = Uploader::new(&url, 10);
    let rt = tokio::runtime::Runtime::new().unwrap();
    let uploaded = rt.block_on(uploader.upload_pending(&mut store)).unwrap();
    assert_eq!(uploaded, 1, "only accepted event is acked");
    server.join().unwrap();

    let remaining = store.pending_batch(10).unwrap();
    assert_eq!(
        remaining.len(),
        0,
        "non-retryable rejected events move to quarantine"
    );
    let quarantine = store.quarantine_count().unwrap();
    assert_eq!(
        quarantine, 2,
        "both non-retryable rejections go to quarantine"
    );
}

#[test]
fn server_error_keeps_everything() {
    let mut store = tmp_store("servererr");
    store.push(&sample_event(1)).unwrap();
    store.push(&sample_event(2)).unwrap();

    let (listener, url) = start_mock_server();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_http_body(&mut stream);
        let resp =
            "HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
        stream.write_all(resp.as_bytes()).unwrap();
    });

    let uploader = Uploader::new(&url, 10);
    let rt = tokio::runtime::Runtime::new().unwrap();
    let r = rt.block_on(uploader.upload_pending(&mut store));
    assert!(r.is_err(), "5xx must be an error");
    server.join().unwrap();
    assert_eq!(store.count_unacked().unwrap(), 2, "5xx keeps all events");
}

#[test]
fn http_200_without_ack_keeps_events() {
    let mut store = tmp_store("noack");
    store.push(&sample_event(1)).unwrap();

    let (listener, url) = start_mock_server();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_http_body(&mut stream);
        let resp = "HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
        stream.write_all(resp.as_bytes()).unwrap();
    });

    let uploader = Uploader::new(&url, 10);
    let rt = tokio::runtime::Runtime::new().unwrap();
    let r = rt.block_on(uploader.upload_pending(&mut store));
    assert!(r.is_err(), "200 without valid BatchAck must not delete");
    server.join().unwrap();
    assert_eq!(store.count_unacked().unwrap(), 1, "no ack => no delete");
}

#[test]
fn retryable_rejection_stays_queued() {
    let mut store = tmp_store("retry");
    store.push(&sample_event(1)).unwrap();

    let (listener, url) = start_mock_server();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_http_body(&mut stream);
        let body = r#"{"accepted":[],
                        "rejected":[{"sequence_no":1,"event_id":"evt_1","code":"invalid_schema","retryable":true}],
                        "server_time":"2026-08-10T00:00:00Z"}"#;
        let resp = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        stream.write_all(resp.as_bytes()).unwrap();
    });

    let uploader = Uploader::new(&url, 10);
    let rt = tokio::runtime::Runtime::new().unwrap();
    let uploaded = rt.block_on(uploader.upload_pending(&mut store)).unwrap();
    assert_eq!(uploaded, 0);
    server.join().unwrap();
    assert_eq!(store.count_unacked().unwrap(), 1, "retryable stays queued");
    assert_eq!(
        store.quarantine_count().unwrap(),
        0,
        "retryable is not quarantined"
    );
}

#[test]
fn unauthorized_stops_upload_chain() {
    let mut store = tmp_store("unauth");
    store.push(&sample_event(1)).unwrap();
    let (listener, url) = start_mock_server();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let _ = read_http_body(&mut stream);
        let resp = "HTTP/1.1 401 Unauthorized\r\ncontent-length: 0\r\nconnection: close\r\n\r\n";
        stream.write_all(resp.as_bytes()).unwrap();
    });
    let uploader = Uploader::new(&url, 10);
    let rt = tokio::runtime::Runtime::new().unwrap();
    let r = rt.block_on(uploader.upload_pending(&mut store));
    assert!(r.is_err());
    server.join().unwrap();
    assert_eq!(
        store.count_unacked().unwrap(),
        1,
        "401 keeps events (credential error)"
    );
}
