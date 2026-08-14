use std::sync::mpsc::Sender;
use std::sync::Mutex;

use agent_core::observation::Observation;
use windows::Win32::Foundation::{HWND, MSG, WPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, SetWinEventHook, UnhookWinEvent, EVENT_SYSTEM_FOREGROUND, WINEVENT_OUTOFCONTEXT,
};

use super::foreground::window_info_from_hwnd;

static FOREGROUND_CHANNEL: Mutex<Option<Sender<Observation>>> = Mutex::new(None);

/// Register the foreground hook channel. Must be called before spawn().
pub fn set_channel(tx: Sender<Observation>) {
    if let Ok(mut guard) = FOREGROUND_CHANNEL.lock() {
        *guard = Some(tx);
    }
}

/// Event-driven foreground collector using SetWinEventHook + message loop.
/// Only callable on Windows; compiled out elsewhere.
#[cfg(target_os = "windows")]
pub fn spawn_hook() -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        // SAFETY: out-of-context hook; the callback forwards via the global
        // channel and never touches UI state.
        let hook = unsafe {
            SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(callback),
                0,
                0,
                WINEVENT_OUTOFCONTEXT,
            )
        };
        let Ok(hook) = hook else {
            return;
        };
        // Message loop is required for hook callbacks to fire.
        loop {
            let mut msg = MSG::default();
            let ok = unsafe { GetMessageW(&mut msg, None, 0, 0) };
            match ok {
                Ok(_) if msg.message == 0 => break,
                Ok(_) => {}
                Err(_) => break,
            }
        }
        unsafe {
            let _ = UnhookWinEvent(hook);
        }
    })
}

/// Hook callback: forward the foreground window as an Observation. The event
/// system callback signature is fixed by Win32; arguments we don't use are
/// still present in the ABI and must not be renamed.
#[cfg(target_os = "windows")]
unsafe extern "system" fn callback(
    _hwin: HWND,
    _event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    let Some(fg) = window_info_from_hwnd(hwnd) else {
        return;
    };
    let guard = match FOREGROUND_CHANNEL.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Some(tx) = guard.as_ref() {
        let _ = tx.send(Observation::Foreground {
            observed_at: chrono::Utc::now(),
            app_id: fg.app_id,
            app_name: fg.app_name,
            window_title: fg.window_title,
        });
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hook_module_compiles() {
        // Contract: SetWinEventHook based collector exists on Windows.
        // Compilation of the full hook path is verified on Windows runners.
    }
}
