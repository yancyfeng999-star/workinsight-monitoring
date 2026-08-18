import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../src/index.js";
import type { BuildOptions } from "../src/index.js";
import { hashToken } from "../src/auth/password.js";
import { generatePolicyKeyPair, signPolicy, verifyPolicy } from "../src/policy/sign-policy.js";
import { withTestSchema } from "./helpers/test-db.js";
import {
  AUDIT_ENTRY_KEYS,
  CREATED_ENROLLMENT_KEYS,
  DASHBOARD_KEYS,
  DEVICE_KEYS,
  ENROLLMENT_CODE_KEYS,
  INSIGHT_RESPONSE_KEYS,
  POLICY_KEYS,
  SUBJECT_DETAIL_KEYS,
  SYSTEM_HEALTH_KEYS,
  TEAM_SUMMARY_KEYS,
} from "../src/routes/admin-console.types.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://workinsight:workinsight_dev@localhost:5433/workinsight_test";

const VALID_POLICY = JSON.stringify({
  collection_enabled: true,
  window_title_enabled: false,
  idle_after_seconds: 300,
  blocked_apps: ["com.1password.1password"],
  blocked_domains: ["onepassword.com"],
});

const CONSOLE_ROUTES: Array<{
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}> = [
  { method: "GET", path: "/v1/admin/dashboard" },
  { method: "GET", path: "/v1/admin/teams" },
  { method: "GET", path: "/v1/admin/subjects/sub_a" },
  { method: "GET", path: "/v1/admin/devices" },
  { method: "GET", path: "/v1/admin/enrollment" },
  { method: "POST", path: "/v1/admin/enrollment", body: { subjectId: "sub_a", ttlHours: 2 } },
  { method: "GET", path: "/v1/admin/policies" },
  { method: "POST", path: "/v1/admin/policies", body: { content: VALID_POLICY, rolloutPercent: 10 } },
  { method: "GET", path: "/v1/admin/audit" },
  { method: "GET", path: "/v1/admin/insight" },
  { method: "GET", path: "/v1/admin/system/health" },
];

type AppCtx = { url: string; app: Awaited<ReturnType<typeof buildApp>> };

async function runInSchema(
  schema: string,
  fn: (ctx: AppCtx) => Promise<void>,
  opts: BuildOptions = {}
): Promise<void> {
  const conn = new URL(TEST_DB_URL);
  conn.searchParams.set("options", `-csearch_path=${schema},public`);
  const app = await buildApp(conn.toString(), opts);
  const address = await app.app.listen({ port: 0, host: "127.0.0.1" });
  try {
    await fn({ url: address, app });
  } finally {
    await app.app.close();
    await app.pool.end();
  }
}

async function seedIdentities(pool: AppCtx["app"]["pool"]): Promise<void> {
  await pool.query("INSERT INTO organizations (org_id, name) VALUES ('org_a','Org A'), ('org_b','Org B')");
  await pool.query(
    `INSERT INTO subjects (subject_id, org_id, display_name) VALUES
       ('sub_a','org_a','Alice'),
       ('sub_a2','org_a','Aaron'),
       ('sub_bravo','org_b','Bravo')`
  );
  await pool.query(
    `INSERT INTO admin_users (admin_user_id, org_id, username, password_hash, role) VALUES
       ('user_admin_a','org_a','admin_a','x','company_admin'),
       ('user_manager_a','org_a','manager_a','x','manager'),
       ('user_auditor_a','org_a','auditor_a','x','internal_auditor'),
       ('user_operator_a','org_a','operator_a','x','system_operator'),
       ('user_admin_b','org_b','admin_b','x','company_admin')`
  );
}

