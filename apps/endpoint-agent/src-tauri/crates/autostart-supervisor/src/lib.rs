#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "macos")]
pub use macos::{
    register as register_platform, status as status_platform, unregister as unregister_platform,
};

#[cfg(target_os = "windows")]
pub use windows::{
    register as register_platform, status as status_platform, unregister as unregister_platform,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutostartStatus {
    Enabled,
    Disabled,
    RequiresApproval,
    Unknown,
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub mod unsupported {
    use crate::AutostartStatus;
    pub fn register_platform(_a: &str, _b: u32) -> Result<(), String> {
        Err("unsupported platform".into())
    }
    pub fn unregister_platform() -> Result<(), String> {
        Err("unsupported platform".into())
    }
    pub fn status_platform() -> AutostartStatus {
        AutostartStatus::Unknown
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub use unsupported::{register_platform, status_platform, unregister_platform};
