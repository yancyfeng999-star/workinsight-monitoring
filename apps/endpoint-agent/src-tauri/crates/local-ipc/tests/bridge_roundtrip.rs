use local_ipc::protocol::{read_frame, write_frame, IpcMessage};

#[test]
fn bridge_roundtrip() {
    let msg = IpcMessage::BrowserActive {
        browser: "chrome".into(),
        tab_id: "tab_42".into(),
        registrable_domain: "example.com".into(),
        title: Some("Example".into()),
    };
    let mut buf = Vec::new();
    write_frame(&mut buf, &msg).unwrap();
    let mut reader: &[u8] = &buf;
    let back = read_frame(&mut reader).unwrap();
    match back {
        IpcMessage::BrowserActive {
            registrable_domain,
            tab_id,
            ..
        } => {
            assert_eq!(registrable_domain, "example.com");
            assert_eq!(tab_id, "tab_42");
        }
        _ => panic!("wrong variant"),
    }
}

#[test]
fn policy_request_roundtrip() {
    let mut buf = Vec::new();
    write_frame(&mut buf, &IpcMessage::GetPolicy).unwrap();
    let mut reader: &[u8] = &buf;
    assert!(matches!(
        read_frame(&mut reader).unwrap(),
        IpcMessage::GetPolicy
    ));
}
