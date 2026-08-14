use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::GetWindowThreadProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, IsWindowVisible,
};

pub struct ForegroundWindow {
    pub app_id: String,
    pub app_name: String,
    pub window_title: Option<String>,
}

pub fn current() -> Option<ForegroundWindow> {
    let hwnd = unsafe { GetForegroundWindow() };
    window_info_from_hwnd(hwnd)
}

pub fn window_info_from_hwnd(hwnd: HWND) -> Option<ForegroundWindow> {
    if hwnd.is_invalid() || unsafe { IsWindowVisible(hwnd) }.is_err() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    let title = window_title(hwnd);
    let app_name = exe_name_for_pid(pid).unwrap_or_else(|| "unknown".into());
    let app_id = exe_path_for_pid(pid)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".into());
    Some(ForegroundWindow {
        app_id,
        app_name,
        window_title: title,
    })
}

fn window_title(hwnd: HWND) -> Option<String> {
    let mut buf = vec![0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    if n == 0 {
        return None;
    }
    Some(String::from_utf16_lossy(&buf[..n as usize]))
}

fn exe_path_for_pid(pid: u32) -> Option<std::path::PathBuf> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) }.ok()?;
    let mut buf = vec![0u16; 4096];
    let mut size = buf.len() as u32;
    let ok = unsafe { QueryFullProcessImageNameW(handle, 0, &mut buf, &mut size) };
    unsafe {
        let _ = CloseHandle(handle);
    };
    if ok.is_err() || size == 0 {
        return None;
    }
    Some(std::path::PathBuf::from(String::from_utf16_lossy(
        &buf[..size as usize],
    )))
}

fn exe_name_for_pid(pid: u32) -> Option<String> {
    exe_path_for_pid(pid).and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()))
}
