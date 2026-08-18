pub mod commands;
pub mod crash_guard;
pub mod engine;
pub mod enrollment;
pub mod permissions;
pub mod platform;
pub mod queue_bootstrap;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use agent_core::contract::AgentInfo;
use chrono::Utc;
use collection_policy::CollectionPolicy;
use device_identity::DeviceIdentity;
use secret_store::SecretStore;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;
use tracing::{error, info, warn};

const POLL_INTERVAL: Duration = Duration::from_secs(2);
const UPLOAD_INTERVAL: Duration = Duration::from_secs(30);
#[allow(dead_code)]
const POLICY_INTERVAL: Duration = Duration::from_secs(300);
const HEALTH_INTERVAL: Duration = Duration::from_secs(60);
#[allow(dead_code)]
const SECRET_KEY_QUEUE: &str = "queue_encryption_key";
#[allow(dead_code)]
const DEBUG_QUEUE_KEY: [u8; 32] = *b"debug-queue-key-0000000000000000";
const DEFAULT_BATCH_SIZE: usize = 100;

fn app_data_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(home).join("Library/Application Support/com.workinsight.agent")
}

static SHUTDOWN: AtomicBool = AtomicBool::new(false);
static IS_BACKGROUND: AtomicBool = AtomicBool::new(false);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run(background: bool) {
    IS_BACKGROUND.store(background, Ordering::SeqCst);

    let app_data = app_data_dir();
    let _ = std::fs::create_dir_all(&app_data);
    let logs_dir = app_data.join("logs");
    let _ = std::fs::create_dir_all(&logs_dir);
    let file_appender = tracing_appender::rolling::daily(&logs_dir, "agent.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_writer(non_blocking)
        .try_init();

    info!(?background, data_dir = %app_data.display(), "agent starting");
    let app_data_clone = app_data.clone();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::enroll])
        .setup(move |app| {
            let data_dir = app.path().app_data_dir().unwrap_or_default();
            let effective_dir = if data_dir.as_os_str().is_empty() {
                app_data_clone.clone()
            } else {
                std::fs::create_dir_all(&data_dir)?;
                data_dir
            };

            // Use PlatformSecretStore (Keychain/DPAPI) in release builds;
            // MemorySecretStore in debug for thin-slice testing.
            let secret_store: Box<dyn SecretStore + Send> = {
                #[cfg(all(target_os = "macos", not(debug_assertions)))]
                {
                    Box::new(secret_store::PlatformSecretStore::new(
                        "com.workinsight.agent",
                        "secrets",
                    ))
                }
                #[cfg(all(target_os = "windows", not(debug_assertions)))]
                {
                    Box::new(secret_store::PlatformSecretStore)
                }
                #[cfg(debug_assertions)]
                {
                    Box::new(secret_store::MemorySecretStore::new())
                }
                #[cfg(not(any(target_os = "macos", target_os = "windows", debug_assertions)))]
                {
                    Box::new(secret_store::MemorySecretStore::new())
                }
            };

            app.manage(commands::AppState {
                data_dir: effective_dir.clone(),
                secret_store: Mutex::new(secret_store),
            });

            let is_enrolled = enrollment::load_config(&effective_dir).is_some();
            setup_tray(app.handle(), is_enrolled)?;

            // Hide setup window if already enrolled
            if is_enrolled {
                if let Some(win) = app.get_webview_window("setup") {
                    let _ = win.hide();
                }
            }

            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Err(e) = collector_loop(&effective_dir, &handle) {
                    error!("collector loop failed: {e}");
                }
            });
            Ok(())
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button,
                button_state,
                ..
            } = event
            {
                if button == MouseButton::Left && button_state == MouseButtonState::Up {
                    show_agent_window(tray.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                SHUTDOWN.store(true, Ordering::SeqCst);
            }
        });
}

#[derive(Debug, PartialEq, Eq)]
enum TrayMenuAction {
    ShowWindow,
    Quit,
    Ignore,
}

fn tray_menu_action(id: &str) -> TrayMenuAction {
    match id {
        "open" => TrayMenuAction::ShowWindow,
        "quit" => TrayMenuAction::Quit,
        _ => TrayMenuAction::Ignore,
    }
}

fn tray_status_label(is_enrolled: bool) -> &'static str {
    if is_enrolled {
        "状态：后台运行中"
    } else {
        "状态：等待注册"
    }
}

