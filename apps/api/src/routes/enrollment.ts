import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { hashToken } from "../auth/password.js";
import { generatePolicyKeyPair, randomTokenHex } from "../policy/sign-policy.js";

export interface EnrollmentResult {
  org_id: string;
  subject_id: string;
  device_id: string;
  device_token: string;
  device_token_expires_at: string;
  policy_version: number;
}

export function registerEnrollmentRoutes(app: FastifyInstance, pool: Pool, policyPublicKeyPem: string): void {
  app.post<{ Body: { enrollment_code?: string; agent_version?: string; os?: string; device_label?: string } }>(
    "/v1/enroll",
    async (req, reply) => {
      const code = req.body?.enrollment_code;
      if (!code || typeof code !== "string") {
        return reply.code(400).send({ error: "enrollment_code required" });
      }
      const codeHash = hashToken(code);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const res = await client.query(
          `SELECT org_id, subject_id, expires_at, used_at FROM enrollment_codes WHERE code_hash = $1 FOR UPDATE`,
          [codeHash]
        );
        const row = res.rows[0];
        if (!row) {
          await client.query("ROLLBACK");
          return reply.code(401).send({ error: "invalid enrollment code" });
        }
        if (row.used_at) {
          await client.query("ROLLBACK");
          return reply.code(409).send({ error: "enrollment code already used" });
        }
        if (new Date(row.expires_at).getTime() < Date.now()) {
          await client.query("ROLLBACK");
          return reply.code(401).send({ error: "enrollment code expired" });
        }

        const deviceId = "dev_" + randomTokenHex(12);
        const token = randomBytes(32).toString("base64url");
        const expiresAt = new Date(Date.now() + 90 * 24 * 3600 * 1000);
        await client.query(
          `UPDATE enrollment_codes SET used_at = now(), used_by_device_id = $1 WHERE code_hash = $2`,
          [deviceId, codeHash]
        );
        await client.query(
          `INSERT INTO device_credentials (device_id, org_id, subject_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [deviceId, row.org_id, row.subject_id, hashToken(token), expiresAt.toISOString()]
        );
        await client.query(
          `INSERT INTO devices (device_id, org_id, subject_id, agent_version, os)
           VALUES ($1, $2, $3, $4, $5) ON CONFLICT (device_id) DO NOTHING`,
          [deviceId, row.org_id, row.subject_id, req.body?.agent_version ?? "unknown", req.body?.os ?? "unknown"]
        );
        await client.query("COMMIT");
        const result: EnrollmentResult = {
          org_id: row.org_id,
          subject_id: row.subject_id,
          device_id: deviceId,
          device_token: token,
          device_token_expires_at: expiresAt.toISOString(),
          policy_version: 1,
        };
        return reply.code(201).send({
          ...result,
          policy_signing_public_key: policyPublicKeyPem,
        });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  );
}
