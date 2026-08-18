import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AdminPrincipal, AdminRole, AdminSession } from "../auth/admin-session.js";
import { requireAdmin } from "../auth/admin-session.js";
import { hashToken } from "../auth/password.js";
import type { PolicySigningKey } from "../policy/sign-policy.js";
import { signPolicy } from "../policy/sign-policy.js";
import { ALLOWED_POLICY_KEYS, validateCollectionFields } from "../policy/collection-fields.js";
import type {
  AuditEntry,
  CreatedEnrollment,
  DashboardStats,
  Device,
  EnrollmentCode,
  InsightFinding,
  InsightMetric,
  InsightOutput,
  InsightResponse,
  Policy,
  SubjectDetail,
  SystemHealth,
  TeamSummary,
} from "./admin-console.types.js";

const STALE_MS = 10 * 60 * 1000;
const WORKER_STALE_MS = 10 * 60 * 1000;
const API_DEGRADED_MS = 500;
const EXCESSIVE_QUEUE = 100;
const GAP_MIN_MS = 30 * 60 * 1000;
const INSIGHT_WINDOW_DAYS = 7;

const READ_OVERVIEW: AdminRole[] = ["company_admin", "manager"];
const WRITE_ADMIN: AdminRole[] = ["company_admin"];
const READ_AUDIT: AdminRole[] = ["company_admin", "internal_auditor"];
const READ_INSIGHT: AdminRole[] = ["company_admin"];
const READ_HEALTH: AdminRole[] = ["company_admin", "system_operator"];

const DEFAULT_POLICY = {
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
    "onepassword.com",
    "1password.com",
    "bitwarden.com",
    "bankofamerica.com",
    "icbc.com.cn",
    "cmbchina.com",
    "alipay.com",
    "mail.google.com",
    "qq.com",
    "126.com",
    "163.com",
    "outlook.com",
    "localhost",
  ],
};

export const AUDIT_ORG_SCOPE = `(
  EXISTS (
    SELECT 1 FROM admin_users u
    WHERE a.actor = 'admin:' || u.username AND u.org_id = $1
  )
  OR EXISTS (
    SELECT 1 FROM devices d
    WHERE a.actor = 'device:' || d.device_id AND d.org_id = $1
  )
)`;

interface HealthRow {
  id: string;
  os: string;
  agentVersion: string;
  queueDepth: number;
  permissionsOk: boolean;
  lastSeen: string | null;
}

export function registerAdminConsoleRoutes(
  app: FastifyInstance,
  pool: Pool,
  sessions: AdminSession,
  key: PolicySigningKey
): void {
  app.get("/v1/admin/dashboard", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, READ_OVERVIEW);
    if (!admin) return;
    return reply.code(200).send(await loadDashboard(pool, admin.org_id));
  });

  app.get("/v1/admin/teams", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, READ_OVERVIEW);
    if (!admin) return;
    return reply.code(200).send(await loadTeams(pool, admin.org_id));
  });

  app.get<{ Params: { subjectId: string } }>("/v1/admin/subjects/:subjectId", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, READ_OVERVIEW);
    if (!admin) return;
    const detail = await loadSubjectDetail(pool, admin, req.params.subjectId);
    if (!detail) return reply.code(404).send({ error: "subject not found" });
    return reply.code(200).send(detail);
  });

  app.get("/v1/admin/devices", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, READ_OVERVIEW);
    if (!admin) return;
    return reply.code(200).send(await loadDevices(pool, admin.org_id));
  });

  app.get("/v1/admin/enrollment", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, WRITE_ADMIN);
    if (!admin) return;
    return reply.code(200).send(await loadEnrollment(pool, admin.org_id));
  });

  app.post<{ Body: { subjectId?: unknown; ttlHours?: unknown } }>(
    "/v1/admin/enrollment",
    async (req, reply) => {
      const admin = await requireAdmin(req, reply, sessions, WRITE_ADMIN);
      if (!admin) return;
      return createEnrollment(req, reply, pool, admin);
    }
  );

  app.get("/v1/admin/policies", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, WRITE_ADMIN);
    if (!admin) return;
    return reply.code(200).send(await loadPolicies(pool, admin.org_id));
  });

  app.post<{ Body: { content?: unknown; rolloutPercent?: unknown } }>(
    "/v1/admin/policies",
    async (req, reply) => {
      const admin = await requireAdmin(req, reply, sessions, WRITE_ADMIN);
      if (!admin) return;
      return createPolicy(req, reply, pool, admin, key);
    }
  );

  app.get<{ Querystring: { actor?: string; action?: string; from?: string; to?: string } }>(
    "/v1/admin/audit",
    async (req, reply) => {
      const admin = await requireAdmin(req, reply, sessions, READ_AUDIT);
      if (!admin) return;
      return reply.code(200).send(await loadAudit(pool, admin.org_id, req.query));
    }
  );

  app.get("/v1/admin/insight", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, READ_INSIGHT);
    if (!admin) return;
    return reply.code(200).send(await loadInsight(pool, admin.org_id));
  });

  app.get("/v1/admin/system/health", async (req, reply) => {
    const admin = await requireAdmin(req, reply, sessions, READ_HEALTH);
    if (!admin) return;
    return reply.code(200).send(await loadSystemHealth(pool, admin.org_id));
  });
}

