use serde::{Deserialize, Serialize};

pub const SECRET_KEY_ACCOUNT: &str = "device_token";
pub const CONFIG_KEY: &str = "enrollment";
pub const QUEUE_KEY_SERVICE: &str = "com.workinsight.agent";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct EnrollmentIdentity {
    pub org_id: String,
    pub subject_id: String,
    pub device_id: String,
    pub api_base_url: String,
    pub policy_version: u32,
    pub enrolled_at: String,
}

pub fn config_path(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join("config.json")
}

pub fn load_config(data_dir: &std::path::Path) -> Option<EnrollmentIdentity> {
    let raw = std::fs::read_to_string(config_path(data_dir)).ok()?;
    serde_json::from_str(&raw).ok()
}

pub fn save_config(
    data_dir: &std::path::Path,
    identity: &EnrollmentIdentity,
) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(identity).map_err(|e| e.to_string())?;
    std::fs::write(config_path(data_dir), raw).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_roundtrip_without_token() {
        let dir = std::env::temp_dir().join(format!("aw-enr-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let id = EnrollmentIdentity {
            org_id: "org_1".into(),
            subject_id: "sub_1".into(),
            device_id: "dev_1".into(),
            api_base_url: "https://monitor.example.com".into(),
            policy_version: 1,
            enrolled_at: "2026-08-10T00:00:00Z".into(),
        };
        save_config(&dir, &id).unwrap();
        let loaded = load_config(&dir).unwrap();
        assert_eq!(loaded, id);
        let raw = std::fs::read_to_string(config_path(&dir)).unwrap();
        assert!(
            !raw.contains("token"),
            "config must never contain the device token"
        );
        let _ = dir;
    }
}
