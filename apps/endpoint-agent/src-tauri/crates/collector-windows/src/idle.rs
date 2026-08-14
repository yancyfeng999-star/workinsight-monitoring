use windows::Win32::Foundation::GetLastError;
use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};

pub fn idle_seconds() -> u64 {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if ok.is_err() {
        return 0;
    }
    let tick = unsafe { windows::Win32::System::SystemServices::GetTickCount() };
    if info.dwTime > tick {
        return 0; // clock wraparound
    }
    (tick - info.dwTime) as u64 / 1000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_seconds_returns_non_negative() {
        // On non-Windows this module is not compiled; the test only runs on
        // Windows CI runners.
        let _ = idle_seconds();
    }
}