async function loadDashboard(pool: Pool, orgId: string): Promise<DashboardStats> {
  const today = utcDate(0);
  const subjectRes = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM subjects WHERE org_id = $1`,
    [orgId]
  );
  const coveredRes = await pool.query<{ n: number }>(
    `SELECT COUNT(DISTINCT subject_id)::int AS n
     FROM daily_aggregates WHERE org_id = $1 AND date = $2::date`,
    [orgId, today]
  );
  const totalSubjects = asNumber(subjectRes.rows[0]?.n);
  const covered = asNumber(coveredRes.rows[0]?.n);
  const devices = await loadDevices(pool, orgId);
  const delayRes = await pool.query<{ avg: string | number | null }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (received_at - ended_at))) AS avg
     FROM activity_segments WHERE org_id = $1`,
    [orgId]
  );
  const categoryRes = await pool.query<{ category: string; count: number }>(
    `SELECT category, COUNT(DISTINCT subject_id)::int AS count
     FROM daily_aggregates
     WHERE org_id = $1 AND date = $2::date
     GROUP BY category
     ORDER BY category`,
    [orgId, today]
  );
  const recentAlerts = devices
    .filter((device) => device.stale || device.lastHealth === "degraded")
    .map((device) => {
      if (device.stale) {
        return {
          id: `stale:${device.id}`,
          message: `device ${device.id} is stale`,
          severity: "warning" as const,
          ts: device.lastSeen ?? new Date(0).toISOString(),
        };
      }
      if (!device.permissionsOk) {
        return {
          id: `permissions:${device.id}`,
          message: `device ${device.id} missing permissions`,
          severity: "critical" as const,
          ts: device.lastSeen ?? new Date().toISOString(),
        };
      }
      return {
        id: `queue:${device.id}`,
        message: `device ${device.id} queue depth ${device.queueDepth}`,
        severity: "warning" as const,
        ts: device.lastSeen ?? new Date().toISOString(),
      };
    });
  const avg = delayRes.rows[0]?.avg;
  return {
    coverageRate: totalSubjects === 0 ? 0 : Number((covered / totalSubjects).toFixed(4)),
    onlineDevices: devices.filter((device) => !device.stale).length,
    avgDelaySec: avg == null ? 0 : Math.max(0, Math.round(asNumber(avg))),
    categoryBreakdown: categoryRes.rows.map((row) => ({
      category: row.category,
      count: asNumber(row.count),
      total: totalSubjects,
    })),
    recentAlerts,
  };
}

