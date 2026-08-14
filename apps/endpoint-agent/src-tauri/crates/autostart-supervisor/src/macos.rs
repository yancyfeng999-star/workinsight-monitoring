use crate::AutostartStatus;
use objc2_foundation::NSString;
use objc2_service_management::{SMAppService, SMAppServiceStatus};

/// Register the LaunchAgent bundled inside the app bundle via
/// SMAppService.agent(plistName:). The plist must exist at
/// Contents/Library/LaunchAgents/<plist_name> inside the app bundle.
pub fn register(plist_name: &str) -> Result<(), String> {
    let name = NSString::from_str(plist_name);
    let service = unsafe { SMAppService::agentServiceWithPlistName(&name) };
    unsafe { service.registerAndReturnError() }.map_err(|e| e.to_string())
}

pub fn unregister(plist_name: &str) -> Result<(), String> {
    let name = NSString::from_str(plist_name);
    let service = unsafe { SMAppService::agentServiceWithPlistName(&name) };
    unsafe { service.unregisterAndReturnError() }.map_err(|e| e.to_string())
}

pub fn status(plist_name: &str) -> AutostartStatus {
    let name = NSString::from_str(plist_name);
    let service = unsafe { SMAppService::agentServiceWithPlistName(&name) };
    match unsafe { service.status() } {
        SMAppServiceStatus::Enabled => AutostartStatus::Enabled,
        SMAppServiceStatus::RequiresApproval => AutostartStatus::RequiresApproval,
        SMAppServiceStatus::NotRegistered | SMAppServiceStatus::NotFound => {
            AutostartStatus::Disabled
        }
        _ => AutostartStatus::Unknown,
    }
}
