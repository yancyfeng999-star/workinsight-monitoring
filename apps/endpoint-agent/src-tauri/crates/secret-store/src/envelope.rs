use aes_gcm::aead::{Aead, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EncryptionError {
    #[error("key too short: {0}")]
    BadKey(usize),
    #[error("base64 decode error")]
    Base64,
    #[error("nonce wrong size")]
    BadNonce,
    #[error("decryption failed")]
    Decrypt,
}

pub struct Envelope {
    pub nonce_b64: String,
    pub ciphertext_b64: String,
}

pub fn encrypt_payload(plaintext: &[u8], key: &[u8]) -> Result<Envelope, EncryptionError> {
    if key.len() != 32 {
        return Err(EncryptionError::BadKey(key.len()));
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| EncryptionError::BadKey(key.len()))?;
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext)
        .map_err(|_| EncryptionError::Decrypt)?;
    Ok(Envelope {
        nonce_b64: B64.encode(nonce),
        ciphertext_b64: B64.encode(ciphertext),
    })
}

pub fn decrypt_payload(env: &Envelope, key: &[u8]) -> Result<Vec<u8>, EncryptionError> {
    if key.len() != 32 {
        return Err(EncryptionError::BadKey(key.len()));
    }
    let nonce = B64
        .decode(&env.nonce_b64)
        .map_err(|_| EncryptionError::Base64)?;
    let ciphertext = B64
        .decode(&env.ciphertext_b64)
        .map_err(|_| EncryptionError::Base64)?;
    if nonce.len() != 12 {
        return Err(EncryptionError::BadNonce);
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| EncryptionError::BadKey(key.len()))?;
    cipher
        .decrypt(Nonce::from_slice(&nonce), ciphertext.as_ref())
        .map_err(|_| EncryptionError::Decrypt)
}

pub fn random_key() -> [u8; 32] {
    let mut k = [0u8; 32];
    OsRng.fill_bytes(&mut k);
    k
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_with_unique_nonce() {
        let key = random_key();
        let payload = b"{\"device_token\":\"secret-token-value\"}";
        let a = encrypt_payload(payload, &key).unwrap();
        let b = encrypt_payload(payload, &key).unwrap();
        assert_ne!(
            a.nonce_b64, b.nonce_b64,
            "each encryption must use a fresh nonce"
        );
        let dec = decrypt_payload(&a, &key).unwrap();
        assert_eq!(dec.as_slice(), payload);
    }

    #[test]
    fn wrong_key_fails() {
        let key = random_key();
        let other = random_key();
        let env = encrypt_payload(b"secret", &key).unwrap();
        assert!(decrypt_payload(&env, &other).is_err());
    }

    #[test]
    fn ciphertext_is_not_plaintext() {
        let key = random_key();
        let payload = b"device_token_plaintext_marker";
        let env = encrypt_payload(payload, &key).unwrap();
        assert!(!env.ciphertext_b64.contains("device_token"));
    }
}
