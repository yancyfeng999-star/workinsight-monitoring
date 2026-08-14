use chrono::{DateTime, Utc};
use serde::{de::Error as DeError, Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

pub const SYS_HEADER: &str = "com.workinsight.agent";
pub const MAX_TITLE_CHARS: usize = 256;
pub const MAX_DOMAIN_CHARS: usize = 253;
pub const MAX_SEGMENT_SECONDS: i64 = 4 * 3600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    System,
    Browser,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    FocusSegment,
    StateChange,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceState {
    Active,
    Idle,
    Locked,
    Unlocked,
    Sleeping,
    Awake,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Privacy {
    Normal,
    Private,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Activity {
    pub app_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
    pub browser: Option<String>,
    pub registrable_domain: Option<String>,
    pub url_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateChange {
    pub presence: PresenceState,
    pub started_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EventPayload {
    FocusSegment { activity: Activity },
    StateChange { state: StateChange },
}

impl EventPayload {
    pub fn kind(&self) -> EventKind {
        match self {
            EventPayload::FocusSegment { .. } => EventKind::FocusSegment,
            EventPayload::StateChange { .. } => EventKind::StateChange,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentInfo {
    pub version: String,
    pub os: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub schema_version: u32,
    pub event_id: String,
    pub org_id: String,
    pub device_id: String,
    pub subject_id: String,
    pub sequence_no: u64,
    pub source: Source,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub timezone: String,
    pub payload: EventPayload,
    pub privacy: Privacy,
    pub agent: AgentInfo,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum WireEvent {
    Focus(EventFocusWire),
    State(EventStateWire),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventFocusWire {
    pub schema_version: u32,
    pub event_id: String,
    pub org_id: String,
    pub device_id: String,
    pub subject_id: String,
    pub sequence_no: u64,
    pub source: Source,
    pub kind: EventKind,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub timezone: String,
    pub activity: Activity,
    pub privacy: Privacy,
    pub agent: AgentInfo,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventStateWire {
    pub schema_version: u32,
    pub event_id: String,
    pub org_id: String,
    pub device_id: String,
    pub subject_id: String,
    pub sequence_no: u64,
    pub source: Source,
    pub kind: EventKind,
    pub started_at: DateTime<Utc>,
    pub ended_at: DateTime<Utc>,
    pub timezone: String,
    pub state: StateChange,
    pub privacy: Privacy,
    pub agent: AgentInfo,
}

impl Event {
    pub fn kind(&self) -> EventKind {
        self.payload.kind()
    }

    pub fn duration_seconds(&self) -> i64 {
        (self.ended_at - self.started_at).num_seconds()
    }
}

impl Serialize for Event {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match &self.payload {
            EventPayload::FocusSegment { activity } => EventFocusWire {
                schema_version: self.schema_version,
                event_id: self.event_id.clone(),
                org_id: self.org_id.clone(),
                device_id: self.device_id.clone(),
                subject_id: self.subject_id.clone(),
                sequence_no: self.sequence_no,
                source: self.source,
                kind: EventKind::FocusSegment,
                started_at: self.started_at,
                ended_at: self.ended_at,
                timezone: self.timezone.clone(),
                activity: activity.clone(),
                privacy: self.privacy,
                agent: self.agent.clone(),
            }
            .serialize(serializer),
            EventPayload::StateChange { state } => EventStateWire {
                schema_version: self.schema_version,
                event_id: self.event_id.clone(),
                org_id: self.org_id.clone(),
                device_id: self.device_id.clone(),
                subject_id: self.subject_id.clone(),
                sequence_no: self.sequence_no,
                source: self.source,
                kind: EventKind::StateChange,
                started_at: self.started_at,
                ended_at: self.ended_at,
                timezone: self.timezone.clone(),
                state: state.clone(),
                privacy: self.privacy,
                agent: self.agent.clone(),
            }
            .serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for Event {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = WireEvent::deserialize(deserializer)?;
        match wire {
            WireEvent::Focus(w) => {
                if w.kind != EventKind::FocusSegment {
                    return Err(DeError::custom(
                        "kind mismatch: activity without focus_segment",
                    ));
                }
                Ok(Event {
                    schema_version: w.schema_version,
                    event_id: w.event_id,
                    org_id: w.org_id,
                    device_id: w.device_id,
                    subject_id: w.subject_id,
                    sequence_no: w.sequence_no,
                    source: w.source,
                    started_at: w.started_at,
                    ended_at: w.ended_at,
                    timezone: w.timezone,
                    payload: EventPayload::FocusSegment {
                        activity: w.activity,
                    },
                    privacy: w.privacy,
                    agent: w.agent,
                })
            }
            WireEvent::State(w) => {
                if w.kind != EventKind::StateChange {
                    return Err(DeError::custom("kind mismatch: state without state_change"));
                }
                Ok(Event {
                    schema_version: w.schema_version,
                    event_id: w.event_id,
                    org_id: w.org_id,
                    device_id: w.device_id,
                    subject_id: w.subject_id,
                    sequence_no: w.sequence_no,
                    source: w.source,
                    started_at: w.started_at,
                    ended_at: w.ended_at,
                    timezone: w.timezone,
                    payload: EventPayload::StateChange { state: w.state },
                    privacy: w.privacy,
                    agent: w.agent,
                })
            }
        }
    }
}

pub fn generate_event_id() -> String {
    format!("evt_{}", Uuid::now_v7())
}

fn domain_allows(d: &str) -> bool {
    if d.is_empty() || d.len() > MAX_DOMAIN_CHARS {
        return false;
    }
    if d.contains("://") || d.contains('/') || d.contains('?') || d.contains('#') || d.contains(':')
    {
        return false;
    }
    if d == "localhost" {
        return false;
    }
    let parts: Vec<&str> = d.split('.').collect();
    if parts.iter().any(|p| p.is_empty()) {
        return false;
    }
    if parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit())) {
        return false;
    }
    true
}

#[doc(hidden)]
pub fn domain_allows_for_test(d: &str) -> bool {
    domain_allows(d)
}

pub fn validate_event(e: &Event) -> Result<(), String> {
    if e.schema_version != 1 {
        return Err(format!("unsupported schema_version {}", e.schema_version));
    }
    for (name, v) in [
        ("event_id", &e.event_id),
        ("org_id", &e.org_id),
        ("device_id", &e.device_id),
        ("subject_id", &e.subject_id),
    ] {
        if v.is_empty() {
            return Err(format!("{name} must not be empty"));
        }
    }
    if e.sequence_no < 1 {
        return Err("sequence_no must be >= 1".into());
    }
    if e.ended_at <= e.started_at {
        return Err("ended_at must be after started_at".into());
    }
    if e.duration_seconds() > MAX_SEGMENT_SECONDS {
        return Err(format!("segment exceeds {}s", MAX_SEGMENT_SECONDS));
    }
    if e.privacy == Privacy::Private {
        return Err("private_mode events must never be queued".into());
    }
    match &e.payload {
        EventPayload::FocusSegment { activity } => {
            if activity.app_id.is_empty() || activity.app_name.is_empty() {
                return Err("app_id and app_name must not be empty".into());
            }
            if let Some(t) = &activity.window_title {
                if t.chars().count() > MAX_TITLE_CHARS {
                    return Err("window_title exceeds 256 chars".into());
                }
            }
            if let Some(d) = &activity.registrable_domain {
                if !domain_allows(d) {
                    return Err("registrable_domain is not a valid domain".into());
                }
            }
            if activity.url_path.is_some() {
                return Err("url_path must be null (path collection not enabled)".into());
            }
        }
        EventPayload::StateChange { .. } => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Event {
        Event {
            schema_version: 1,
            event_id: generate_event_id(),
            org_id: "org_test".into(),
            device_id: "dev_1".into(),
            subject_id: "sub_1".into(),
            sequence_no: 1,
            source: Source::System,
            started_at: Utc::now(),
            ended_at: Utc::now() + chrono::Duration::seconds(60),
            timezone: "Asia/Shanghai".into(),
            payload: EventPayload::FocusSegment {
                activity: Activity {
                    app_id: "com.apple.finder".into(),
                    app_name: "Finder".into(),
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

    #[test]
    fn valid_event_passes() {
        assert!(validate_event(&base()).is_ok());
    }

    #[test]
    fn private_mode_rejected() {
        let mut e = base();
        e.privacy = Privacy::Private;
        assert!(validate_event(&e).is_err());
    }

    #[test]
    fn url_path_rejected_by_default() {
        let mut e = base();
        if let EventPayload::FocusSegment { activity } = &mut e.payload {
            activity.url_path = Some("/foo".into());
        }
        assert!(validate_event(&e).is_err());
    }

    #[test]
    fn title_too_long_rejected() {
        let mut e = base();
        if let EventPayload::FocusSegment { activity } = &mut e.payload {
            activity.window_title = Some("x".repeat(MAX_TITLE_CHARS + 1));
        }
        assert!(validate_event(&e).is_err());
    }

    #[test]
    fn duration_must_be_positive() {
        let mut e = base();
        e.ended_at = e.started_at;
        assert!(validate_event(&e).is_err());
    }

    #[test]
    fn empty_device_id_rejected() {
        let mut e = base();
        e.device_id = String::new();
        assert!(validate_event(&e).is_err());
    }

    #[test]
    fn full_url_domain_rejected() {
        let mut e = base();
        if let EventPayload::FocusSegment { activity } = &mut e.payload {
            activity.registrable_domain = Some("https://example.com/private?q=x".into());
        }
        assert!(validate_event(&e).is_err());
    }

    #[test]
    fn ip_domain_rejected() {
        let mut e = base();
        if let EventPayload::FocusSegment { activity } = &mut e.payload {
            activity.registrable_domain = Some("192.168.0.1".into());
        }
        assert!(validate_event(&e).is_err());
    }

    #[test]
    fn localhost_domain_rejected() {
        let mut e = base();
        if let EventPayload::FocusSegment { activity } = &mut e.payload {
            activity.registrable_domain = Some("localhost".into());
        }
        assert!(validate_event(&e).is_err());
    }

    #[test]
    fn valid_co_uk_domain_accepted() {
        let mut e = base();
        if let EventPayload::FocusSegment { activity } = &mut e.payload {
            activity.registrable_domain = Some("example.co.uk".into());
        }
        assert!(validate_event(&e).is_ok());
    }

    #[test]
    fn serde_roundtrip_uses_kind_field() {
        let e = base();
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["kind"], "focus_segment");
        assert!(json.get("activity").is_some());
        let back: Event = serde_json::from_value(json).unwrap();
        assert_eq!(back.kind(), EventKind::FocusSegment);
    }

    #[test]
    fn unknown_top_level_field_rejected() {
        let e = base();
        let mut json = serde_json::to_value(&e).unwrap();
        json["prompt"] = serde_json::json!("secret");
        assert!(serde_json::from_value::<Event>(json).is_err());
    }

    #[test]
    fn unknown_nested_activity_field_rejected() {
        let e = base();
        let mut json = serde_json::to_value(&e).unwrap();
        json["activity"]["prompt"] = serde_json::json!("secret");
        assert!(serde_json::from_value::<Event>(json).is_err());
    }
}