async function seedFacts(pool: AppCtx["app"]["pool"]): Promise<void> {
  const today = utcDate();
  const yesterday = utcDate(-1);
  await pool.query(
    `INSERT INTO teams (team_id, org_id, name) VALUES
       ('team_alpha','org_a','Team Alpha'),
       ('team_bravo','org_b','Team Bravo')`
  );
  await pool.query(
    `INSERT INTO team_memberships (team_id, subject_id) VALUES
       ('team_alpha','sub_a'),
       ('team_bravo','sub_bravo')`
  );
  await pool.query(
    `INSERT INTO devices (device_id, org_id, subject_id, agent_version, os, last_heartbeat_at) VALUES
       ('dev_ok','org_a','sub_a','0.1.1','macos', now()),
       ('dev_perm','org_a','sub_a','0.1.1','macos', now()),
       ('dev_queue','org_a','sub_a2','0.1.1','windows', now()),
       ('dev_stale','org_a','sub_a2','0.1.0','macos', now() - interval '40 minutes'),
       ('dev_never','org_a','sub_a2','0.1.0','linux', NULL),
       ('dev_bravo','org_b','sub_bravo','9.9.9','macos', now())`
  );
  await pool.query(
    `INSERT INTO agent_health_samples
       (device_id, agent_version, os, collected_at, queue_depth, permissions_ok, autostart_enabled) VALUES
       ('dev_ok','0.1.1','macos', now() - interval '1 minute', 2, true, true),
       ('dev_perm','0.1.1','macos', now() - interval '2 minutes', 3, false, true),
       ('dev_queue','0.1.1','windows', now() - interval '1 minute', 250, true, true),
       ('dev_stale','0.1.0','macos', now() - interval '40 minutes', 1, true, true),
       ('dev_bravo','9.9.9','macos', now() - interval '30 seconds', 1, true, true)`
  );
  await pool.query(
    `INSERT INTO daily_aggregates
       (org_id, subject_id, date, category, app_id, registrable_domain, total_seconds, segment_count)
     VALUES
       ('org_a','sub_a',$1,'development','com.apple.dt.Xcode',NULL,3600,4),
       ('org_b','sub_bravo',$1,'org_b_only','com.org.bravo',NULL,7200,8)`,
    [today]
  );
  await pool.query(
    `INSERT INTO team_summaries (org_id, team_id, date, member_count, coverage_rate, avg_active_seconds, top_categories)
     VALUES
       ('org_a','team_alpha',$2,1,0.2000,600,'{"development":600}'),
       ('org_a','team_alpha',$1,1,0.5000,1200,'{"development":1200}'),
       ('org_b','team_bravo',$1,1,0.9000,2400,'{"org_b_only":2400}')`,
    [today, yesterday]
  );
  await pool.query(
    `INSERT INTO activity_segments
       (org_id, device_id, sequence_no, event_id, subject_id, source,
        started_at, ended_at, app_id, app_name, window_title, registrable_domain, payload, received_at)
     VALUES
       ('org_a','dev_ok',1,'evt_a1','sub_a','system',
        now() - interval '3 hours', now() - interval '3 hours' + interval '5 minutes',
        'com.apple.dt.Xcode','Xcode',NULL,NULL,'{}', now() - interval '3 hours' + interval '6 minutes'),
       ('org_a','dev_ok',2,'evt_a2','sub_a','system',
        now() - interval '1 hour', now() - interval '1 hour' + interval '5 minutes',
        'com.apple.Terminal','Terminal',NULL,NULL,'{}', now() - interval '1 hour' + interval '7 minutes'),
       ('org_b','dev_bravo',1,'evt_b1','sub_bravo','system',
        now() - interval '20 minutes', now() - interval '15 minutes',
        'com.org.bravo','BravoApp',NULL,'secret.example','{}', now() - interval '14 minutes')`
  );
  await pool.query(
    `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at, used_at, used_by_device_id)
     VALUES
       ($1,'org_a','sub_a', now() + interval '2 hours', NULL, NULL),
       ($2,'org_b','sub_bravo', now() + interval '2 hours', now(), 'dev_bravo')`,
    [hashToken("alpha-code-plaintext"), hashToken("bravo-code-plaintext")]
  );
  await pool.query(
    `INSERT INTO collection_policies (policy_version, org_id, payload, signature, signing_key_fingerprint)
     VALUES
       (1,'org_a','{"policy_version":1,"collection_enabled":true,"window_title_enabled":false,"idle_after_seconds":300,"blocked_apps":["com.org.alpha"],"blocked_domains":["onepassword.com"],"issued_at":"2026-08-10T00:00:00.000Z","expires_at":"2026-08-17T00:00:00.000Z","rollout_percent":25}','sig_a','fp_a'),
       (1,'org_b','{"policy_version":1,"collection_enabled":true,"window_title_enabled":false,"idle_after_seconds":300,"blocked_apps":["com.org.bravo"],"blocked_domains":["onepassword.com"],"issued_at":"2026-08-10T00:00:00.000Z","expires_at":"2026-08-17T00:00:00.000Z","rollout_percent":80}','sig_b','fp_b')`
  );
  await pool.query(
    `INSERT INTO audit_logs (actor, action, target, detail, occurred_at) VALUES
       ('admin:admin_a','create_subject','sub_a','{"requestId":"req_a"}', now() - interval '2 hours'),
       ('admin:admin_b','create_subject','sub_bravo','{"requestId":"req_b"}', now() - interval '1 hour')`
  );
}

async function bearer(ctx: AppCtx, adminUserId: string): Promise<string> {
  return ctx.app.sessions.create(adminUserId);
}

async function api(
  ctx: AppCtx,
  path: string,
  init: RequestInit & { token?: string | null } = {}
): Promise<{ status: number; body: unknown; raw: string }> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set("authorization", "Bearer " + init.token);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const resp = await fetch(ctx.url + path, { ...init, headers });
  const raw = await resp.text();
  let body: unknown = raw;
  try {
    body = raw.length === 0 ? null : JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: resp.status, body, raw };
}

function utcDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
}

function keysOf(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected object to read keys");
  }
  return Object.keys(value).sort();
}

function assertExactKeys(value: unknown, expected: readonly string[]): void {
  assert.deepEqual(keysOf(value), [...expected].sort());
}

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.add(key);
      collectKeys(child, out);
    }
  }
  return out;
}

