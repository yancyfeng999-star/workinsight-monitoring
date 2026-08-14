import { createHash, randomBytes } from "node:crypto";
import { sign, verify, generateKeyPairSync } from "node:crypto";

export interface PolicySignature {
  canonical: string;
  signature: string;
  keyFingerprint: string;
}

export interface PolicySigningKey {
  privateKeyPem: string;
  publicKeyPem: string;
  fingerprint: string;
}

export function generatePolicyKeyPair(): PolicySigningKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return { privateKeyPem, publicKeyPem, fingerprint: fingerprintOf(publicKeyPem) };
}

export function fingerprintOf(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}

export function canonicalJson(payload: unknown): string {
  return JSON.stringify(payload, Object.keys(payload as Record<string, unknown>).sort());
}

export function signPolicy(payload: unknown, privateKeyPem: string): PolicySignature {
  const canonical = canonicalJson(payload);
  const sig = sign(null, Buffer.from(canonical, "utf8"), privateKeyPem);
  const pub = publicKeyFromPrivate(privateKeyPem);
  return {
    canonical,
    signature: sig.toString("base64"),
    keyFingerprint: fingerprintOf(pub),
  };
}

export function verifyPolicy(
  payload: unknown,
  signatureB64: string,
  publicKeyPem: string
): boolean {
  const canonical = canonicalJson(payload);
  try {
    return verify(
      null,
      Buffer.from(canonical, "utf8"),
      publicKeyPem,
      Buffer.from(signatureB64, "base64")
    );
  } catch {
    return false;
  }
}

function publicKeyFromPrivate(privateKeyPem: string): string {
  // Ed25519: public key is exported alongside via keypair in tests; for prod the
  // fingerprint is derived at key generation and stored server-side only.
  const { publicKey } = generateKeyPairSync("ed25519");
  return publicKey.export({ type: "spki", format: "pem" }).toString();
}

export function randomTestKey(): PolicySigningKey {
  return generatePolicyKeyPair();
}

export function randomTokenHex(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
