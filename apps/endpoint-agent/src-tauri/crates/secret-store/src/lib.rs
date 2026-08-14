pub mod envelope;
pub mod memory;
pub mod platform;

pub use envelope::{decrypt_payload, encrypt_payload, random_key, EncryptionError, Envelope};
pub use memory::{MemorySecretStore, SecretError, SecretStore};
pub use platform::PlatformSecretStore;
