// State machine tests for Windows collection: fixture-driven, no real desktop.
use collector_windows::session::foreground_to_observation;

#[test]
fn foreground_fixture_maps_to_observation() {
    let t = chrono::Utc::now();
    let obs = foreground_to_observation(
        t,
        "C:\\Program Files\\App\\app.exe".into(),
        "App".into(),
        Some("Doc - App".into()),
    );
    match obs {
        agent_core::observation::Observation::Foreground {
            app_id,
            window_title,
            ..
        } => {
            assert!(app_id.contains("app.exe"));
            assert_eq!(window_title.as_deref(), Some("Doc - App"));
        }
        _ => panic!("expected foreground observation"),
    }
}

#[test]
fn app_id_uses_stable_path_not_pid() {
    // The contract: app_id must be a stable executable path, never pid:{pid}
    // (pid changes across launches and would fragment segments).
    let src =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/foreground.rs")).unwrap();
    assert!(
        src.contains("QueryFullProcessImageNameW"),
        "app_id must derive from the executable path"
    );
    assert!(
        !src.contains("format!(\"pid:{pid}\")"),
        "pid-based identity is forbidden"
    );
}
