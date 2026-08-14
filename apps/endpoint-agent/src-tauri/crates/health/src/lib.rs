use agent_core::contract::AgentInfo;
use chrono::{DateTime, Utc};
use local_store::queue::LocalStore;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct HealthSample {
    pub device_id: String,
    pub agent_version: String,
    pub os: String,
    pub collected_at: DateTime<Utc>,
    pub queue_depth: usize,
    pub quarantine_count: usize,
    pub oldest_queued_at: Option<String>,
    pub last_upload_at: Option<String>,
    pub permissions_ok: bool,
    pub autostart_enabled: bool,
    pub policy_version: Option<u32>,
    pub policy_fetched_at: Option<String>,
    pub policy_error: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct HealthContext {
    pub permissions_ok: bool,
    pub autostart_enabled: bool,
    pub last_upload_at: Option<DateTime<Utc>>,
    pub policy_version: Option<u32>,
    pub policy_fetched_at: Option<DateTime<Utc>>,
    pub policy_error: Option<String>,
}

pub fn sample(
    device_id: &str,
    agent: &AgentInfo,
    store: &LocalStore,
    ctx: &HealthContext,
) -> HealthSample {
    HealthSample {
        device_id: device_id.into(),
        agent_version: agent.version.clone(),
        os: agent.os.clone(),
        collected_at: Utc::now(),
        queue_depth: store.count_unacked().unwrap_or(0),
        quarantine_count: store.quarantine_count().unwrap_or(0),
        oldest_queued_at: store.oldest_queued_at().unwrap_or(None),
        last_upload_at: ctx.last_upload_at.map(|t| t.to_rfc3339()),
        permissions_ok: ctx.permissions_ok,
        autostart_enabled: ctx.autostart_enabled,
        policy_version: ctx.policy_version,
        policy_fetched_at: ctx.policy_fetched_at.map(|t| t.to_rfc3339()),
        policy_error: ctx.policy_error.clone(),
    }
}
