use std::path::PathBuf;

use agent_core::contract::{AgentInfo, EventPayload, PresenceState};
use agent_core::observation::{BrowserKind, Observation};
use chrono::{Duration, Utc};
use collection_policy::CollectionPolicy;
use device_identity::DeviceIdentity;
use local_store::LocalStore;
use workinsight_agent_lib::engine::AgentEngine;

fn temp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("aw-engine-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn setup(
    name: &str,
) -> (
    PathBuf,
    LocalStore,
    DeviceIdentity,
    AgentInfo,
    CollectionPolicy,
) {
    let dir = temp_dir(name);
    let store = LocalStore::open(dir.join("queue.db").to_str().unwrap()).unwrap();
    let identity = DeviceIdentity::load_or_create(&dir.join("device_id")).unwrap();
    let agent = AgentInfo {
        version: "0.1.0".into(),
        os: "macos".into(),
    };
    let policy = CollectionPolicy::default();
    (dir, store, identity, agent, policy)
}

#[test]
fn engine_does_not_queue_before_enrollment() {
    let (dir, store, _identity, agent, policy) = setup("engine_does_not_queue_before_enrollment");
    let mut engine = AgentEngine::new(store, agent, policy);
    let t0 = Utc::now();
    engine.handle(Observation::Foreground {
        observed_at: t0,
        app_id: "com.apple.Xcode".into(),
        app_name: "Xcode".into(),
        window_title: None,
    });
    engine.handle(Observation::StateChanged {
        observed_at: t0 + Duration::seconds(1),
        state: PresenceState::Locked,
    });
    engine.flush();
    let store = engine.into_store();
    assert_eq!(
        store.count_unacked().unwrap(),
        0,
        "must not queue before enrollment"
    );
    let _ = dir;
}

#[test]
fn sequence_survives_ack_and_restart() {
    let (dir, store, _identity, agent, policy) = setup("sequence_survives_ack_and_restart");
    let mut engine = AgentEngine::new(store, agent, policy);
    let t0 = Utc::now();
    engine.enroll("org_1".into(), "dev_1".into(), "sub_1".into());
    engine.handle(Observation::Foreground {
        observed_at: t0,
        app_id: "com.a".into(),
        app_name: "A".into(),
        window_title: None,
    });
    engine.handle(Observation::Foreground {
        observed_at: t0 + Duration::seconds(1),
        app_id: "com.b".into(),
        app_name: "B".into(),
        window_title: None,
    });
    engine.flush();
    let mut store = engine.into_store();
    let batch = store.pending_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(batch[0].sequence_no, 1);
    store.ack(&[1]).unwrap();
    drop(store);

    let store2 = LocalStore::open(dir.join("queue.db").to_str().unwrap()).unwrap();
    let mut engine2 = AgentEngine::new(
        store2,
        AgentInfo {
            version: "0.1.0".into(),
            os: "macos".into(),
        },
        CollectionPolicy::default(),
    );
    engine2.enroll("org_1".into(), "dev_1".into(), "sub_1".into());
    engine2.handle(Observation::Foreground {
        observed_at: t0 + Duration::seconds(2),
        app_id: "com.c".into(),
        app_name: "C".into(),
        window_title: None,
    });
    engine2.handle(Observation::Foreground {
        observed_at: t0 + Duration::seconds(3),
        app_id: "com.d".into(),
        app_name: "D".into(),
        window_title: None,
    });
    engine2.flush();
    let store2 = engine2.into_store();
    let batch2 = store2.pending_batch(10).unwrap();
    assert_eq!(
        batch2[0].sequence_no, 2,
        "sequence must continue after ack and restart"
    );
    let _ = dir;
}

#[test]
fn app_switch_closes_previous_segment() {
    let (dir, store, _identity, agent, policy) = setup("app_switch_closes_previous_segment");
    let mut engine = AgentEngine::new(store, agent, policy);
    let t0 = Utc::now();
    engine.enroll("org_1".into(), "dev_1".into(), "sub_1".into());
    engine.handle(Observation::Foreground {
        observed_at: t0,
        app_id: "com.a".into(),
        app_name: "A".into(),
        window_title: None,
    });
    engine.handle(Observation::Foreground {
        observed_at: t0 + Duration::seconds(10),
        app_id: "com.b".into(),
        app_name: "B".into(),
        window_title: None,
    });
    engine.flush();
    let store = engine.into_store();
    let batch = store.pending_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    if let EventPayload::FocusSegment { activity } = &batch[0].payload {
        assert_eq!(activity.app_id, "com.a");
        assert_eq!(batch[0].duration_seconds(), 10);
    } else {
        panic!("expected focus segment");
    }
    let _ = dir;
}