async function loadTeams(pool: Pool, orgId: string): Promise<TeamSummary[]> {
  const today = utcDate(0);
  const teamsRes = await pool.query<{ id: string; name: string; member_count: number }>(
    `SELECT t.team_id AS id, t.name, COUNT(tm.subject_id)::int AS member_count
     FROM teams t
     LEFT JOIN team_memberships tm ON tm.team_id = t.team_id
     WHERE t.org_id = $1
     GROUP BY t.team_id, t.name
     ORDER BY t.name`,
    [orgId]
  );
  const summaryRes = await pool.query<{ team_id: string; date: string; coverage_rate: string | number }>(
    `SELECT team_id, to_char(date, 'YYYY-MM-DD') AS date, coverage_rate
     FROM team_summaries
     WHERE org_id = $1
     ORDER BY team_id, date DESC`,
    [orgId]
  );
  const summaries = new Map<string, Array<{ date: string; coverageRate: number }>>();
  for (const row of summaryRes.rows) {
    const list = summaries.get(row.team_id) ?? [];
    list.push({ date: row.date, coverageRate: asNumber(row.coverage_rate) });
    summaries.set(row.team_id, list);
  }
  const teams: TeamSummary[] = [];
  for (const team of teamsRes.rows) {
    const history = summaries.get(team.id) ?? [];
    let coverageRate = history[0]?.coverageRate;
    if (coverageRate === undefined) {
      const live = await pool.query<{ n: number }>(
        `SELECT COUNT(DISTINCT da.subject_id)::int AS n
         FROM team_memberships tm
         JOIN daily_aggregates da
           ON da.subject_id = tm.subject_id AND da.org_id = $1 AND da.date = $2::date
         WHERE tm.team_id = $3`,
        [orgId, today, team.id]
      );
      const members = asNumber(team.member_count);
      coverageRate = members === 0 ? 0 : Number((asNumber(live.rows[0]?.n) / members).toFixed(4));
    }
    teams.push({
      id: team.id,
      name: team.name,
      memberCount: asNumber(team.member_count),
      coverageRate,
      trend: trendOf(coverageRate, history[1]?.coverageRate ?? null),
    });
  }
  return teams;
}

