use std::path::PathBuf;
use std::sync::Mutex;

use secret_store::SecretStore;
use tauri::{AppHandle, Manager, State};
use tracing::error;

use crate::enrollment::{save_config, EnrollmentIdentity};

pub struct AppState {
    pub data_dir: PathBuf,
    pub secret_store: Mutex<Box<dyn SecretStore + Send>>,
}

#[tauri::command]
pub async fn enroll(
    app: AppHandle,
    state: State<'_, AppState>,
    api_url: String,
    code: String,
    label: String,
) -> Result<serde_json::Value, String> {
    if !api_url.starts_with("https://") {
        let debug_ok = api_url == "http://127.0.0.1" || api_url == "http://localhost";
        if !(debug_ok && cfg!(debug_assertions)) {
            return Err("only HTTPS endpoints are allowed in this build".into());
        }
    }
    if code.trim().is_empty() {
        return Err("enrollment code is required".into());
    }
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/v1/enroll", api_url.trim_end_matches('/')))
        .json(&serde_json::json!({
            "enrollment_code": code,
            "agent_version": env!("CARGO_PKG_VERSION"),
            "os": std::env::consts::OS,
            "device_label": label,
        }))
        .send()
        .await
        .map_err(|e| format!("enrollment request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("enrollment rejected ({status}): {body}"));
    }
    let payload: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let org_id = payload["org_id"]
        .as_str()
        .ok_or("missing org_id")?
        .to_string();
    let subject_id = payload["subject_id"]
        .as_str()
        .ok_or("missing subject_id")?
        .to_string();
    let device_id = payload["device_id"]
        .as_str()
        .ok_or("missing device_id")?
        .to_string();
    let device_token = payload["device_token"]
        .as_str()
        .ok_or("missing device_token")?
        .to_string();
    let policy_version = payload["policy_version"].as_u64().unwrap_or(1) as u32;

    // token goes to the secret store (Keychain/DPAPI), never into config.json
    let mut secrets = state
        .secret_store
        .lock()
        .map_err(|_| "secret store lock failed".to_string())?;
    secrets
        .put("device_token", device_token.as_bytes())
        .map_err(|e| format!("secret store unavailable: {e}"))?;

    let identity = EnrollmentIdentity {
        org_id,
        subject_id,
        device_id,
        api_base_url: api_url.trim_end_matches('/').to_string(),
        policy_version,
        enrolled_at: chrono::Utc::now().to_rfc3339(),
    };
    save_config(&state.data_dir, &identity)?;
    crate::set_tray_enrolled(&app, true);

    // register autostart after successful enrollment
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = autostart_supervisor::register_platform("com.workinsight.agent.plist") {
            error!("autostart registration failed: {e}");
        }
    }
    #[cfg(target_os = "windows")]
    {
        let exe = std::env::current_exe().unwrap_or_default();
        if let Err(e) = autostart_supervisor::register_platform(exe.to_str().unwrap_or(""), 10) {
            error!("autostart registration failed: {e}");
        }
    }

    // Keep the setup window available from the tray without leaving it visible.
    if let Some(win) = app.get_webview_window("setup") {
        let _ = win.hide();
    }

    Ok(serde_json::json!({ "ok": true, "org_id": identity.org_id }))
}
