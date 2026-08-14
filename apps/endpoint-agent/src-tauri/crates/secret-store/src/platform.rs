use crate::memory::{SecretError, SecretStore};

#[cfg(target_os = "macos")]
pub type PlatformSecretStore = MacKeychainStore;

#[cfg(target_os = "windows")]
pub type PlatformSecretStore = WindowsDpapiStore;

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub type PlatformSecretStore = UnsupportedStore;

pub struct UnsupportedStore;

impl SecretStore for UnsupportedStore {
    fn put(&mut self, _key: &str, _value: &[u8]) -> Result<(), SecretError> {
        Err(SecretError::Platform("unsupported platform".into()))
    }
    fn get(&self, _key: &str) -> Result<Vec<u8>, SecretError> {
        Err(SecretError::Platform("unsupported platform".into()))
    }
    fn delete(&mut self, _key: &str) -> Result<(), SecretError> {
        Err(SecretError::Platform("unsupported platform".into()))
    }
}

#[cfg(target_os = "macos")]
pub struct MacKeychainStore {
    service: String,
    account: String,
}

#[cfg(target_os = "macos")]
impl MacKeychainStore {
    pub fn new(service: &str, account: &str) -> Self {
        MacKeychainStore {
            service: service.into(),
            account: account.into(),
        }
    }
}

#[cfg(target_os = "macos")]
impl SecretStore for MacKeychainStore {
    fn put(&mut self, key: &str, value: &[u8]) -> Result<(), SecretError> {
        use security_framework::os::macos::keychain::SecKeychain;
        let keychain = SecKeychain::default().map_err(|e| SecretError::Platform(e.to_string()))?;
        let account = format!("{}/{}", self.account, key);
        keychain
            .set_generic_password(&self.service, &account, value)
            .map_err(|e| SecretError::Platform(e.to_string()))
    }

    fn get(&self, key: &str) -> Result<Vec<u8>, SecretError> {
        use security_framework::os::macos::keychain::SecKeychain;
        use security_framework::os::macos::passwords::find_generic_password;
        let keychain = SecKeychain::default().map_err(|e| SecretError::Platform(e.to_string()))?;
        let account = format!("{}/{}", self.account, key);
        let (password, _item) = find_generic_password(Some(&[keychain]), &self.service, &account)
            .map_err(|e| SecretError::Platform(e.to_string()))?;
        Ok(password.as_ref().to_vec())
    }

    fn delete(&mut self, key: &str) -> Result<(), SecretError> {
        use security_framework::os::macos::keychain::SecKeychain;
        use security_framework::os::macos::passwords::find_generic_password;
        let keychain = SecKeychain::default().map_err(|e| SecretError::Platform(e.to_string()))?;
        let account = format!("{}/{}", self.account, key);
        let (_, item) = find_generic_password(Some(&[keychain]), &self.service, &account)
            .map_err(|e| SecretError::Platform(e.to_string()))?;
        item.delete();
        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub struct WindowsDpapiStore;

#[cfg(target_os = "windows")]
impl SecretStore for WindowsDpapiStore {
    fn put(&mut self, _key: &str, _value: &[u8]) -> Result<(), SecretError> {
        Err(SecretError::Platform(
            "DPAPI store pending Phase 2 wiring".into(),
        ))
    }
    fn get(&self, _key: &str) -> Result<Vec<u8>, SecretError> {
        Err(SecretError::Platform(
            "DPAPI store pending Phase 2 wiring".into(),
        ))
    }
    fn delete(&mut self, _key: &str) -> Result<(), SecretError> {
        Err(SecretError::Platform(
            "DPAPI store pending Phase 2 wiring".into(),
        ))
    }
}
