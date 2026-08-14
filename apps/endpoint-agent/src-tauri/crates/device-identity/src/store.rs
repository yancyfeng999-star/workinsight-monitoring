use std::path::Path;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IdentityError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("bad device id")]
    BadDeviceId,
}

pub struct DeviceIdentity {
    pub device_id: String,
}

impl DeviceIdentity {
    pub fn load_or_create(path: &Path) -> Result<Self, IdentityError> {
        if path.exists() {
            let raw = std::fs::read_to_string(path)?;
            let id = raw.trim().to_string();
            if id.is_empty() {
                return Err(IdentityError::BadDeviceId);
            }
            return Ok(DeviceIdentity { device_id: id });
        }
        let id = format!("device_{}", uuid::Uuid::now_v7());
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, &id)?;
        Ok(DeviceIdentity { device_id: id })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_and_persists() {
        let dir = std::env::temp_dir().join(format!("aw-id-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("device_id");
        let _ = std::fs::remove_file(&p);
        let a = DeviceIdentity::load_or_create(&p).unwrap();
        let b = DeviceIdentity::load_or_create(&p).unwrap();
        assert_eq!(a.device_id, b.device_id);
        assert!(a.device_id.starts_with("device_"));
        let _ = std::fs::remove_file(&p);
    }
}
