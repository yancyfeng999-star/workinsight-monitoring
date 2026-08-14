use chrono::{DateTime, Utc};

pub struct Clock {
    pub tz_name: String,
}

impl Clock {
    pub fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }

    pub fn from_local_tz(name: &str) -> Self {
        Clock {
            tz_name: name.to_string(),
        }
    }
}

impl Default for Clock {
    fn default() -> Self {
        Clock::from_local_tz(&iana_timezone_name())
    }
}

fn iana_timezone_name() -> String {
    // macOS/Windows fallback: use local timezone from env TZ if set,
    // otherwise "UTC". Phase 2 will wire proper IANA resolution.
    std::env::var("TZ")
        .unwrap_or_else(|_| "UTC".into())
        .trim()
        .to_string()
}