fn tray_tooltip(is_enrolled: bool) -> &'static str {
    if is_enrolled {
        "WorkInsight · 后台运行中"
    } else {
        "WorkInsight · 等待设备注册"
    }
}

fn show_agent_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("setup") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

struct TrayUiState {
    status_item: MenuItem<tauri::Wry>,
}

pub(crate) fn set_tray_enrolled(app: &tauri::AppHandle, is_enrolled: bool) {
    if let Some(state) = app.try_state::<TrayUiState>() {
        let _ = state.status_item.set_text(tray_status_label(is_enrolled));
    }
    if let Some(tray) = app.tray_by_id("workinsight-tray") {
        let _ = tray.set_tooltip(Some(tray_tooltip(is_enrolled)));
    }
}

#[cfg(target_os = "macos")]
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-macos.png");
#[cfg(target_os = "windows")]
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray-windows.png");
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const TRAY_ICON_BYTES: &[u8] = include_bytes!("../icons/tray.png");

fn setup_tray(app: &tauri::AppHandle, is_enrolled: bool) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "打开 WorkInsight", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app, "quit", "退出 WorkInsight", true, None::<&str>)?;
    let status_i = MenuItem::with_id(
        app,
        "status",
        tray_status_label(is_enrolled),
        false,
        None::<&str>,
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &open_i,
            &status_i,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::about(
                app,
                Some("关于 WorkInsight"),
                Some(AboutMetadata::default()),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &quit_i,
        ],
    )?;

    let builder = TrayIconBuilder::with_id("workinsight-tray")
        .menu(&menu)
        .tooltip(tray_tooltip(is_enrolled))
        .show_menu_on_left_click(false)
        .on_menu_event(
            move |app, event| match tray_menu_action(event.id().as_ref()) {
                TrayMenuAction::ShowWindow => show_agent_window(app),
                TrayMenuAction::Quit => {
                    SHUTDOWN.store(true, Ordering::SeqCst);
                    app.exit(0);
                }
                TrayMenuAction::Ignore => {}
            },
        );

    let builder = if let Ok(icon) = tauri::image::Image::from_bytes(TRAY_ICON_BYTES) {
        builder.icon(icon)
    } else {
        builder
    };

    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);

    builder.build(app)?;
    app.manage(TrayUiState {
        status_item: status_i,
    });
    Ok(())
}

/// Resolve the queue encryption key: read from SecretStore, or generate and
/// persist a new 32-byte key. Returns None only if SecretStore is completely
/// unavailable (should not happen in release builds).
#[allow(dead_code)]
fn resolve_queue_key(secrets: &mut dyn SecretStore) -> Option<[u8; 32]> {
    if let Ok(bytes) = secrets.get(SECRET_KEY_QUEUE) {
        if bytes.len() == 32 {
            let mut key = [0u8; 32];
            key.copy_from_slice(&bytes);
            return Some(key);
        }
    }
    // Generate new key and persist
    let key = secret_store::random_key();
    let _ = secrets.put(SECRET_KEY_QUEUE, &key);
    Some(key)
}

/// Read the device token from SecretStore for authenticated API calls.
#[allow(dead_code)]
fn read_device_token(secrets: &dyn SecretStore) -> Option<String> {
    match secrets.get(enrollment::SECRET_KEY_ACCOUNT) {
        Ok(bytes) => String::from_utf8(bytes).ok(),
        Err(_) => None,
    }
}

