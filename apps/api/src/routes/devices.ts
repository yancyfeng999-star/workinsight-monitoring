import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AdminSession } from "../auth/admin-session.js";
import { requireAdmin } from "../auth/admin-session.js";
import { randomBytes } from "node:crypto";
import { hashToken } from "../auth/password.js";

export function registerDevicesRoutes(
  app: FastifyInstance,
  pool: Pool,
  sessions: AdminSession
): void {
  app.get("/v1/devices", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, ["company_admin", "manager", "internal_auditor", "system_operator"]);
    if (!admin) return;
    const res = await pool.query(
      `SELECT d.device_id, d.org_id, d.subject_id, d.agent_version, d.os,
              d.last_heartbeat_at, d.revoked_at,
              dc.expires_at AS credential_expires_at, dc.revoked_at AS credential_revoked_at
       FROM devices d LEFT JOIN device_credentials dc ON dc.device_id = d.device_id
       WHERE d.org_id = $1
       ORDER BY d.last_heartbeat_at DESC NULLS LAST LIMIT 500`,
      [admin.org_id]
    );
    return reply.code(200).send({ devices: res.rows });
  });

  app.post<{ Body: { subject_id?: string } }>(
    "/v1/device-enrollments/codes",
    async (req, reply) => {
      const admin = await requireAdmin(req, reply, sessions, ["company_admin"]);
      if (!admin) return;
      const subjectId = req.body?.subject_id;
      if (!subjectId) return reply.code(400).send({ error: "subject_id required" });
      const code = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await pool.query(
        `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [hashToken(code), admin.org_id, subjectId, expiresAt.toISOString()]
      );
      await pool.query(
        `INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`,
        ["admin:" + admin.username, "create_enrollment_code", subjectId, JSON.stringify({ expires_at: expiresAt.toISOString() })]
      );
      return reply.code(201).send({ enrollment_code: code, expires_at: expiresAt.toISOString() });
    }
  );

  app.post<{ Params: { deviceId: string } }>(
    "/v1/devices/:deviceId/revoke",
    async (req, reply) => {
      const admin = await requireAdmin(req, reply, sessions, ["company_admin"]);
      if (!admin) return;
      const { deviceId } = req.params;
      const res = await pool.query(
        `UPDATE device_credentials SET revoked_at = now()
         WHERE device_id = $1 AND org_id = $2 AND revoked_at IS NULL
         RETURNING device_id`,
        [deviceId, admin.org_id]
      );
      if (res.rowCount === 0) return reply.code(404).send({ error: "device not found" });
      await pool.query(
        `INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`,
        ["admin:" + admin.username, "revoke_device", deviceId, "{}"]
      );
      return reply.code(200).send({ ok: true });
    }
  );
}
