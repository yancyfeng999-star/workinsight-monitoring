import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { DeviceAuth } from "../auth/device-auth.js";
import { validateEvent } from "../validate.js";

const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_EVENTS = 500;
const FUTURE_DRIFT_MS = 10 * 60 * 1000;
const HISTORY_LIMIT_MS = 7 * 24 * 3600 * 1000;

export function registerActivityRoutes(app: FastifyInstance, pool: Pool, deviceAuth: DeviceAuth): void {
  app.post<{ Body: { events?: unknown[] } }>(
    "/v1/activity-batches",
    {
      preValidation: async (req, reply) => {
        const len = Number(req.headers["content-length"] ?? 0);
        if (len > MAX_BATCH_BYTES) return reply.code(413).send({ error: "batch too large" });
      },
    },
    async (req, reply) => {
      const bearer = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const principal = await deviceAuth.authenticate(bearer);
      if (!principal) return reply.code(401).send({ error: "unauthorized" });
      if (principal.revoked) return reply.code(403).send({ error: "device revoked" });

      const events = (req.body as { events?: unknown[] })?.events;
      if (!Array.isArray(events)) return reply.code(400).send({ error: "events must be an array" });
      if (events.length > MAX_EVENTS) return reply.code(413).send({ error: "batch too large" });

      const accepted: Array<{ sequence_no: number; event_id: string }> = [];
      const rejected: Array<{ sequence_no: number; event_id: string; code: string; retryable: boolean }> = [];
      const now = Date.now();

      for (const raw of events) {
        const v = validateEvent(raw);
        if (!v.ok) {
          const r = raw as { sequence_no?: number; event_id?: string };
          rejected.push({
            sequence_no: typeof r.sequence_no === "number" ? r.sequence_no : -1,
            event_id: r.event_id ?? "",
            code: "invalid_schema",
            retryable: false,
          });
          continue;
        }
        const e = v.event;
        if (e.org_id !== principal.org_id || e.device_id !== principal.device_id || e.subject_id !== principal.subject_id) {
          rejected.push({ sequence_no: e.sequence_no, event_id: e.event_id, code: "identity_mismatch", retryable: false });
          continue;
        }
        const startMs = Date.parse(e.started_at);
        const endMs = Date.parse(e.ended_at);
        if (startMs - now > FUTURE_DRIFT_MS || now - endMs > HISTORY_LIMIT_MS) {
          rejected.push({ sequence_no: e.sequence_no, event_id: e.event_id, code: "invalid_schema", retryable: false });
          continue;
        }
        const insertedRes = await pool.query(
          `INSERT INTO activity_segments
             (org_id, device_id, sequence_no, event_id, subject_id, source, started_at, ended_at,
              app_id, app_name, window_title, registrable_domain, payload)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           ON CONFLICT (org_id, device_id, sequence_no) DO NOTHING`,
          [
            e.org_id, e.device_id, e.sequence_no, e.event_id, e.subject_id, e.source,
            e.started_at, e.ended_at,
            e.kind === "focus_segment" ? e.activity?.app_id ?? "" : "",
            e.kind === "focus_segment" ? e.activity?.app_name ?? "" : "",
            e.kind === "focus_segment" ? e.activity?.window_title ?? null : null,
            e.kind === "focus_segment" ? e.activity?.registrable_domain ?? null : null,
            JSON.stringify(e),
          ]
        );
        if (insertedRes.rowCount === 0) {
          const existing = await pool.query(
            `SELECT event_id FROM activity_segments WHERE org_id=$1 AND device_id=$2 AND sequence_no=$3`,
            [e.org_id, e.device_id, e.sequence_no]
          );
          if (existing.rows[0] && existing.rows[0].event_id !== e.event_id) {
            rejected.push({ sequence_no: e.sequence_no, event_id: e.event_id, code: "sequence_conflict", retryable: false });
            await pool.query(
              `INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`,
              ["device:" + e.device_id, "sequence_conflict", e.event_id, JSON.stringify({ sequence_no: e.sequence_no })]
            );
          } else {
            accepted.push({ sequence_no: e.sequence_no, event_id: e.event_id });
          }
        } else {
          accepted.push({ sequence_no: e.sequence_no, event_id: e.event_id });
        }
      }

      return reply.code(200).send({
        accepted,
        rejected,
        server_time: new Date().toISOString(),
      });
    }
  );

  app.post<{ Body: { health?: unknown[] } }>(
    "/v1/health-samples",
    async (req, reply) => {
      const bearer = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      const principal = await deviceAuth.authenticate(bearer);
      if (!principal) return reply.code(401).send({ error: "unauthorized" });
      if (principal.revoked) return reply.code(403).send({ error: "device revoked" });
      const samples = (req.body as { health?: unknown[] })?.health;
      if (!Array.isArray(samples)) return reply.code(400).send({ error: "health must be array" });
      let n = 0;
      for (const s of samples) {
        const h = s as {
          device_id: string; agent_version: string; os: string; collected_at: string;
          queue_depth: number; permissions_ok: boolean; autostart_enabled: boolean;
        };
        if (!h?.device_id || h.device_id !== principal.device_id || typeof h.queue_depth !== "number" || h.queue_depth < 0) {
          continue;
        }
        await pool.query(
          `INSERT INTO agent_health_samples
             (device_id, agent_version, os, collected_at, queue_depth, permissions_ok, autostart_enabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [h.device_id, h.agent_version, h.os, h.collected_at, h.queue_depth, h.permissions_ok, h.autostart_enabled]
        );
        n++;
      }
      return reply.code(200).send({ accepted: n });
    }
  );
}
