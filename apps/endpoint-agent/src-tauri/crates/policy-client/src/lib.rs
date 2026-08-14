use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PolicyError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("http status {0}")]
    Status(reqwest::StatusCode),
    #[error("missing or malformed policy payload")]
    Malformed,
    #[error("signature verification failed")]
    BadSignature,
    #[error("key fingerprint mismatch")]
    KeyMismatch,
    #[error("policy expired")]
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePolicy {
    pub policy_version: u32,
    pub collection_enabled: bool,
    pub window_title_enabled: bool,
    pub idle_after_seconds: u32,
    pub blocked_apps: Vec<String>,
    pub blocked_domains: Vec<String>,
    pub issued_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PolicyResponse {
    pub policy: RemotePolicy,
    pub signature: String,
    pub signing_key_fingerprint: String,
    pub signing_public_key: String,
}

/// Verify an Ed25519 signature over the canonical policy JSON. The monitor
/// publishes the public key as PEM-encoded SubjectPublicKeyInfo (BEGIN PUBLIC
/// KEY); ed25519-dalek parses that format natively.
pub fn verify_canonical(canonical: &str, signature_b64: &str, public_key_pem: &str) -> bool {
    let Ok(sig_bytes) = base64_decode(signature_b64) else {
        return false;
    };
    verify_ed25519(public_key_pem, canonical.as_bytes(), &sig_bytes)
}

fn base64_decode(b64: &str) -> Result<Vec<u8>, ()> {
    use base64::Engine as _;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| ())
}

fn verify_ed25519(public_key_pem: &str, msg: &[u8], sig: &[u8]) -> bool {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use spki::DecodePublicKey as _;
    let Ok(vk) = VerifyingKey::from_public_key_pem(public_key_pem) else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(sig) else {
        return false;
    };
    vk.verify(msg, &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_signature_rejected() {
        assert!(!verify_canonical("{}", "!!!not-base64!!!", "not-a-key"));
    }

    #[test]
    fn empty_public_key_rejected() {
        assert!(!verify_canonical("{}", "c2ln", ""));
    }

    #[test]
    fn cross_language_node_signature_verifies() {
        // Fixture produced by apps/api/src/policy/sign-policy.ts (Node
        // crypto ed25519, SPKI PEM public key, canonical JSON, base64 sig).
        let pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA4OJeUu/C+u+USZZjj6Rpv7bmtLvN8iKe63RgrFNfYWA=\n-----END PUBLIC KEY-----\n";
        let canonical = r#"{"a":1,"b":"x"}"#;
        let sig = "PHZsCV69l7cvMi5W4gm7Z0etSmZT+Kf2njQTb4PMqGVsppBdUvssci8I7d5hSve5cPEMzJhnUsu8GSHBRn2vCQ==";
        assert!(
            verify_canonical(canonical, sig, pem),
            "Node-signed fixture must verify in Rust"
        );
        assert!(
            !verify_canonical(r#"{"a":2,"b":"x"}"#, sig, pem),
            "tampered payload must fail"
        );
    }

    #[test]
    fn roundtrip_with_spki_pem() {
        // Sign with a fixed test key, build its SPKI PEM by hand (Ed25519 SPKI
        // is a fixed DER prefix + 32 raw bytes), verify the roundtrip.
        let key = ed25519_dalek::SigningKey::from_bytes(&[7u8; 32]);
        use ed25519_dalek::Signer as _;
        let canonical = r#"{"a":1}"#;
        let sig = key.sign(canonical.as_bytes());
        let sig_b64 = {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD.encode(sig.to_bytes())
        };
        // SPKI DER for Ed25519: 302a300506032b6570032100 || pubkey(32)
        let mut der = vec![
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
        ];
        der.extend_from_slice(key.verifying_key().as_bytes());
        let b64 = {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD.encode(&der)
        };
        let mut pem = String::from("-----BEGIN PUBLIC KEY-----\n");
        for chunk in b64.as_bytes().chunks(64) {
            pem.push_str(std::str::from_utf8(chunk).unwrap());
            pem.push('\n');
        }
        pem.push_str("-----END PUBLIC KEY-----\n");
        assert!(
            verify_canonical(canonical, &sig_b64, &pem),
            "SPKI PEM roundtrip must verify"
        );
        assert!(!verify_canonical(r#"{"a":2}"#, &sig_b64, &pem));
    }
}