async function loadSubjectDetail(
  pool: Pool,
  admin: AdminPrincipal,
  subjectId: string
): Promise<SubjectDetail | null> {
  const subjectRes = await pool.query<{ subject_id: string; display_name: string; team: string | null }>(
    `SELECT s.subject_id, s.display_name, MIN(t.name) AS team
     FROM subjects s
     LEFT JOIN team_memberships tm ON tm.subject_id = s.subject_id
     LEFT JOIN teams t ON t.team_id = tm.team_id
     WHERE s.subject_id = $1 AND s.org_id = $2
     GROUP BY s.subject_id, s.display_name`,
    [subjectId, admin.org_id]
  );
  const subject = subjectRes.rows[0];
  if (!subject) return null;

  await pool.query(`INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`, [
    "admin:" + admin.username,
    "view_subject_activity",
    subjectId,
    "{}",
  ]);

  const timelineRes = await pool.query<{ ts: Date | string; event: string; started_at: Date | string; ended_at: Date | string }>(
    `SELECT started_at AS ts, started_at, ended_at,
            COALESCE(NULLIF(app_name, ''), source) AS event
     FROM activity_segments
     WHERE org_id = $1 AND subject_id = $2
     ORDER BY started_at DESC
     LIMIT 200`,
    [admin.org_id, subjectId]
  );
  const dayRes = await pool.query<{ date: string; active_min: number; apps: number }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date,
            FLOOR(SUM(total_seconds) / 60.0)::int AS active_min,
            COUNT(DISTINCT app_id)::int AS apps
     FROM daily_aggregates
     WHERE org_id = $1 AND subject_id = $2
     GROUP BY date
     ORDER BY date DESC
     LIMIT 30`,
    [admin.org_id, subjectId]
  );
  const auditRes = await pool.query<{ actor: string; action: string; ts: Date | string }>(
    `SELECT a.actor, a.action, a.occurred_at AS ts
     FROM audit_logs a
     WHERE a.target = $2 AND ${AUDIT_ORG_SCOPE}
     ORDER BY a.occurred_at DESC
     LIMIT 50`,
    [admin.org_id, subjectId]
  );

  const chronological = [...timelineRes.rows].sort(
    (a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime()
  );
  const gaps: SubjectDetail["gaps"] = [];
  for (let i = 0; i < chronological.length - 1; i++) {
    const start = new Date(chronological[i].ended_at).getTime();
    const end = new Date(chronological[i + 1].started_at).getTime();
    if (end - start >= GAP_MIN_MS) {
      gaps.push({
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        reason: "no_activity",
      });
    }
  }

  return {
    id: subject.subject_id,
    name: subject.display_name,
    team: subject.team,
    timeline: timelineRes.rows.map((row) => ({ ts: toIso(row.ts), event: row.event })),
    dailyAggregates: dayRes.rows.map((row) => ({
      date: row.date,
      activeMin: asNumber(row.active_min),
      apps: asNumber(row.apps),
    })),
    gaps,
    auditLog: auditRes.rows.map((row) => ({
      actor: row.actor,
      action: row.action,
      ts: toIso(row.ts),
    })),
  };
}

async function loadDevices(pool: Pool, orgId: string): Promise<Device[]> {
  const res = await pool.query<{
    device_id: string;
    os: string;
    agent_version: string;
    health_os: string | null;
    health_version: string | null;
    collected_at: Date | string | null;
    queue_depth: number | null;
    permissions_ok: boolean | null;
  }>(
    `SELECT d.device_id, d.os, d.agent_version,
            h.os AS health_os, h.agent_version AS health_version,
            h.collected_at, h.queue_depth, h.permissions_ok
     FROM devices d
     LEFT JOIN LATERAL (
       SELECT os, agent_version, collected_at, queue_depth, permissions_ok
       FROM agent_health_samples
       WHERE device_id = d.device_id
       ORDER BY collected_at DESC
       LIMIT 1
     ) h ON true
     WHERE d.org_id = $1
     ORDER BY h.collected_at DESC NULLS LAST, d.device_id`,
    [orgId]
  );
  return res.rows.map((row) =>
    mapDevice({
      id: row.device_id,
      os: row.health_os ?? row.os,
      agentVersion: row.health_version ?? row.agent_version,
      queueDepth: row.queue_depth == null ? 0 : asNumber(row.queue_depth),
      permissionsOk: row.permissions_ok ?? true,
      lastSeen: row.collected_at == null ? null : toIso(row.collected_at),
    })
  );
}

function mapDevice(row: HealthRow): Device {
  const stale = row.lastSeen == null || Date.now() - Date.parse(row.lastSeen) > STALE_MS;
  let lastHealth: Device["lastHealth"] = "ok";
  if (stale) lastHealth = "offline";
  else if (!row.permissionsOk || row.queueDepth >= EXCESSIVE_QUEUE) lastHealth = "degraded";
  return {
    id: row.id,
    os: row.os,
    agentVersion: row.agentVersion,
    lastHealth,
    queueDepth: row.queueDepth,
    permissionsOk: row.permissionsOk,
    lastSeen: row.lastSeen,
    stale,
  };
}

async function loadEnrollment(pool: Pool, orgId: string): Promise<EnrollmentCode[]> {
  const res = await pool.query<{
    code_hash: string;
    created_at: Date | string;
    expires_at: Date | string;
    used_at: Date | string | null;
    used_by_device_id: string | null;
  }>(
    `SELECT code_hash, created_at, expires_at, used_at, used_by_device_id
     FROM enrollment_codes
     WHERE org_id = $1
     ORDER BY created_at DESC`,
    [orgId]
  );
  const now = Date.now();
  return res.rows.map((row) => {
    const item: EnrollmentCode = {
      code: row.code_hash.slice(0, 12),
      status: enrollmentStatus(row.used_at, row.expires_at, now),
      createdAt: toIso(row.created_at),
      expiresAt: toIso(row.expires_at),
    };
    if (row.used_by_device_id) item.usedBy = row.used_by_device_id;
    return item;
  });
}

async function createEnrollment(
  req: FastifyRequest<{ Body: { subjectId?: unknown; ttlHours?: unknown } }>,
  reply: FastifyReply,
  pool: Pool,
  admin: AdminPrincipal
): Promise<void> {
  const subjectId = req.body?.subjectId;
  const ttlHours = req.body?.ttlHours;
  if (typeof subjectId !== "string" || subjectId.length === 0) {
    return reply.code(400).send({ error: "subjectId required" });
  }
  if (!Number.isInteger(ttlHours) || Number(ttlHours) < 1 || Number(ttlHours) > 24) {
    return reply.code(400).send({ error: "ttlHours must be an integer from 1 to 24" });
  }
  const subject = await pool.query(`SELECT subject_id FROM subjects WHERE subject_id = $1 AND org_id = $2`, [
    subjectId,
    admin.org_id,
  ]);
  if (subject.rowCount === 0) return reply.code(404).send({ error: "subject not found" });

  const code = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + Number(ttlHours) * 3600 * 1000).toISOString();
  await pool.query(
    `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at) VALUES ($1,$2,$3,$4)`,
    [hashToken(code), admin.org_id, subjectId, expiresAt]
  );
  await pool.query(`INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`, [
    "admin:" + admin.username,
    "create_enrollment_code",
    subjectId,
    JSON.stringify({ expiresAt }),
  ]);
  const body: CreatedEnrollment = { code, expiresAt };
  return reply.code(201).send(body);
}

async function loadPolicies(pool: Pool, orgId: string): Promise<Policy[]> {
  const res = await pool.query<{
    policy_version: number;
    payload: Record<string, unknown>;
    created_at: Date | string;
  }>(
    `SELECT policy_version, payload, created_at
     FROM collection_policies
     WHERE org_id = $1
     ORDER BY policy_version DESC`,
    [orgId]
  );
  return res.rows.map(toPolicy);
}

async function createPolicy(
  req: FastifyRequest<{ Body: { content?: unknown; rolloutPercent?: unknown } }>,
  reply: FastifyReply,
  pool: Pool,
  admin: AdminPrincipal,
  key: PolicySigningKey
): Promise<void> {
  const parsed = parsePolicyContent(req.body?.content);
  if (!parsed.ok) return reply.code(400).send({ error: parsed.error });
  const rolloutPercent = req.body?.rolloutPercent;
  if (!Number.isInteger(rolloutPercent) || Number(rolloutPercent) < 0 || Number(rolloutPercent) > 100) {
    return reply.code(400).send({ error: "rolloutPercent must be an integer from 0 to 100" });
  }
  const nextRes = await pool.query<{ next: number }>(
    `SELECT COALESCE(MAX(policy_version), 0) + 1 AS next FROM collection_policies WHERE org_id = $1`,
    [admin.org_id]
  );
  const nextVersion = asNumber(nextRes.rows[0]?.next) || 1;
  const now = new Date();
  const collection: Record<string, unknown> = {
    ...DEFAULT_POLICY,
    ...parsed.value,
    policy_version: nextVersion,
    issued_at: typeof parsed.value.issued_at === "string" ? parsed.value.issued_at : now.toISOString(),
    expires_at:
      typeof parsed.value.expires_at === "string"
        ? parsed.value.expires_at
        : new Date(now.getTime() + 7 * 24 * 3600 * 1000).toISOString(),
  };
  const sig = signPolicy(collection, key.privateKeyPem);
  const stored = { collection, rollout_percent: rolloutPercent };
  const inserted = await pool.query<{ created_at: Date | string }>(
    `INSERT INTO collection_policies (policy_version, org_id, payload, signature, signing_key_fingerprint)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING created_at`,
    [nextVersion, admin.org_id, JSON.stringify(stored), sig.signature, key.fingerprint]
  );
  await pool.query(`INSERT INTO audit_logs (actor, action, target, detail) VALUES ($1,$2,$3,$4)`, [
    "admin:" + admin.username,
    "create_policy",
    String(nextVersion),
    JSON.stringify({ version: nextVersion, rolloutPercent }),
  ]);
  return reply.code(201).send(
    toPolicy({
      policy_version: nextVersion,
      payload: stored,
      created_at: inserted.rows[0]?.created_at ?? now,
    })
  );
}

async function loadAudit(
  pool: Pool,
  orgId: string,
  query: { actor?: string; action?: string; from?: string; to?: string }
): Promise<AuditEntry[]> {
  const params: unknown[] = [orgId];
  let sql = `SELECT a.id, a.actor, a.action, a.target, a.detail, a.occurred_at
             FROM audit_logs a
             WHERE ${AUDIT_ORG_SCOPE}`;
  if (typeof query.actor === "string" && query.actor.length > 0) {
    params.push(query.actor);
    sql += ` AND a.actor = $${params.length}`;
  }
  if (typeof query.action === "string" && query.action.length > 0) {
    params.push(query.action);
    sql += ` AND a.action = $${params.length}`;
  }
  const from = parseTime(query.from);
  if (from) {
    params.push(from);
    sql += ` AND a.occurred_at >= $${params.length}`;
  }
  const to = parseTime(query.to);
  if (to) {
    params.push(to);
    sql += ` AND a.occurred_at <= $${params.length}`;
  }
  sql += " ORDER BY a.occurred_at DESC LIMIT 200";
  const res = await pool.query<{
    id: string | number;
    actor: string;
    action: string;
    target: string | null;
    detail: Record<string, unknown> | null;
    occurred_at: Date | string;
  }>(sql, params);
  return res.rows.map((row) => ({
    id: String(row.id),
    actor: row.actor,
    action: row.action,
    target: row.target ?? "",
    requestId: typeof row.detail?.requestId === "string" ? row.detail.requestId : "",
    ts: toIso(row.occurred_at),
  }));
}

async function loadInsight(pool: Pool, orgId: string): Promise<InsightResponse> {
  const from = utcDate(1 - INSIGHT_WINDOW_DAYS);
  const to = utcDate(0);
  const gapRes = await pool.query<{ team: string; present: number }>(
    `SELECT t.name AS team, COUNT(DISTINCT ts.date)::int AS present
     FROM teams t
     LEFT JOIN team_summaries ts
       ON ts.team_id = t.team_id AND ts.org_id = t.org_id
      AND ts.date >= $2::date AND ts.date <= $3::date
     WHERE t.org_id = $1
     GROUP BY t.team_id, t.name
     ORDER BY t.name`,
    [orgId, from, to]
  );
  const devices = await loadDevices(pool, orgId);
  const stale = devices.filter((device) => device.stale).length;
  const missingPerms = devices.filter((device) => !device.permissionsOk).length;
  const dataQuality: InsightResponse["dataQuality"] = [];
  if (devices.length > 0) {
    dataQuality.push({
      metric: "stale_devices",
      value: String(stale),
      status: stale > 0 ? "warning" : "ok",
    });
    dataQuality.push({
      metric: "permission_failures",
      value: String(missingPerms),
      status: missingPerms > 0 ? "warning" : "ok",
    });
  }

  const reportRes = await pool.query<{ output: unknown }>(
    `SELECT output
     FROM insight_reports
     WHERE org_id = $1 AND date >= $2::date AND date <= $3::date
     ORDER BY date DESC, generated_at DESC`,
    [orgId, from, to]
  );
  const reports: InsightOutput[] = [];
  for (const row of reportRes.rows) {
    const parsed = parseStoredInsightOutput(row.output);
    if (parsed) reports.push(parsed);
  }
  const hasCurrent = reports.length > 0;

  return {
    mode: hasCurrent ? "ai" : "rules_only",
    reason: hasCurrent
      ? null
      : reportRes.rows.length > 0
        ? "no current valid report"
        : "model reports unavailable",
    coverageGaps: gapRes.rows
      .map((row) => ({
        team: row.team,
        missingDays: INSIGHT_WINDOW_DAYS - asNumber(row.present),
      }))
      .filter((row) => row.missingDays > 0),
    dataQuality,
    reports,
  };
}

function parseStoredInsightOutput(value: unknown): InsightOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (!hasExactKeys(rec, ["summary", "findings", "provider", "model", "generatedAt"])) return null;
  if (typeof rec.summary !== "string" || rec.summary.length === 0) return null;
  if (rec.provider !== "deepseek") return null;
  if (typeof rec.model !== "string" || rec.model.length === 0) return null;
  if (typeof rec.generatedAt !== "string" || Number.isNaN(Date.parse(rec.generatedAt))) return null;
  if (!Array.isArray(rec.findings)) return null;
  const findings: InsightFinding[] = [];
  for (const finding of rec.findings) {
    const parsed = parseStoredFinding(finding);
    if (!parsed) return null;
    findings.push(parsed);
  }
  return {
    summary: rec.summary,
    findings,
    provider: "deepseek",
    model: rec.model,
    generatedAt: rec.generatedAt,
  };
}

function parseStoredFinding(value: unknown): InsightFinding | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (!hasExactKeys(rec, ["title", "explanation", "evidence", "recommendation", "confidence"])) return null;
  if (typeof rec.title !== "string" || rec.title.length === 0) return null;
  if (typeof rec.explanation !== "string" || rec.explanation.length === 0) return null;
  if (typeof rec.recommendation !== "string" || rec.recommendation.length === 0) return null;
  if (typeof rec.confidence !== "number" || rec.confidence < 0 || rec.confidence > 1) return null;
  if (!Array.isArray(rec.evidence) || rec.evidence.length === 0) return null;
  const evidence: InsightMetric[] = [];
  for (const metric of rec.evidence) {
    const parsed = parseStoredMetric(metric);
    if (!parsed) return null;
    evidence.push(parsed);
  }
  return {
    title: rec.title,
    explanation: rec.explanation,
    evidence,
    recommendation: rec.recommendation,
    confidence: rec.confidence,
  };
}

function parseStoredMetric(value: unknown): InsightMetric | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  if (!hasExactKeys(rec, ["name", "value", "unit", "periodStart", "periodEnd"])) return null;
  if (typeof rec.name !== "string" || rec.name.length === 0) return null;
  if (typeof rec.value !== "number" || !Number.isFinite(rec.value)) return null;
  if (rec.unit !== "seconds" && rec.unit !== "count" && rec.unit !== "ratio" && rec.unit !== "percent") {
    return null;
  }
  if (typeof rec.periodStart !== "string" || typeof rec.periodEnd !== "string") return null;
  return {
    name: rec.name,
    value: rec.value,
    unit: rec.unit,
    periodStart: rec.periodStart,
    periodEnd: rec.periodEnd,
  };
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  if (keys.length !== allowed.length) return false;
  return allowed.every((key) => keys.includes(key));
}

async function loadSystemHealth(pool: Pool, orgId: string): Promise<SystemHealth> {
  const started = Date.now();
  try {
    const pingAt = Date.now();
    await pool.query("SELECT 1");
    const databaseLatencyMs = Date.now() - pingAt;

    const waterRes = await pool.query<{ last_run: Date | string | null }>(
      `SELECT MAX(last_processed_at) AS last_run FROM worker_watermarks`
    );
    const lastRunRaw = waterRes.rows[0]?.last_run ?? null;
    const lastRun = lastRunRaw == null ? null : toIso(lastRunRaw);
    let workerStatus: SystemHealth["worker"]["status"] = "stale";
    if (lastRun != null) {
      workerStatus = Date.now() - Date.parse(lastRun) > WORKER_STALE_MS ? "stale" : "ok";
    }

    const backlogRes = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM activity_segments
       WHERE org_id = $1
         AND received_at > COALESCE($2::timestamptz, '-infinity'::timestamptz)`,
      [orgId, lastRun]
    );
    const queueRes = await pool.query<{ n: number }>(
      `SELECT COALESCE(SUM(h.queue_depth), 0)::int AS n
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT queue_depth FROM agent_health_samples
         WHERE device_id = d.device_id
         ORDER BY collected_at DESC LIMIT 1
       ) h ON true
       WHERE d.org_id = $1`,
      [orgId]
    );
    const apiLatencyMs = Date.now() - started;
    return {
      api: { status: apiLatencyMs > API_DEGRADED_MS ? "degraded" : "ok", latencyMs: apiLatencyMs },
      worker: { status: workerStatus, lastRun },
      database: { connected: true, latencyMs: databaseLatencyMs },
      queues: [
        { name: "activity_backlog", depth: asNumber(backlogRes.rows[0]?.n) },
        { name: "health_queue", depth: asNumber(queueRes.rows[0]?.n) },
      ],
    };
  } catch {
    return {
      api: { status: "degraded", latencyMs: Date.now() - started },
      worker: { status: "error", lastRun: null },
      database: { connected: false, latencyMs: Date.now() - started },
      queues: [],
    };
  }
}