#[test]
fn lock_closes_active_segment() {
    let (dir, store, _identity, agent, policy) = setup("lock_closes_active_segment");
    let mut engine = AgentEngine::new(store, agent, policy);
    let t0 = Utc::now();
    engine.enroll("org_1".into(), "dev_1".into(), "sub_1".into());
    engine.handle(Observation::Foreground {
        observed_at: t0,
        app_id: "com.a".into(),
        app_name: "A".into(),
        window_title: None,
    });
    engine.handle(Observation::StateChanged {
        observed_at: t0 + Duration::seconds(20),
        state: PresenceState::Locked,
    });
    engine.flush();
    let store = engine.into_store();
    let batch = store.pending_batch(10).unwrap();
    assert_eq!(batch.len(), 2, "focus segment + state_change event");
    assert_eq!(batch[0].duration_seconds(), 20);
    assert_eq!(
        batch[1].kind(),
        agent_core::contract::EventKind::StateChange
    );
    let _ = dir;
}

#[test]
fn browser_domain_enriches_instead_of_double_counting() {
    let (dir, store, _identity, agent, policy) =
        setup("browser_domain_enriches_instead_of_double_counting");
    let mut engine = AgentEngine::new(store, agent, policy);
    let t0 = Utc::now();
    engine.enroll("org_1".into(), "dev_1".into(), "sub_1".into());
    // Chrome foreground + browser active on example.com
    engine.handle(Observation::Foreground {
        observed_at: t0,
        app_id: "com.google.Chrome".into(),
        app_name: "Google Chrome".into(),
        window_title: None,
    });
    engine.handle(Observation::BrowserActive {
        observed_at: t0 + Duration::seconds(1),
        browser: BrowserKind::Chrome,
        tab_id: "t1".into(),
        registrable_domain: "example.com".into(),
        title: None,
    });
    engine.handle(Observation::BrowserActive {
        observed_at: t0 + Duration::seconds(30),
        browser: BrowserKind::Chrome,
        tab_id: "t1".into(),
        registrable_domain: "example.com".into(),
        title: None,
    });
    engine.flush();
    let store = engine.into_store();
    let batch = store.pending_batch(10).unwrap();
    assert_eq!(batch.len(), 1, "one timeline interval only");
    if let EventPayload::FocusSegment { activity } = &batch[0].payload {
        assert_eq!(activity.registrable_domain.as_deref(), Some("example.com"));
    } else {
        panic!("expected focus segment");
    }
    let _ = dir;
}

#[test]
fn unchanged_activity_checkpoints_without_overlap() {
    let (dir, store, _identity, agent, policy) =
        setup("unchanged_activity_checkpoints_without_overlap");
    let mut engine = AgentEngine::new(store, agent, policy);
    let t0 = Utc::now();
    engine.enroll("org_1".into(), "dev_1".into(), "sub_1".into());
    // 6 minutes of same activity -> should checkpoint into multiple bounded segments
    for i in 0..12u32 {
        let t = t0 + Duration::seconds(30 * i as i64);
        engine.handle(Observation::Foreground {
            observed_at: t,
            app_id: "com.a".into(),
            app_name: "A".into(),
            window_title: None,
        });
    }
    engine.flush();
    let store = engine.into_store();
    let batch = store.pending_batch(10).unwrap();
    assert!(!batch.is_empty(), "checkpoint must emit segments");
    for e in &batch {
        assert!(
            e.duration_seconds() <= 300,
            "no segment may exceed 5 min checkpoint"
        );
    }
    let mut prev_end = None;
    for e in &batch {
        if let Some(p) = prev_end {
            assert!(e.started_at >= p, "segments must not overlap");
        }
        prev_end = Some(e.ended_at);
    }
    let _ = dir;
}

#[test]
fn observation_gap_does_not_invent_duration() {
    let (dir, store, _identity, agent, policy) = setup("observation_gap_does_not_invent_duration");
    let mut engine = AgentEngine::new(store, agent, policy);
    let t0 = Utc::now();
    engine.enroll("org_1".into(), "dev_1".into(), "sub_1".into());
    engine.handle(Observation::Foreground {
        observed_at: t0,
        app_id: "com.a".into(),
        app_name: "A".into(),
        window_title: None,
    });
    engine.handle(Observation::Foreground {
        observed_at: t0 + Duration::seconds(5),
        app_id: "com.a".into(),
        app_name: "A".into(),
        window_title: None,
    });
    // 55s gap: next observation at t0+60 closes segment at last seen (t0+5), no invented duration
    engine.handle(Observation::Foreground {
        observed_at: t0 + Duration::seconds(60),
        app_id: "com.b".into(),
        app_name: "B".into(),
        window_title: None,
    });
    engine.flush();
    let store = engine.into_store();
    let batch = store.pending_batch(10).unwrap();
    assert_eq!(batch.len(), 1);
    assert_eq!(
        batch[0].duration_seconds(),
        5,
        "gap must not be counted as usage"
    );
    let _ = dir;
}
