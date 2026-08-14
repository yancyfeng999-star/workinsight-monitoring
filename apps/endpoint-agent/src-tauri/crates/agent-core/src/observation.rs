use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::contract::PresenceState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrowserKind {
    Chrome,
    Edge,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Observation {
    Foreground {
        observed_at: DateTime<Utc>,
        app_id: String,
        app_name: String,
        window_title: Option<String>,
    },
    BrowserActive {
        observed_at: DateTime<Utc>,
        browser: BrowserKind,
        tab_id: String,
        registrable_domain: String,
        title: Option<String>,
    },
    BrowserInactive {
        observed_at: DateTime<Utc>,
        browser: BrowserKind,
        tab_id: String,
    },
    StateChanged {
        observed_at: DateTime<Utc>,
        state: PresenceState,
    },
}

impl Observation {
    pub fn observed_at(&self) -> DateTime<Utc> {
        match self {
            Observation::Foreground { observed_at, .. }
            | Observation::BrowserActive { observed_at, .. }
            | Observation::BrowserInactive { observed_at, .. }
            | Observation::StateChanged { observed_at, .. } => *observed_at,
        }
    }
}
