use objc2::rc::Retained;
use objc2_app_kit::{NSApplicationActivationPolicy, NSRunningApplication, NSWorkspace};
use objc2_foundation::MainThreadMarker;

pub struct FrontmostApp {
    pub app_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
}

pub fn current() -> Option<FrontmostApp> {
    let mtm = MainThreadMarker::new()?;
    let ws = unsafe { NSWorkspace::sharedWorkspace() };
    let app: Option<Retained<NSRunningApplication>> = unsafe { ws.frontmostApplication() };
    let app = app?;
    let app_id = unsafe { app.bundleIdentifier() }
        .map(|s| s.to_string())
        .unwrap_or_default();
    let app_name = unsafe { app.localizedName() }
        .map(|s| s.to_string())
        .unwrap_or_default();
    let pid = unsafe { app.processIdentifier() };
    let window_title = window_title_for_pid(pid, &mtm);
    Some(FrontmostApp {
        app_id,
        app_name,
        window_title,
    })
}

fn window_title_for_pid(_pid: i32, _mtm: &MainThreadMarker) -> Option<String> {
    // Window title requires Accessibility permission. MVP default: disabled.
    // Phase 2 will read AXUIElementCopyAttributeValue when policy allows.
    None
}

pub fn is_running_foreground() -> bool {
    let mtm = MainThreadMarker::new();
    match mtm {
        Some(_mtm) => {
            let ws = unsafe { NSWorkspace::sharedWorkspace() };
            unsafe { ws.frontmostApplication() }
                .map(|app| {
                    let policy: NSApplicationActivationPolicy = unsafe { app.activationPolicy() };
                    policy == NSApplicationActivationPolicy::Regular
                })
                .unwrap_or(false)
        }
        None => false,
    }
}

pub fn os_version() -> String {
    let _mtm = MainThreadMarker::new();
    // Phase 2: read SystemVersion.plist without Full Disk Access.
    String::new()
}
