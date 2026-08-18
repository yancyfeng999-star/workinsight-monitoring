/// Report whether the current policy and OS permission state allow collection.
///
/// macOS: window-title collection off is allowed; when on, Accessibility is
/// queried without prompting. Windows: metadata-only collection is allowed.
/// Other targets fail closed.
pub fn collection_permissions_ok(window_title_enabled: bool) -> bool {
    map_collection_permissions(window_title_enabled, accessibility_trusted_no_prompt)
}

fn map_collection_permissions(
    window_title_enabled: bool,
    accessibility_trusted: impl FnOnce() -> bool,
) -> bool {
    #[cfg(target_os = "macos")]
    {
        if !window_title_enabled {
            true
        } else {
            accessibility_trusted()
        }
    }
    #[cfg(target_os = "windows")]
    {
        let _ = (window_title_enabled, accessibility_trusted);
        true
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window_title_enabled, accessibility_trusted);
        false
    }
}

fn accessibility_trusted_no_prompt() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos_ax::is_process_trusted_no_prompt()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[cfg(target_os = "macos")]
mod macos_ax {
    use std::ffi::c_void;

    type CFTypeRef = *const c_void;
    type CFStringRef = CFTypeRef;
    type CFBooleanRef = CFTypeRef;
    type CFDictionaryRef = CFTypeRef;
    type CFIndex = isize;

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanFalse: CFBooleanRef;
        fn CFDictionaryCreate(
            allocator: CFTypeRef,
            keys: *const CFTypeRef,
            values: *const CFTypeRef,
            num_values: CFIndex,
            key_call_backs: CFTypeRef,
            value_call_backs: CFTypeRef,
        ) -> CFDictionaryRef;
        fn CFRelease(cf: CFTypeRef);
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
    }

    pub fn is_process_trusted_no_prompt() -> bool {
        // Safety: static CF constants stay valid; null callbacks treat keys as
        // pointers and do not retain. The returned dictionary is released.
        unsafe {
            let keys = [kAXTrustedCheckOptionPrompt];
            let values = [kCFBooleanFalse];
            let options = CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                std::ptr::null(),
                std::ptr::null(),
            );
            if options.is_null() {
                return false;
            }
            let trusted = AXIsProcessTrustedWithOptions(options);
            CFRelease(options);
            trusted != 0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::map_collection_permissions;

    #[test]
    fn title_disabled_mapping() {
        let ok = map_collection_permissions(false, || {
            panic!("Accessibility must not be queried when titles are disabled")
        });
        #[cfg(target_os = "macos")]
        assert!(ok);
        #[cfg(target_os = "windows")]
        assert!(ok);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        assert!(!ok);
    }

    #[test]
    fn title_enabled_mapping_follows_platform_policy() {
        #[cfg(target_os = "macos")]
        {
            assert!(map_collection_permissions(true, || true));
            assert!(!map_collection_permissions(true, || false));
        }
        #[cfg(target_os = "windows")]
        {
            assert!(map_collection_permissions(true, || false));
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            assert!(!map_collection_permissions(true, || true));
        }
    }

    #[test]
    fn product_entry_uses_current_policy() {
        let disabled = super::collection_permissions_ok(false);
        #[cfg(target_os = "macos")]
        assert!(disabled);
        #[cfg(target_os = "windows")]
        assert!(disabled);
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        assert!(!disabled);
    }
}