function assertNoScreenshots(value: unknown): void {
  assert.equal(collectKeys(value).has("screenshots"), false);
}

function interfaceProps(src: string, name: string): string[] {
  const start = src.indexOf(`export interface ${name}`);
  if (start < 0) throw new Error(`missing interface ${name}`);
  const brace = src.indexOf("{", start);
  let depth = 0;
  let end = brace;
  for (; end < src.length; end++) {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = src.slice(brace + 1, end);
  const props: string[] = [];
  let nested = 0;
  for (const line of body.split("\n")) {
    const opens = (line.match(/{/g) ?? []).length;
    const closes = (line.match(/}/g) ?? []).length;
    if (nested === 0) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\??:/);
      if (match) props.push(match[1]);
    }
    nested += opens - closes;
  }
  return props.sort();
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

test("admin console types stay aligned with the web-console contract", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const apiSrc = readFileSync(resolve(here, "../src/routes/admin-console.types.ts"), "utf8");
  const webSrc = readFileSync(resolve(here, "../../web-console/src/lib/api.ts"), "utf8");
  assert.equal(apiSrc.includes("screenshots"), false);

  for (const name of ["EnrollmentCode", "Policy", "AuditEntry"] as const) {
    assert.deepEqual(interfaceProps(apiSrc, name), interfaceProps(webSrc, name), name);
  }

  const shared = ["Device", "DashboardStats", "TeamSummary", "SubjectDetail", "SystemHealth"] as const;
  for (const name of shared) {
    const apiProps = interfaceProps(apiSrc, name);
    const webProps = interfaceProps(webSrc, name);
    for (const prop of webProps) {
      assert.ok(apiProps.includes(prop), `${name} is missing web prop ${prop}`);
    }
  }
  assert.ok(interfaceProps(apiSrc, "InsightResponse").includes("reports"));
  assert.ok(interfaceProps(apiSrc, "InsightOutput").includes("findings"));
});

test("every console route returns 401 without a session", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      for (const route of CONSOLE_ROUTES) {
        const result = await api(ctx, route.path, {
          method: route.method,
          body: route.body === undefined ? undefined : JSON.stringify(route.body),
        });
        assert.equal(result.status, 401, `${route.method} ${route.path}`);
      }
    });
  });
});

test("disallowed roles receive 403 on console routes", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      const manager = await bearer(ctx, "user_manager_a");
      const auditor = await bearer(ctx, "user_auditor_a");
      const operator = await bearer(ctx, "user_operator_a");

      const forbidden: Array<{ token: string; route: (typeof CONSOLE_ROUTES)[number] }> = [
        { token: operator, route: CONSOLE_ROUTES[0] },
        { token: auditor, route: CONSOLE_ROUTES[0] },
        { token: operator, route: CONSOLE_ROUTES[1] },
        { token: operator, route: CONSOLE_ROUTES[2] },
        { token: operator, route: CONSOLE_ROUTES[3] },
        { token: manager, route: CONSOLE_ROUTES[4] },
        { token: manager, route: CONSOLE_ROUTES[5] },
        { token: manager, route: CONSOLE_ROUTES[6] },
        { token: manager, route: CONSOLE_ROUTES[7] },
        { token: manager, route: CONSOLE_ROUTES[8] },
        { token: operator, route: CONSOLE_ROUTES[8] },
        { token: manager, route: CONSOLE_ROUTES[9] },
        { token: auditor, route: CONSOLE_ROUTES[9] },
        { token: manager, route: CONSOLE_ROUTES[10] },
      ];

      for (const { token, route } of forbidden) {
        const result = await api(ctx, route.path, {
          method: route.method,
          token,
          body: route.body === undefined ? undefined : JSON.stringify(route.body),
        });
        assert.equal(result.status, 403, `${route.method} ${route.path}`);
      }
    });
  });
});

test("org_a admin cannot see org_b rows on any console endpoint", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const token = await bearer(ctx, "user_admin_a");
      const leaked = [
        "org_b_only",
        "Team Bravo",
        "dev_bravo",
        "sub_bravo",
        "com.org.bravo",
        "bravo-code-plaintext",
        "admin:admin_b",
        "req_b",
        "BravoApp",
      ];

      const paths = [
        "/v1/admin/dashboard",
        "/v1/admin/teams",
        "/v1/admin/devices",
        "/v1/admin/enrollment",
        "/v1/admin/policies",
        "/v1/admin/audit",
        "/v1/admin/insight",
        "/v1/admin/system/health",
        "/v1/admin/subjects/sub_a",
      ];
      for (const path of paths) {
        const result = await api(ctx, path, { token });
        assert.equal(result.status, 200, path);
        assertNoScreenshots(result.body);
        for (const marker of leaked) {
          assert.equal(result.raw.includes(marker), false, `${path} leaked ${marker}`);
        }
      }

      const foreign = await api(ctx, "/v1/admin/subjects/sub_bravo", { token });
      assert.equal(foreign.status, 404);
      const views = await ctx.app.pool.query(
        `SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'view_subject_activity' AND target = 'sub_bravo'`
      );
      assert.equal(views.rows[0].n, 0);
    });
  });
});

