use std::fs;
use std::path::PathBuf;

use agent_core::contract::{validate_event, Event, Privacy};

fn fixtures_dir() -> PathBuf {
    let mut d = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // agent-core -> src-tauri -> endpoint-agent -> apps -> repo root
    for _ in 0..5 {
        d.pop();
    }
    d.push("packages/contracts/fixtures");
    d
}

fn load_fixture(name: &str) -> serde_json::Value {
    let path = fixtures_dir().join(name);
    let raw = fs::read_to_string(&path).expect("fixture file missing");
    serde_json::from_str(&raw).expect("fixture is not valid JSON")
}

#[test]
fn shared_valid_fixtures_parse_and_pass() {
    for name in [
        "valid-system-segment.json",
        "valid-browser-segment.json",
        "valid-state-change.json",
    ] {
        let v = load_fixture(name);
        let e: Event = serde_json::from_value(v.clone())
            .unwrap_or_else(|err| panic!("{name} must deserialize: {err}"));
        validate_event(&e).unwrap_or_else(|err| panic!("{name} must validate: {err}"));
        assert_eq!(e.privacy, Privacy::Normal);
    }
}

#[test]
fn shared_invalid_fixtures_rejected() {
    let nested = load_fixture("invalid-nested-prompt.json");
    assert!(
        serde_json::from_value::<Event>(nested).is_err(),
        "invalid-nested-prompt must be rejected"
    );
    let url = load_fixture("invalid-full-url-as-domain.json");
    if let Ok(e) = serde_json::from_value::<Event>(url) {
        assert!(
            validate_event(&e).is_err(),
            "invalid-full-url-as-domain must fail validation"
        );
    }
    let priv_evt = load_fixture("invalid-private-event.json");
    if let Ok(e) = serde_json::from_value::<Event>(priv_evt) {
        assert!(
            validate_event(&e).is_err(),
            "invalid-private-event must fail validation"
        );
    }
}

#[test]
fn domain_fixture_forms_covered() {
    for bad in [
        "https://example.com/private?q=x",
        "example.com:8080",
        "192.168.0.1",
        "localhost",
        "foo..bar.com",
    ] {
        assert!(
            !agent_core::contract::domain_allows_for_test(bad),
            "{bad} must be rejected"
        );
    }
    for good in [
        "example.com",
        "example.co.uk",
        "a.example.co.uk",
        "bank.example.com",
    ] {
        assert!(
            agent_core::contract::domain_allows_for_test(good),
            "{good} must be accepted"
        );
    }
}
