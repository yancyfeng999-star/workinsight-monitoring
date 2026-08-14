use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SecretError {
    #[error("entry not found: {0}")]
    NotFound(String),
    #[error("platform secret store error: {0}")]
    Platform(String),
}

/// In-memory secret store for unit tests only. Never used in release paths.
#[derive(Default)]
pub struct MemorySecretStore {
    map: HashMap<String, Vec<u8>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put(&mut self, key: &str, value: &[u8]) -> Result<(), SecretError> {
        self.map.insert(key.to_string(), value.to_vec());
        Ok(())
    }

    pub fn get(&self, key: &str) -> Result<Vec<u8>, SecretError> {
        self.map
            .get(key)
            .cloned()
            .ok_or_else(|| SecretError::NotFound(key.to_string()))
    }

    pub fn delete(&mut self, key: &str) -> Result<(), SecretError> {
        self.map.remove(key);
        Ok(())
    }
}

pub trait SecretStore {
    fn put(&mut self, key: &str, value: &[u8]) -> Result<(), SecretError>;
    fn get(&self, key: &str) -> Result<Vec<u8>, SecretError>;
    fn delete(&mut self, key: &str) -> Result<(), SecretError>;
}

impl SecretStore for MemorySecretStore {
    fn put(&mut self, key: &str, value: &[u8]) -> Result<(), SecretError> {
        MemorySecretStore::put(self, key, value)
    }

    fn get(&self, key: &str) -> Result<Vec<u8>, SecretError> {
        MemorySecretStore::get(self, key)
    }

    fn delete(&mut self, key: &str) -> Result<(), SecretError> {
        MemorySecretStore::delete(self, key)
    }
}