test("empty org facts return zeros and empty arrays", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      const token = await bearer(ctx, "user_admin_a");

      const dashboard = await api(ctx, "/v1/admin/dashboard", { token });
      assert.equal(dashboard.status, 200);
      const stats = asRecord(dashboard.body);
      assertExactKeys(stats, DASHBOARD_KEYS);
      assert.equal(stats.coverageRate, 0);
      assert.equal(stats.onlineDevices, 0);
      assert.equal(stats.avgDelaySec, 0);
      assert.deepEqual(stats.categoryBreakdown, []);
      assert.deepEqual(stats.recentAlerts, []);

      const teams = await api(ctx, "/v1/admin/teams", { token });
      assert.equal(teams.status, 200);
      assert.deepEqual(teams.body, []);

      const devices = await api(ctx, "/v1/admin/devices", { token });
      assert.equal(devices.status, 200);
      assert.deepEqual(devices.body, []);

      const enrollment = await api(ctx, "/v1/admin/enrollment", { token });
      assert.equal(enrollment.status, 200);
      assert.deepEqual(enrollment.body, []);

      const policies = await api(ctx, "/v1/admin/policies", { token });
      assert.equal(policies.status, 200);
      assert.deepEqual(policies.body, []);

      const audit = await api(ctx, "/v1/admin/audit", { token });
      assert.equal(audit.status, 200);
      assert.deepEqual(audit.body, []);

      const insight = await api(ctx, "/v1/admin/insight", { token });
      assert.equal(insight.status, 200);
      const insightBody = asRecord(insight.body);
      assertExactKeys(insightBody, INSIGHT_RESPONSE_KEYS);
      assert.equal(insightBody.mode, "rules_only");
      assert.deepEqual(insightBody.reports, []);
      assert.deepEqual(insightBody.coverageGaps, []);
    });
  });
});

test("dashboard and teams query stored facts with exact keys", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const token = await bearer(ctx, "user_manager_a");

      const dashboard = await api(ctx, "/v1/admin/dashboard", { token });
      assert.equal(dashboard.status, 200);
      const stats = asRecord(dashboard.body);
      assertExactKeys(stats, DASHBOARD_KEYS);
      assert.equal(stats.coverageRate, 0.5);
      assert.equal(stats.onlineDevices, 3);
      assert.equal(typeof stats.avgDelaySec, "number");
      const categories = asArray(stats.categoryBreakdown);
      assert.equal(categories.length, 1);
      assertExactKeys(categories[0], ["category", "count", "total"]);
      assert.deepEqual(categories[0], { category: "development", count: 1, total: 2 });
      const alerts = asArray(stats.recentAlerts);
      for (const alert of alerts) {
        assertExactKeys(alert, ["id", "message", "severity", "ts"]);
      }

      const teams = await api(ctx, "/v1/admin/teams", { token });
      assert.equal(teams.status, 200);
      const teamRows = asArray(teams.body);
      assert.equal(teamRows.length, 1);
      assertExactKeys(teamRows[0], TEAM_SUMMARY_KEYS);
      assert.deepEqual(teamRows[0], {
        id: "team_alpha",
        name: "Team Alpha",
        memberCount: 1,
        coverageRate: 0.5,
        trend: "up",
      });
    });
  });
});

test("subject detail is org-scoped and audits only after authorization", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const before = await ctx.app.pool.query(
        `SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'view_subject_activity'`
      );

      const unauth = await api(ctx, "/v1/admin/subjects/sub_a");
      assert.equal(unauth.status, 401);

      const operator = await bearer(ctx, "user_operator_a");
      const forbidden = await api(ctx, "/v1/admin/subjects/sub_a", { token: operator });
      assert.equal(forbidden.status, 403);

      const adminA = await bearer(ctx, "user_admin_a");
      const missing = await api(ctx, "/v1/admin/subjects/sub_bravo", { token: adminA });
      assert.equal(missing.status, 404);

      const afterDenied = await ctx.app.pool.query(
        `SELECT COUNT(*)::int AS n FROM audit_logs WHERE action = 'view_subject_activity'`
      );
      assert.equal(afterDenied.rows[0].n, before.rows[0].n);

      const ok = await api(ctx, "/v1/admin/subjects/sub_a", { token: adminA });
      assert.equal(ok.status, 200);
      assertNoScreenshots(ok.body);
      const detail = asRecord(ok.body);
      assertExactKeys(detail, SUBJECT_DETAIL_KEYS);
      assert.equal(detail.id, "sub_a");
      assert.equal(detail.name, "Alice");
      assert.equal(detail.team, "Team Alpha");
      const timeline = asArray(detail.timeline);
      assert.ok(timeline.length >= 2);
      assertExactKeys(timeline[0], ["event", "ts"]);
      const days = asArray(detail.dailyAggregates);
      assert.equal(days.length, 1);
      assertExactKeys(days[0], ["activeMin", "apps", "date"]);
      assert.deepEqual(days[0], { date: utcDate(), activeMin: 60, apps: 1 });
      const gaps = asArray(detail.gaps);
      assert.ok(gaps.length >= 1);
      assertExactKeys(gaps[0], ["end", "reason", "start"]);
      const auditLog = asArray(detail.auditLog);
      assert.ok(auditLog.length >= 1);
      assertExactKeys(auditLog[0], ["action", "actor", "ts"]);

      const views = await ctx.app.pool.query(
        `SELECT actor, target FROM audit_logs WHERE action = 'view_subject_activity'`
      );
      assert.equal(views.rows.length, 1);
      assert.equal(views.rows[0].actor, "admin:admin_a");
      assert.equal(views.rows[0].target, "sub_a");
    });
  });
});

