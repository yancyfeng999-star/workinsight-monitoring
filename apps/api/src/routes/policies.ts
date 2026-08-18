import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AdminSession, AdminRole } from "../auth/admin-session.js";
import { requireAdmin } from "../auth/admin-session.js";
import { hashToken } from "../auth/password.js";
import { signPolicy, verifyPolicy, generatePolicyKeyPair } from "../policy/sign-policy.js";
import type { PolicySigningKey } from "../policy/sign-policy.js";
import { validateCollectionFields } from "../policy/collection-fields.js";

const DEFAULT_POLICY = {
  policy_version: 1,
  collection_enabled: true,
  window_title_enabled: false,
  idle_after_seconds: 300,
  blocked_apps: [
    "com.1password.1password",
    "com.agilebits.onepassword7",
    "com.bitwarden.desktop",
    "com.apple.Passwords",
  ],
  blocked_domains: [
    "onepassword.com", "1password.com", "bitwarden.com",
    "bankofamerica.com", "icbc.com.cn", "cmbchina.com", "alipay.com",
    "mail.google.com", "qq.com", "126.com", "163.com", "outlook.com",
    "localhost",
  ],
  issued_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
};

export function registerPoliciesRoutes(
  app: FastifyInstance,
  pool: Pool,
  sessions: AdminSession,
  key: PolicySigningKey
): void {
  app.get("/v1/device-policy", async (req, reply) => {
    const bearer = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!bearer) return reply.code(401).send({ error: "unauthorized" });
    const orgRes = await pool.query(
      `SELECT org_id FROM device_credentials WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(bearer)]
    );
    const orgRow = orgRes.rows[0];
    if (!orgRow) return reply.code(401).send({ error: "unauthorized" });

    const polRes = await pool.query(
      `SELECT payload, signature, signing_key_fingerprint FROM collection_policies WHERE org_id = $1 ORDER BY policy_version DESC LIMIT 1`,
      [orgRow.org_id]
    );
    if (polRes.rowCount === 0) {
      const sig = signPolicy(DEFAULT_POLICY, key.privateKeyPem);
      const payload = JSON.parse(sig.canonical);
      await pool.query(
        `INSERT INTO collection_policies (policy_version, org_id, payload, signature, signing_key_fingerprint)
         VALUES ($1, $2, $3, $4, $5)`,
        [payload.policy_version, orgRow.org_id, JSON.stringify(payload), sig.signature, key.fingerprint]
      );
      return reply.code(200).send({
        policy: payload,
        signature: sig.signature,
        signing_key_fingerprint: key.fingerprint,
        signing_public_key: key.publicKeyPem,
      });
    }
    const row = polRes.rows[0];
    return reply.code(200).send({
      policy: collectionPolicyForDevice(row.payload),
      signature: row.signature,
      signing_key_fingerprint: row.signing_key_fingerprint,
      signing_public_key: key.publicKeyPem,
    });
  });

  app.get("/v1/policies", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, ["company_admin"]);
    if (!admin) return;
    const res = await pool.query(
      `SELECT policy_version, payload, signing_key_fingerprint, created_at
       FROM collection_policies WHERE org_id = $1 ORDER BY policy_version DESC`,
      [admin.org_id]
    );
    return reply.code(200).send({ policies: res.rows });
  });

  app.post<{ Body: Record<string, unknown> }>("/v1/policies", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, ["company_admin"]);
    if (!admin) return;
    const body = req.body;
    if (!body || typeof body !== "object") return reply.code(400).send({ error: "policy required" });
    const parsed = validateCollectionFields(body);
    if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
    const polRes = await pool.query(
      `SELECT COALESCE(MAX(policy_version), 0) + 1 AS next FROM collection_policies WHERE org_id = $1`,
      [admin.org_id]
    );
    const nextVersion = polRes.rows[0].next;
    const payload = {
      ...DEFAULT_POLICY,
      ...parsed.value,
      policy_version: nextVersion,
      issued_at: new Date().toISOString(),
    };
    const sig = signPolicy(payload, key.privateKeyPem);
    await pool.query(
      `INSERT INTO collection_policies (policy_version, org_id, payload, signature, signing_key_fingerprint)
       VALUES ($1, $2, $3, $4, $5)`,
      [nextVersion, admin.org_id, JSON.stringify(payload), sig.signature, key.fingerprint]
    );
    await pool.query(
      `INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`,
      ["admin:" + admin.username, "create_policy", String(nextVersion), JSON.stringify({ version: nextVersion })]
    );
    return reply.code(201).send({ policy_version: nextVersion, signature: sig.signature });
  });
}

function collectionPolicyForDevice(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const rec = payload as Record<string, unknown>;
  if (rec.collection && typeof rec.collection === "object" && !Array.isArray(rec.collection)) {
    return rec.collection;
  }
  return payload;
}
