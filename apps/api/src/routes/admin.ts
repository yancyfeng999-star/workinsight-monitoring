import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AdminRole } from "../auth/admin-session.js";
import { AdminSession, clearSessionCookie, readSessionToken, requireAdmin, setSessionCookie } from "../auth/admin-session.js";
import { hashToken, verifyPasswordArgon2id, randomToken } from "../auth/password.js";

export function registerAdminRoutes(app: FastifyInstance, pool: Pool, sessions: AdminSession): void {
  app.post<{ Body: { username?: string; password?: string } }>(
    "/v1/admin/login",
    async (req, reply) => {
      const { username, password } = req.body ?? {};
      if (!username || !password) return reply.code(400).send({ error: "username and password required" });
      const res = await pool.query(
        `SELECT admin_user_id, org_id, username, password_hash, role FROM admin_users WHERE username = $1`,
        [username]
      );
      const row = res.rows[0];
      if (!row || !(await verifyPasswordArgon2id(row.password_hash, password))) {
        return reply.code(401).send({ error: "invalid credentials" });
      }
      const token = await sessions.create(row.admin_user_id);
      setSessionCookie(reply, token);
      return reply.code(200).send({
        user: { admin_user_id: row.admin_user_id, username: row.username, role: row.role, org_id: row.org_id },
      });
    }
  );

  app.post("/v1/admin/logout", async (req, reply) => {
    const token = readSessionToken(req);
    if (token) await sessions.destroy(token);
    clearSessionCookie(reply);
    return reply.code(200).send({ ok: true });
  });

  app.get("/v1/admin/me", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, ["company_admin", "manager", "internal_auditor", "system_operator"]);
    if (!admin) return;
    return reply.code(200).send({ user: admin });
  });

  app.get("/v1/admin/audit-logs", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, ["company_admin", "internal_auditor"]);
    if (!admin) return;
    const res = await pool.query(
      `SELECT actor, action, target, detail, occurred_at FROM audit_logs ORDER BY occurred_at DESC LIMIT 200`
    );
    return reply.code(200).send({ logs: res.rows });
  });

  app.post<{ Body: { username?: string; password?: string; role?: AdminRole; display_name?: string; subject_id?: string } }>(
    "/v1/admin/subjects",
    async (req, reply) => {
      const admin = await requireAdmin(req, reply, sessions, ["company_admin"]);
      if (!admin) return;
      const { subject_id, display_name } = req.body ?? {};
      if (!subject_id || !display_name) return reply.code(400).send({ error: "subject_id and display_name required" });
      await pool.query(
        `INSERT INTO subjects (subject_id, org_id, display_name) VALUES ($1, $2, $3)
         ON CONFLICT (subject_id) DO UPDATE SET display_name = EXCLUDED.display_name`,
        [subject_id, admin.org_id, display_name]
      );
      await pool.query(
        `INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`,
        ["admin:" + admin.username, "create_subject", subject_id, "{}"]
      );
      return reply.code(201).send({ subject_id, org_id: admin.org_id });
    }
  );
}