test("devices use the latest health sample and health mapping", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const token = await bearer(ctx, "user_manager_a");
      const result = await api(ctx, "/v1/admin/devices", { token });
      assert.equal(result.status, 200);
      const devices = asArray(result.body);
      assert.equal(devices.length, 5);
      const byId = new Map(devices.map((row) => [asRecord(row).id, asRecord(row)]));
      for (const row of devices) {
        assertExactKeys(row, DEVICE_KEYS);
        assert.notEqual(asRecord(row).id, "dev_bravo");
      }

      assert.equal(byId.get("dev_ok")?.lastHealth, "ok");
      assert.equal(byId.get("dev_ok")?.stale, false);
      assert.equal(byId.get("dev_ok")?.queueDepth, 2);
      assert.equal(byId.get("dev_ok")?.permissionsOk, true);

      assert.equal(byId.get("dev_perm")?.lastHealth, "degraded");
      assert.equal(byId.get("dev_perm")?.permissionsOk, false);
      assert.equal(byId.get("dev_perm")?.stale, false);

      assert.equal(byId.get("dev_queue")?.lastHealth, "degraded");
      assert.equal(byId.get("dev_queue")?.queueDepth, 250);

      assert.equal(byId.get("dev_stale")?.lastHealth, "offline");
      assert.equal(byId.get("dev_stale")?.stale, true);

      assert.equal(byId.get("dev_never")?.lastHealth, "offline");
      assert.equal(byId.get("dev_never")?.stale, true);
      assert.equal(byId.get("dev_never")?.lastSeen, null);
    });
  });
});

test("enrollment is single-use, hashed, and org-scoped", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const token = await bearer(ctx, "user_admin_a");

      const listed = await api(ctx, "/v1/admin/enrollment", { token });
      assert.equal(listed.status, 200);
      const existing = asArray(listed.body);
      assert.equal(existing.length, 1);
      const requiredKeys = [...ENROLLMENT_CODE_KEYS];
      assert.deepEqual(
        keysOf(existing[0]).filter((key) => key !== "usedBy").sort(),
        requiredKeys
      );
      assert.equal(asRecord(existing[0]).status, "active");
      assert.equal(JSON.stringify(existing[0]).includes("alpha-code-plaintext"), false);
      assert.equal(JSON.stringify(existing[0]).includes("bravo-code-plaintext"), false);
      assert.notEqual(asRecord(existing[0]).usedBy, "dev_bravo");

      const badTtl = await api(ctx, "/v1/admin/enrollment", {
        method: "POST",
        token,
        body: JSON.stringify({ subjectId: "sub_a", ttlHours: 25 }),
      });
      assert.equal(badTtl.status, 400);
      const fractional = await api(ctx, "/v1/admin/enrollment", {
        method: "POST",
        token,
        body: JSON.stringify({ subjectId: "sub_a", ttlHours: 1.5 }),
      });
      assert.equal(fractional.status, 400);
      const foreign = await api(ctx, "/v1/admin/enrollment", {
        method: "POST",
        token,
        body: JSON.stringify({ subjectId: "sub_bravo", ttlHours: 2 }),
      });
      assert.equal(foreign.status, 404);
      const withMaxUses = await api(ctx, "/v1/admin/enrollment", {
        method: "POST",
        token,
        body: JSON.stringify({ subjectId: "sub_a", ttlHours: 2, maxUses: 99 }),
      });
      assert.equal(withMaxUses.status, 201);
      const created = asRecord(withMaxUses.body);
      assertExactKeys(created, CREATED_ENROLLMENT_KEYS);
      const plaintext = String(created.code);
      assert.ok(plaintext.length >= 32);
      assert.equal(typeof created.expiresAt, "string");

      const stored = await ctx.app.pool.query(
        `SELECT code_hash, org_id, subject_id FROM enrollment_codes WHERE code_hash = $1`,
        [hashToken(plaintext)]
      );
      assert.equal(stored.rows.length, 1);
      assert.equal(stored.rows[0].org_id, "org_a");
      assert.equal(stored.rows[0].subject_id, "sub_a");
      const leakedPlain = await ctx.app.pool.query(`SELECT * FROM enrollment_codes`);
      assert.equal(JSON.stringify(leakedPlain.rows).includes(plaintext), false);

      const listedAfter = await api(ctx, "/v1/admin/enrollment", { token });
      assert.equal(JSON.stringify(listedAfter.body).includes(plaintext), false);
      assert.equal(JSON.stringify(listedAfter.body).includes("maxUses"), false);

      const first = await fetch(ctx.url + "/v1/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollment_code: plaintext, agent_version: "0.1.1", os: "macos" }),
      });
      assert.equal(first.status, 201);
      const second = await fetch(ctx.url + "/v1/enroll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enrollment_code: plaintext, agent_version: "0.1.1", os: "macos" }),
      });
      assert.equal(second.status, 409);
    });
  });
});

