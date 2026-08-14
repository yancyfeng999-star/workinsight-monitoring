import pg from "pg";
import { RawEvent } from "./validate.js";

export class SegmentRepo {
  constructor(private pool: pg.Pool) {}

  async upsertDevice(e: RawEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO devices (device_id, org_id, subject_id, agent_version, os, last_heartbeat_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (device_id) DO UPDATE SET
         org_id = EXCLUDED.org_id,
         subject_id = EXCLUDED.subject_id,
         agent_version = EXCLUDED.agent_version,
         os = EXCLUDED.os,
         last_heartbeat_at = now()`,
      [e.device_id, e.org_id, e.subject_id, e.agent?.version ?? "unknown", e.agent?.os ?? "unknown"]
    );
  }

  async insertSegment(e: RawEvent): Promise<{ inserted: boolean }> {
    const res = await this.pool.query(
      `INSERT INTO activity_segments
         (org_id, device_id, sequence_no, event_id, subject_id, source,
          started_at, ended_at, app_id, app_name, window_title, registrable_domain, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (org_id, device_id, sequence_no) DO NOTHING`,
      [
        e.org_id,
        e.device_id,
        e.sequence_no,
        e.event_id,
        e.subject_id,
        e.source,
        e.started_at,
        e.ended_at,
        e.kind === "focus_segment" ? e.activity?.app_id ?? "" : "",
        e.kind === "focus_segment" ? e.activity?.app_name ?? "" : "",
        e.kind === "focus_segment" ? e.activity?.window_title ?? null : null,
        e.kind === "focus_segment" ? e.activity?.registrable_domain ?? null : null,
        JSON.stringify(e),
      ]
    );
    return { inserted: (res.rowCount ?? 0) > 0 };
  }

  async insertHealth(h: {
    device_id: string;
    agent_version: string;
    os: string;
    collected_at: string;
    queue_depth: number;
    permissions_ok: boolean;
    autostart_enabled: boolean;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO agent_health_samples
         (device_id, agent_version, os, collected_at, queue_depth, permissions_ok, autostart_enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [h.device_id, h.agent_version, h.os, h.collected_at, h.queue_depth, h.permissions_ok, h.autostart_enabled]
    );
  }

  async logAudit(actor: string, action: string, target: string | null, detail: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`,
      [actor, action, target, detail === undefined ? null : JSON.stringify(detail)]
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