fn collector_loop(
    data_dir: &std::path::Path,
    app: &tauri::AppHandle,
) -> Result<(), Box<dyn std::error::Error>> {
    // crash guard: fuse after repeated unhealthy starts within 10 minutes
    let crash_guard = crash_guard::CrashGuard::new(data_dir.join("crash-starts.txt"));
    let fused = crash_guard.record_unhealthy_start();
    if fused {
        warn!("crash fuse engaged: repeated unhealthy starts; safe mode (no collection/upload)");
        return Ok(());
    }
    info!("crash guard armed");

    // Load enrollment identity from config (release builds require this;
    // debug builds fall back to synthetic identity).
    let config = enrollment::load_config(data_dir);

    // Resolve queue encryption key from SecretStore
    let queue_key = {
        // Access the AppState's secret_store through Tauri's managed state.
        // Since we're on a background thread, we read the key via the commands
        // module helper or directly from the platform store.
        // For the background loop, we open the platform store directly.
        #[cfg(all(target_os = "macos", not(debug_assertions)))]
        {
            let mut store =
                secret_store::PlatformSecretStore::new("com.workinsight.agent", "secrets");
            resolve_queue_key(&mut store)
        }
        #[cfg(all(target_os = "windows", not(debug_assertions)))]
        {
            let mut store = secret_store::PlatformSecretStore;
            resolve_queue_key(&mut store)
        }
        #[cfg(debug_assertions)]
        {
            // Debug: use a deterministic 32-byte key for testing
            Some(DEBUG_QUEUE_KEY)
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", debug_assertions)))]
        {
            Some(DEBUG_QUEUE_KEY)
        }
    };

    let store = crate::queue_bootstrap::open_product_queue(
        &data_dir.join("queue.db"),
        queue_key.as_ref().map(|key| key.as_slice()),
    )?;
    info!("opening encrypted queue");

    let policy = CollectionPolicy::default();
    let window_title_enabled = policy.title_enabled;
    let agent = AgentInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        os: std::env::consts::OS.to_string(),
    };
    let mut engine = engine::AgentEngine::new(store, agent, policy);

    // Enroll engine with real or synthetic identity
    match &config {
        Some(ident) => {
            info!(
                org = %ident.org_id,
                device = %ident.device_id,
                subject = %ident.subject_id,
                "loading enrollment identity from config"
            );
            engine.enroll(
                ident.org_id.clone(),
                ident.device_id.clone(),
                ident.subject_id.clone(),
            );
        }
        None => {
            #[cfg(debug_assertions)]
            {
                let ident = DeviceIdentity::load_or_create(&data_dir.join("device_id"))?;
                info!(device = %ident.device_id, "using debug synthetic identity");
                engine.enroll(
                    "org_debug".into(),
                    ident.device_id.clone(),
                    "subject_debug".into(),
                );
            }
            #[cfg(not(debug_assertions))]
            {
                error!(
                    "no enrollment config found; agent cannot collect data. Run enrollment first."
                );
                return Ok(());
            }
        }
    }

    // Initialize Uploader with token from SecretStore
    let uploader: Option<uploader::Uploader> = if let Some(ref ident) = config {
        let token: Option<String> = {
            #[cfg(all(target_os = "macos", not(debug_assertions)))]
            {
                let store =
                    secret_store::PlatformSecretStore::new("com.workinsight.agent", "secrets");
                read_device_token(&store)
            }
            #[cfg(all(target_os = "windows", not(debug_assertions)))]
            {
                let store = secret_store::PlatformSecretStore;
                read_device_token(&store)
            }
            #[cfg(debug_assertions)]
            {
                // In debug, try to read from the app state's memory store
                // For the background thread, we'll skip upload if no token
                None
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", debug_assertions)))]
            {
                None
            }
        };
        match token {
            Some(t) => {
                let upload_url = format!("{}/v1/events", ident.api_base_url);
                info!(url = %upload_url, "uploader initialized");
                Some(uploader::Uploader::with_token(
                    &upload_url,
                    &t,
                    DEFAULT_BATCH_SIZE,
                ))
            }
            None => {
                warn!("no device token in SecretStore; upload disabled until enrollment");
                None
            }
        }
    } else {
        None
    };

    let mut last_flush = std::time::Instant::now();
    let mut last_upload = std::time::Instant::now();
    let _last_policy = std::time::Instant::now();
    let mut last_health = std::time::Instant::now();
    let mut last_upload_at: Option<chrono::DateTime<Utc>> = None;
    let mut last_obs: Option<chrono::DateTime<Utc>> = None;
    let mut healthy_since = std::time::Instant::now();

    // same-user IPC: native messaging host forwards browser observations here
    let (ipc_tx, ipc_rx) = std::sync::mpsc::channel::<agent_core::observation::Observation>();
    let ipc_path = data_dir.join("agent-bridge.sock");
    let _ = std::fs::remove_file(&ipc_path);
    let ipc_path_clone = ipc_path.clone();
    let ipc_thread = std::thread::spawn(move || {
        ipc_server(&ipc_path_clone, ipc_tx);
    });

    // Async runtime for uploads and health reports
    let rt = tokio::runtime::Runtime::new()?;

    while !SHUTDOWN.load(Ordering::SeqCst) {
        let (tx, rx) = std::sync::mpsc::channel();
        let handle = app.clone();
        let _ = handle.run_on_main_thread(move || {
            let fg = current_foreground();
            let _ = tx.send(fg);
        });
        if let Ok(fg) = rx.recv_timeout(Duration::from_secs(2)) {
            let now = Utc::now();
            if let Some(fg) = fg {
                engine.handle(agent_core::observation::Observation::Foreground {
                    observed_at: now,
                    app_id: fg.app_id,
                    app_name: fg.app_name,
                    window_title: fg.window_title,
                });
                last_obs = Some(now);
            } else if let Some(prev) = last_obs {
                if now - prev > chrono::Duration::seconds(15) {
                    engine.flush();
                    last_obs = None;
                }
            }
        }
        while let Ok(obs) = ipc_rx.try_recv() {
            engine.handle(obs);
        }

        // Flush events to local queue
        if last_flush.elapsed() >= POLL_INTERVAL * 15 {
            engine.flush();
            last_flush = std::time::Instant::now();
        }

        // Upload pending events
        if last_upload.elapsed() >= UPLOAD_INTERVAL {
            if let Some(ref up) = uploader {
                let store_ref = engine.store_mut();
                match rt.block_on(up.upload_pending(store_ref)) {
                    Ok(0) => {}
                    Ok(n) => {
                        info!(accepted = n, "events uploaded");
                        last_upload_at = Some(Utc::now());
                    }
                    Err(uploader::UploaderError::Credential(status)) => {
                        error!(status = %status, "credential error; stopping upload");
                        // Don't storm on 401/403
                        std::thread::sleep(Duration::from_secs(300));
                    }
                    Err(e) => {
                        warn!(error = %e, "upload failed; will retry");
                    }
                }
            }
            last_upload = std::time::Instant::now();
        }

        // Report health
        if last_health.elapsed() >= HEALTH_INTERVAL {
            report_health(
                data_dir,
                last_upload_at,
                &rt,
                queue_key.as_ref().map(|key| key.as_slice()),
                window_title_enabled,
            );
            last_health = std::time::Instant::now();
        }

        // clear crash history after 5 minutes of healthy running
        if healthy_since.elapsed() >= Duration::from_secs(300) {
            crash_guard.clear();
            healthy_since = std::time::Instant::now();
        }
        std::thread::sleep(POLL_INTERVAL);
    }
    engine.flush();
    let _ = std::fs::remove_file(&ipc_path);
    let _ = ipc_thread.join();
    info!("collector loop stopped");
    Ok(())
}

fn report_health(
    data_dir: &std::path::Path,
    last_upload_at: Option<chrono::DateTime<Utc>>,
    rt: &tokio::runtime::Runtime,
    queue_key: Option<&[u8]>,
    window_title_enabled: bool,
) {
    let Some(config) = crate::enrollment::load_config(data_dir) else {
        return;
    };
    let store =
        match crate::queue_bootstrap::open_product_queue(&data_dir.join("queue.db"), queue_key) {
            Ok(s) => s,
            Err(e) => {
                error!("health report: queue open failed: {e}");
                return;
            }
        };

    // Real autostart status detection
    #[cfg(target_os = "macos")]
    let autostart_status = autostart_supervisor::status_platform("com.workinsight.agent.plist");
    #[cfg(not(target_os = "macos"))]
    let autostart_status = autostart_supervisor::AutostartStatus::Unknown;

    let autostart_enabled = matches!(
        autostart_status,
        autostart_supervisor::AutostartStatus::Enabled
    );

    let sample = health::sample(
        &config.device_id,
        &AgentInfo {
            version: env!("CARGO_PKG_VERSION").to_string(),
            os: std::env::consts::OS.to_string(),
        },
        &store,
        &health::HealthContext {
            permissions_ok: crate::permissions::collection_permissions_ok(window_title_enabled),
            autostart_enabled,
            last_upload_at,
            policy_version: Some(config.policy_version),
            ..Default::default()
        },
    );

    // Read token from platform SecretStore
    let token: Option<String> = {
        #[cfg(all(target_os = "macos", not(debug_assertions)))]
        {
            let store = secret_store::PlatformSecretStore::new("com.workinsight.agent", "secrets");
            read_device_token(&store)
        }
        #[cfg(all(target_os = "windows", not(debug_assertions)))]
        {
            let store = secret_store::PlatformSecretStore;
            read_device_token(&store)
        }
        #[cfg(debug_assertions)]
        {
            None
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows", debug_assertions)))]
        {
            None
        }
    };

    let Some(token) = token else {
        warn!("health report: no device token in secret store");
        return;
    };
    let url = format!("{}/v1/health-samples", config.api_base_url);
    let client = reqwest::Client::new();
    let resp = rt.block_on(async {
        client
            .post(url)
            .bearer_auth(token)
            .json(&serde_json::json!({ "health": [sample] }))
            .send()
            .await
    });
    match resp {
        Ok(r) if r.status().is_success() => {}
        Ok(r) => warn!("health report rejected: {}", r.status()),
        Err(e) => error!("health report failed: {e}"),
    }
}

fn ipc_server(
    path: &std::path::Path,
    tx: std::sync::mpsc::Sender<agent_core::observation::Observation>,
) {
    use std::os::unix::net::UnixListener;
    let listener = match UnixListener::bind(path) {
        Ok(l) => l,
        Err(e) => {
            error!("ipc bind failed: {e}");
            return;
        }
    };
    let _ = std::fs::set_permissions(path, std::os::unix::fs::PermissionsExt::from_mode(0o600));
    for stream in listener.incoming() {
        if SHUTDOWN.load(Ordering::SeqCst) {
            break;
        }
        let Ok(mut stream) = stream else {
            continue;
        };
        loop {
            match local_ipc::protocol::read_frame(&mut stream) {
                Ok(local_ipc::protocol::IpcMessage::BrowserActive {
                    browser,
                    tab_id,
                    registrable_domain,
                    title,
                }) => {
                    let browser_kind = if browser == "edge" {
                        agent_core::observation::BrowserKind::Edge
                    } else {
                        agent_core::observation::BrowserKind::Chrome
                    };
                    let _ = tx.send(agent_core::observation::Observation::BrowserActive {
                        observed_at: Utc::now(),
                        browser: browser_kind,
                        tab_id,
                        registrable_domain,
                        title,
                    });
                    let _ = local_ipc::protocol::write_frame(
                        &mut stream,
                        &local_ipc::protocol::IpcMessage::Ok,
                    );
                }
                Ok(local_ipc::protocol::IpcMessage::BrowserInactive { browser, tab_id }) => {
                    let browser_kind = if browser == "edge" {
                        agent_core::observation::BrowserKind::Edge
                    } else {
                        agent_core::observation::BrowserKind::Chrome
                    };
                    let _ = tx.send(agent_core::observation::Observation::BrowserInactive {
                        observed_at: Utc::now(),
                        browser: browser_kind,
                        tab_id,
                    });
                    let _ = local_ipc::protocol::write_frame(
                        &mut stream,
                        &local_ipc::protocol::IpcMessage::Ok,
                    );
                }
                Ok(local_ipc::protocol::IpcMessage::GetPolicy) => {
                    let _ = local_ipc::protocol::write_frame(
                        &mut stream,
                        &local_ipc::protocol::IpcMessage::PolicySnapshot {
                            window_title_enabled: false,
                            blocked_domains: vec![],
                        },
                    );
                }
                Ok(_) | Err(_) => break,
            }
        }
    }
}

fn current_foreground() -> Option<ForegroundApp> {
    #[cfg(target_os = "macos")]
    {
        collector_macos::frontmost::current().map(|a| ForegroundApp {
            app_id: a.app_id,
            app_name: a.app_name,
            window_title: a.window_title,
        })
    }
    #[cfg(target_os = "windows")]
    {
        collector_windows::foreground::current().map(|a| ForegroundApp {
            app_id: a.app_id,
            app_name: a.app_name,
            window_title: a.window_title,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        None
    }
}

struct ForegroundApp {
    app_id: String,
    app_name: String,
    window_title: Option<String>,
}

#[cfg(test)]
mod tray_tests {
    use super::{tray_menu_action, tray_status_label, TrayMenuAction};

    #[test]
    fn open_menu_item_shows_the_agent_window() {
        assert_eq!(tray_menu_action("open"), TrayMenuAction::ShowWindow);
    }

    #[test]
    fn quit_menu_item_exits_the_agent() {
        assert_eq!(tray_menu_action("quit"), TrayMenuAction::Quit);
    }

    #[test]
    fn status_item_is_informational_only() {
        assert_eq!(tray_menu_action("status"), TrayMenuAction::Ignore);
        assert_eq!(tray_menu_action("unexpected"), TrayMenuAction::Ignore);
    }

    #[test]
    fn tray_status_distinguishes_enrollment_state() {
        assert_eq!(tray_status_label(false), "状态：等待注册");
        assert_eq!(tray_status_label(true), "状态：后台运行中");
    }
}