test("policy create validates collection keys, signs, and writes audit", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      const token = await bearer(ctx, "user_admin_a");

      const unknown = await api(ctx, "/v1/admin/policies", {
        method: "POST",
        token,
        body: JSON.stringify({ content: JSON.stringify({ screenshotInterval: 300 }), rolloutPercent: 10 }),
      });
      assert.equal(unknown.status, 400);
      const forbidden = await api(ctx, "/v1/admin/policies", {
        method: "POST",
        token,
        body: JSON.stringify({
          content: JSON.stringify({ collection_enabled: true, keylogging: true }),
          rolloutPercent: 10,
        }),
      });
      assert.equal(forbidden.status, 400);
      const extra = await api(ctx, "/v1/admin/policies", {
        method: "POST",
        token,
        body: JSON.stringify({
          content: JSON.stringify({ collection_enabled: true, unknown_flag: true }),
          rolloutPercent: 10,
        }),
      });
      assert.equal(extra.status, 400);
      const badRollout = await api(ctx, "/v1/admin/policies", {
        method: "POST",
        token,
        body: JSON.stringify({ content: VALID_POLICY, rolloutPercent: 101 }),
      });
      assert.equal(badRollout.status, 400);
      const invalidJson = await api(ctx, "/v1/admin/policies", {
        method: "POST",
        token,
        body: JSON.stringify({ content: "{", rolloutPercent: 10 }),
      });
      assert.equal(invalidJson.status, 400);

      const created = await api(ctx, "/v1/admin/policies", {
        method: "POST",
        token,
        body: JSON.stringify({ content: VALID_POLICY, rolloutPercent: 35 }),
      });
      assert.equal(created.status, 201);
      assertNoScreenshots(created.body);
      const policy = asRecord(created.body);
      assertExactKeys(policy, POLICY_KEYS);
      assert.equal(policy.version, 1);
      assert.equal(policy.rolloutPercent, 35);
      assert.equal(typeof policy.content, "string");
      assert.equal(String(policy.content).includes("screenshot"), false);

      const stored = await ctx.app.pool.query(
        `SELECT policy_version, payload, signature FROM collection_policies WHERE org_id = 'org_a'`
      );
      assert.equal(stored.rows.length, 1);
      assert.ok(typeof stored.rows[0].signature === "string" && stored.rows[0].signature.length > 0);
      const logs = await ctx.app.pool.query(
        `SELECT action, target FROM audit_logs WHERE action = 'create_policy'`
      );
      assert.equal(logs.rows.length, 1);

      const listed = await api(ctx, "/v1/admin/policies", { token });
      assert.equal(listed.status, 200);
      const rows = asArray(listed.body);
      assert.equal(rows.length, 1);
      assertExactKeys(rows[0], POLICY_KEYS);
    });
  });
});

test("audit list does not treat a policy version as a same-org subject id", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await ctx.app.pool.query(
        `INSERT INTO subjects (subject_id, org_id, display_name) VALUES ('1','org_a','Numeric Alice')`
      );
      await ctx.app.pool.query(
        `INSERT INTO audit_logs (actor, action, target, detail)
         VALUES ('admin:admin_b','create_policy','1','{"requestId":"req_policy_b"}')`
      );
      const token = await bearer(ctx, "user_admin_a");
      const result = await api(ctx, "/v1/admin/audit", { token });
      assert.equal(result.status, 200);
      const rows = asArray(result.body);
      assert.equal(
        rows.some((row) => asRecord(row).actor === "admin:admin_b"),
        false
      );
      assert.equal(
        rows.some((row) => asRecord(row).requestId === "req_policy_b"),
        false
      );
      assert.equal(result.raw.includes("req_policy_b"), false);
    });
  });
});

