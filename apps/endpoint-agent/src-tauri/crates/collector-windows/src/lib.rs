#[cfg(target_os = "windows")]
pub mod foreground;
#[cfg(target_os = "windows")]
pub mod hook;
#[cfg(target_os = "windows")]
pub mod idle;
#[cfg(target_os = "windows")]
pub mod session;

#[cfg(not(target_os = "windows"))]
pub mod foreground {
    pub struct ForegroundWindow {
        pub app_id: String,
        pub app_name: String,
        pub window_title: Option<String>,
    }

    pub fn current() -> Option<ForegroundWindow> {
        None
    }
}

#[cfg(not(target_os = "windows"))]
pub mod session {
    use agent_core::observation::Observation;

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
}
