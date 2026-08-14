import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AdminSession } from "../auth/admin-session.js";
import { requireAdmin } from "../auth/admin-session.js";

export function registerSubjectsRoutes(
  app: FastifyInstance,
  pool: Pool,
  sessions: AdminSession
): void {
  app.get<{ Params: { subjectId: string } }>(
    "/v1/subjects/:subjectId/activity",
    async (req, reply) => {
      const admin = await requireAdmin(req, reply, sessions, ["company_admin", "manager", "internal_auditor"]);
      if (!admin) return;
      const { subjectId } = req.params;
      const res = await pool.query(
        `SELECT event_id, sequence_no, source, started_at, ended_at, app_id, app_name, registrable_domain
         FROM activity_segments
         WHERE org_id = $1 AND subject_id = $2
         ORDER BY started_at DESC LIMIT 500`,
        [admin.org_id, subjectId]
      );
      await pool.query(
        `INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`,
        ["admin:" + admin.username, "view_subject_activity", subjectId, JSON.stringify({ count: res.rows.length })]
      );
      return reply.code(200).send({ events: res.rows });
    }
  );

  app.get<{ Params: { subjectId: string } }>(
    "/v1/subjects/:subjectId/activity/headers",
    async (req, reply) => {
      const admin = await requireAdmin(req, reply, sessions, ["company_admin", "manager", "internal_auditor"]);
      if (!admin) return;
      const { subjectId } = req.params;
      const res = await pool.query(
        `SELECT event_id, sequence_no, source, started_at, ended_at, app_id, app_name, registrable_domain
         FROM activity_segments
         WHERE org_id = $1 AND subject_id = $2
         ORDER BY started_at DESC LIMIT 500`,
        [admin.org_id, subjectId]
      );
      return reply.code(200).send({ events: res.rows });
    }
  );
}