test("signed collection policy sent to devices does not include rollout_percent", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await ctx.app.pool.query(
        `INSERT INTO device_credentials (device_id, org_id, subject_id, token_hash, expires_at)
         VALUES ('dev_policy','org_a','sub_a',$1, now() + interval '30 days')`,
        [hashToken("token_policy")]
      );
      const token = await bearer(ctx, "user_admin_a");
      const created = await api(ctx, "/v1/admin/policies", {
        method: "POST",
        token,
        body: JSON.stringify({ content: VALID_POLICY, rolloutPercent: 35 }),
      });
      assert.equal(created.status, 201);
      assert.equal(asRecord(created.body).rolloutPercent, 35);

      const stored = await ctx.app.pool.query(
        `SELECT payload, signature FROM collection_policies WHERE org_id = 'org_a'`
      );
      assert.equal(stored.rows.length, 1);
      const payload = stored.rows[0].payload as Record<string, unknown>;
      const collection =
        payload.collection && typeof payload.collection === "object" && !Array.isArray(payload.collection)
          ? (payload.collection as Record<string, unknown>)
          : payload;
      assert.equal(Object.hasOwn(collection, "rollout_percent"), false);

      const devicePol = await fetch(ctx.url + "/v1/device-policy", {
        headers: { authorization: "Bearer token_policy" },
      });
      const deviceRaw = await devicePol.text();
      assert.equal(devicePol.status, 200, deviceRaw);
      const deviceBody = asRecord(JSON.parse(deviceRaw));
      const devicePolicy = asRecord(deviceBody.policy);
      assert.equal(Object.hasOwn(devicePolicy, "rollout_percent"), false);
      assert.equal(Object.hasOwn(devicePolicy, "collection"), false);

      const listed = await api(ctx, "/v1/admin/policies", { token });
      assert.equal(asRecord(asArray(listed.body)[0]).rolloutPercent, 35);
    });
  });
});

test("flat device-policy payload keeps the signed blob including rollout_percent", async () => {
  const key = generatePolicyKeyPair();
  const flat = {
    policy_version: 1,
    collection_enabled: true,
    window_title_enabled: false,
    idle_after_seconds: 300,
    blocked_apps: ["com.1password.1password"],
    blocked_domains: ["onepassword.com"],
    issued_at: "2026-08-10T00:00:00.000Z",
    expires_at: "2026-08-17T00:00:00.000Z",
    rollout_percent: 40,
  };
  const signed = signPolicy(flat, key.privateKeyPem);

  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(
      schema,
      async (ctx) => {
        await seedIdentities(ctx.app.pool);
        await ctx.app.pool.query(
          `INSERT INTO device_credentials (device_id, org_id, subject_id, token_hash, expires_at)
           VALUES ('dev_flat_policy','org_a','sub_a',$1, now() + interval '30 days')`,
          [hashToken("token_flat_policy")]
        );
        await ctx.app.pool.query(
          `INSERT INTO collection_policies (policy_version, org_id, payload, signature, signing_key_fingerprint)
           VALUES (1,'org_a',$1,$2,$3)`,
          [JSON.stringify(flat), signed.signature, key.fingerprint]
        );

        const resp = await fetch(ctx.url + "/v1/device-policy", {
          headers: { authorization: "Bearer token_flat_policy" },
        });
        const raw = await resp.text();
        assert.equal(resp.status, 200, raw);
        const body = asRecord(JSON.parse(raw));
        const policy = asRecord(body.policy);
        assert.equal(policy.rollout_percent, 40);
        assert.equal(typeof body.signature, "string");
        assert.equal(verifyPolicy(body.policy, String(body.signature), key.publicKeyPem), true);
        assert.equal(verifyPolicy(body.policy, String(body.signature), String(body.signing_public_key)), true);
      },
      {
        policyPrivateKeyPem: key.privateKeyPem,
        policyPublicKeyPem: key.publicKeyPem,
        policyFingerprint: key.fingerprint,
      }
    );
  });
});

test("audit filters are bound, org-scoped, and exact-keyed", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const token = await bearer(ctx, "user_auditor_a");

      const all = await api(ctx, "/v1/admin/audit", { token });
      assert.equal(all.status, 200);
      const rows = asArray(all.body);
      assert.ok(rows.length >= 1);
      assertExactKeys(rows[0], AUDIT_ENTRY_KEYS);
      assert.equal(
        rows.some((row) => asRecord(row).actor === "admin:admin_b"),
        false
      );
      assert.equal(
        rows.some((row) => asRecord(row).target === "sub_bravo"),
        false
      );

      const filtered = await api(ctx, "/v1/admin/audit?actor=admin:admin_a&action=create_subject", {
        token,
      });
      assert.equal(filtered.status, 200);
      const filteredRows = asArray(filtered.body);
      assert.ok(filteredRows.length >= 1);
      for (const row of filteredRows) {
        const rec = asRecord(row);
        assert.equal(rec.actor, "admin:admin_a");
        assert.equal(rec.action, "create_subject");
      }

      const injection = await api(
        ctx,
        "/v1/admin/audit?action=create_subject'%20OR%201=1--",
        { token }
      );
      assert.equal(injection.status, 200);
      assert.deepEqual(injection.body, []);
    });
  });
});

test("insight stays rules_only with empty reports", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const token = await bearer(ctx, "user_admin_a");
      const result = await api(ctx, "/v1/admin/insight", { token });
      assert.equal(result.status, 200);
      const body = asRecord(result.body);
      assertExactKeys(body, INSIGHT_RESPONSE_KEYS);
      assert.equal(body.mode, "rules_only");
      assert.equal(body.reason, "model reports unavailable");
      assert.deepEqual(body.reports, []);
      const gaps = asArray(body.coverageGaps);
      for (const gap of gaps) {
        assertExactKeys(gap, ["missingDays", "team"]);
        assert.notEqual(asRecord(gap).team, "Team Bravo");
      }
      const quality = asArray(body.dataQuality);
      for (const row of quality) {
        assertExactKeys(row, ["metric", "status", "value"]);
      }
    });
  });
});