function toPolicy(row: {
  policy_version: number;
  payload: Record<string, unknown>;
  created_at: Date | string;
}): Policy {
  const { collection, rolloutPercent } = unwrapStoredPolicy(row.payload ?? {});
  return {
    version: asNumber(row.policy_version),
    content: JSON.stringify(collection),
    createdAt: toIso(row.created_at),
    rolloutPercent,
  };
}

function unwrapStoredPolicy(payload: Record<string, unknown>): {
  collection: Record<string, unknown>;
  rolloutPercent: number;
} {
  const nested = payload.collection;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : payload;
  const collection: Record<string, unknown> = {};
  for (const key of ALLOWED_POLICY_KEYS) {
    if (key in source) collection[key] = source[key];
  }
  return {
    collection,
    rolloutPercent: asNumber(payload.rollout_percent ?? 100),
  };
}

function parsePolicyContent(
  content: unknown
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof content !== "string") return { ok: false, error: "content must be a JSON string" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, error: "content must be valid JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "content must be a JSON object" };
  }
  return validateCollectionFields(parsed as Record<string, unknown>);
}

function enrollmentStatus(
  usedAt: Date | string | null,
  expiresAt: Date | string,
  now: number
): EnrollmentCode["status"] {
  if (usedAt) return "used";
  if (new Date(expiresAt).getTime() < now) return "expired";
  return "active";
}

function trendOf(latest: number, previous: number | null): TeamSummary["trend"] {
  if (previous == null || latest === previous) return "flat";
  return latest > previous ? "up" : "down";
}

function utcDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseTime(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
