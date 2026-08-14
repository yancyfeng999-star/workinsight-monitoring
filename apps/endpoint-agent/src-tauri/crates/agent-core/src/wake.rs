use chrono::{DateTime, Utc};

#[derive(Default)]
pub struct WakeTracker {
    last_seen: Option<DateTime<Utc>>,
    pub wake_detected: bool,
}

impl WakeTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, now: DateTime<Utc>) -> bool {
        let gap = match self.last_seen {
            Some(prev) => (now - prev).num_seconds(),
            None => 0,
        };
        self.last_seen = Some(now);
        self.wake_detected = gap > 60;
        self.wake_detected
    }
}
