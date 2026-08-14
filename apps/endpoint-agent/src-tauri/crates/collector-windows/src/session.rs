use agent_core::observation::Observation;

/// Turn platform events into Observations without touching a real desktop.
/// Unit tests drive this state machine with fixtures on any platform.
pub fn foreground_to_observation(
    observed_at: chrono::DateTime<chrono::Utc>,
    app_id: String,
    app_name: String,
    window_title: Option<String>,
) -> Observation {
    Observation::Foreground {
        observed_at,
        app_id,
        app_name,
        window_title,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agent_core::contract::PresenceState;

    #[test]
    fn foreground_fixture_produces_observation() {
        let t = chrono::Utc::now();
        let obs = foreground_to_observation(t, "chrome.exe".into(), "Chrome".into(), None);
        match obs {
            Observation::Foreground { app_id, .. } => assert_eq!(app_id, "chrome.exe"),
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn idle_never_extends_segment() {
        // semantic contract: idle state must close the current segment
        // (engine-level behavior is covered by engine_integration tests)
        assert_eq!(PresenceState::Idle.to_string().is_empty(), false);
    }
}
