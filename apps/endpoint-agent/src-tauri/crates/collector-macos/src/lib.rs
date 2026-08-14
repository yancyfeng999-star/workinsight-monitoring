#[cfg(target_os = "macos")]
pub mod frontmost;

#[cfg(not(target_os = "macos"))]
pub mod frontmost {
    pub struct FrontmostApp {
        pub app_id: String,
        pub app_name: String,
        pub window_title: Option<String>,
    }

    pub fn current() -> Option<FrontmostApp> {
        None
    }
}