test("insight returns persisted reports as mode ai without calling a model", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const today = utcDate();
      const generatedAt = new Date().toISOString();
      const output = {
        summary: "Team focused on development.",
        findings: [
          {
            title: "Development time",
            explanation: "Most active seconds were development.",
            evidence: [
              {
                name: "development_seconds",
                value: 3600,
                unit: "seconds",
                periodStart: `${today}T00:00:00.000Z`,
                periodEnd: `${today}T23:59:59.000Z`,
              },
            ],
            recommendation: "Keep focus blocks",
            confidence: 0.8,
          },
        ],
        provider: "deepseek",
        model: "deepseek-chat",
        generatedAt,
      };
      const foreign = {
        ...output,
        summary: "org_b_only insight must stay hidden",
      };
      await ctx.app.pool.query(
        `INSERT INTO insight_reports
           (org_id, team_id, date, provider, model, output, evidence_snapshot_hash, generated_at)
         VALUES
           ('org_a','team_alpha',$1,'deepseek','deepseek-chat',$2,'hash_a', $3),
           ('org_b','team_bravo',$1,'deepseek','deepseek-chat',$4,'hash_b', $3)`,
        [today, JSON.stringify(output), generatedAt, JSON.stringify(foreign)]
      );
      await ctx.app.pool.query(
        `INSERT INTO insight_reports
           (org_id, team_id, date, provider, model, output, evidence_snapshot_hash, generated_at)
         VALUES ('org_a','team_alpha',$1,'deepseek','deepseek-chat',$2,'hash_invalid', $3)`,
        [
          utcDate(-1),
          JSON.stringify({
            ...output,
            findings: [{ ...output.findings[0], evidence: [] }],
          }),
          generatedAt,
        ]
      );

      const token = await bearer(ctx, "user_admin_a");
      const result = await api(ctx, "/v1/admin/insight", { token });
      assert.equal(result.status, 200);
      const body = asRecord(result.body);
      assertExactKeys(body, INSIGHT_RESPONSE_KEYS);
      assert.equal(body.mode, "ai");
      assert.equal(body.reason, null);
      const reports = asArray(body.reports);
      assert.equal(reports.length, 1);
      const report = asRecord(reports[0]);
      assert.equal(report.summary, "Team focused on development.");
      assert.equal(report.provider, "deepseek");
      assert.equal(report.model, "deepseek-chat");
      assert.equal(result.raw.includes("org_b_only insight must stay hidden"), false);
      assert.equal(result.raw.includes("deepseek.com"), false);

      const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/routes/admin-console.ts"), "utf8");
      assert.equal(src.includes("DEEPSEEK_API_KEY"), false);
      assert.equal(src.includes("chat/completions"), false);
      assert.equal(src.includes("api.deepseek.com"), false);
    });
  });
});

test("system health queries live state and does not hard-code worker ok", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seedIdentities(ctx.app.pool);
      await seedFacts(ctx.app.pool);
      const token = await bearer(ctx, "user_operator_a");

      const missing = await api(ctx, "/v1/admin/system/health", { token });
      assert.equal(missing.status, 200);
      const missingBody = asRecord(missing.body);
      assertExactKeys(missingBody, SYSTEM_HEALTH_KEYS);
      assertExactKeys(missingBody.api, ["latencyMs", "status"]);
      assertExactKeys(missingBody.worker, ["lastRun", "status"]);
      assertExactKeys(missingBody.database, ["connected", "latencyMs"]);
      const missingWorker = asRecord(missingBody.worker);
      assert.notEqual(missingWorker.status, "ok");
      assert.equal(missingWorker.lastRun, null);
      assert.equal(asRecord(missingBody.database).connected, true);
      const queues = asArray(missingBody.queues);
      for (const queue of queues) {
        assertExactKeys(queue, ["depth", "name"]);
      }

      await ctx.app.pool.query(
        `INSERT INTO worker_watermarks (job_name, last_processed_at, updated_at)
         VALUES ('aggregator', now() - interval '2 hours', now() - interval '2 hours')`
      );
      const stale = await api(ctx, "/v1/admin/system/health", { token });
      assert.equal(asRecord(asRecord(stale.body).worker).status, "stale");

      await ctx.app.pool.query(
        `UPDATE worker_watermarks SET last_processed_at = now(), updated_at = now() WHERE job_name = 'aggregator'`
      );
      const fresh = await api(ctx, "/v1/admin/system/health", { token });
      const freshWorker = asRecord(asRecord(fresh.body).worker);
      assert.equal(freshWorker.status, "ok");
      assert.equal(typeof freshWorker.lastRun, "string");
    });
  });
});
