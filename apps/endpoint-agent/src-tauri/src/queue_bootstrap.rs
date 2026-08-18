use std::path::Path;

use local_store::{LocalStore, StoreError};

/// Fail-closed error for opening an enrolled product queue.
/// Display output must never include key material.
#[derive(Debug)]
pub enum StartupError {
    MissingQueueKey,
    Store(StoreError),
}

impl std::fmt::Display for StartupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingQueueKey => {
                write!(f, "queue encryption key is missing or invalid")
            }
            Self::Store(err) => write!(f, "queue store error: {err}"),
        }
    }
}

impl std::error::Error for StartupError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Store(err) => Some(err),
            Self::MissingQueueKey => None,
        }
    }
}

impl From<StoreError> for StartupError {
    fn from(err: StoreError) -> Self {
        Self::Store(err)
    }
}

/// Open the enrolled product queue. Never uses plaintext queue mode.
///
/// Missing or non-32-byte keys return `MissingQueueKey` without creating the
/// database file.
pub fn open_product_queue(
    path: &Path,
    queue_key: Option<&[u8]>,
) -> Result<LocalStore, StartupError> {
    let Some(key) = queue_key.filter(|key| key.len() == 32) else {
        return Err(StartupError::MissingQueueKey);
    };
    let Some(path_str) = path.to_str() else {
        return Err(StartupError::MissingQueueKey);
    };
    LocalStore::open_encrypted(path_str, key).map_err(StartupError::Store)
}
