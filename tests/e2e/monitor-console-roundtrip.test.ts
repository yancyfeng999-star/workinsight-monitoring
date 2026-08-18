import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPasswordArgon2id } from "../../apps/api/src/auth/password.ts";

const DB_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://workinsight:workinsight_dev@localhost:5433/workinsight_test";
const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080";
const WEB_BASE = process.env.E2E_WEB_BASE ?? "http://127.0.0.1:3000";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const WORKER_DIR = resolve(ROOT, "apps/worker");

function recentRange(offsetMinutes, durationMinutes = 5) {
  const startedMs = Date.now() - offsetMinutes * 60_000;
  return {
    started: new Date(startedMs).toISOString(),
    ended: new Date(startedMs + durationMinutes * 60_000).toISOString(),
  };
}

function utcDate(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

function focusEvent({ eventId, seq, started, ended, orgId, deviceId, subjectId, source, appId, appName, domain, browser }) {
  return {
    schema_version: 1,
    event_id: eventId,
    org_id: orgId,
    device_id: deviceId,
    subject_id: subjectId,
    sequence_no: seq,
    source,
    kind: "focus_segment",
    started_at: started,
    ended_at: ended,
    timezone: "UTC",
    activity: {
      app_id: appId,
      app_name: appName,
      window_title: null,
      browser,
      registrable_domain: domain,
      url_path: null,
    },
    privacy: "normal",
    agent: { version: "0.1.2", os: "macos" },
  };
}

function cookieValue(setCookies, name) {
  for (const header of setCookies) {
    if (typeof header !== "string") continue;
    const first = header.split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    if (first.slice(0, eq).trim() !== name) continue;
    return first.slice(eq + 1);
  }
  return null;
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

async function jsonFetch(url, init = {}) {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const resp = await fetch(url, { ...init, headers });
  const raw = await resp.text();
  let body = raw;
  try {
    body = raw.length === 0 ? null : JSON.parse(raw);
  } catch {
    body = raw;
  }
  return { status: resp.status, body, raw, headers: resp.headers, cookies: getSetCookies(resp.headers) };
}

async function waitFor(url, timeoutMs = 30_000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(url);
      if (resp.ok || resp.status === 401 || resp.status === 404) return;
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}: ${lastErr}`);
}

function runWorkerOnce() {
  return new Promise((resolveOnce, reject) => {
    const env = { ...process.env, DATABASE_URL: DB_URL };
    delete env.DEEPSEEK_API_KEY;
    const child = spawn("npm", ["run", "dev", "--", "--once"], {
      cwd: WORKER_DIR,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`worker --once timed out\n${stdout}\n${stderr}`));
    }, 90_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`worker --once exited ${code}\n${stdout}\n${stderr}`));
        return;
      }
      resolveOnce({ stdout, stderr, code });
    });
  });
}

async function deleteOrg(pool, orgId) {
  const devices = await pool.query("SELECT device_id FROM devices WHERE org_id = $1", [orgId]);
  const deviceIds = devices.rows.map((row) => row.device_id);
  const subjects = await pool.query("SELECT subject_id FROM subjects WHERE org_id = $1", [orgId]);
  const subjectIds = subjects.rows.map((row) => row.subject_id);
  const admins = await pool.query("SELECT admin_user_id, username FROM admin_users WHERE org_id = $1", [orgId]);
  const adminIds = admins.rows.map((row) => row.admin_user_id);
  const actors = [
    ...admins.rows.map((row) => "admin:" + row.username),
    ...deviceIds.map((id) => "device:" + id),
  ];

  await pool.query("DELETE FROM insight_reports WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM insight_jobs WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM team_summaries WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM daily_aggregates WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM activity_classifications WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM activity_segments WHERE org_id = $1", [orgId]);
  if (deviceIds.length > 0) {
    await pool.query("DELETE FROM agent_health_samples WHERE device_id = ANY($1)", [deviceIds]);
    await pool.query("DELETE FROM device_credentials WHERE device_id = ANY($1)", [deviceIds]);
    await pool.query("DELETE FROM devices WHERE device_id = ANY($1)", [deviceIds]);
  }
  if (subjectIds.length > 0) {
    await pool.query("DELETE FROM team_memberships WHERE subject_id = ANY($1)", [subjectIds]);
  }
  if (actors.length > 0) {
    await pool.query("DELETE FROM audit_logs WHERE actor = ANY($1)", [actors]);
  }
  if (subjectIds.length > 0) {
    await pool.query("DELETE FROM audit_logs WHERE target = ANY($1)", [subjectIds]);
  }
  if (adminIds.length > 0) {
    await pool.query("DELETE FROM admin_sessions WHERE admin_user_id = ANY($1)", [adminIds]);
    await pool.query("DELETE FROM admin_users WHERE admin_user_id = ANY($1)", [adminIds]);
  }
  await pool.query("DELETE FROM enrollment_codes WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM collection_policies WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM teams WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM subjects WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM organizations WHERE org_id = $1", [orgId]);
}

test(
  "monitor-side slice: enroll -> upload -> worker -> web login -> dashboard/subject/insight",
  { timeout: 180_000 },
  async () => {
    await waitFor(`${API_BASE}/v1/health`);
    await waitFor(`${WEB_BASE}/login`);

    const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
    const orgA = `org_mon_${suffix}`;
    const orgB = `org_decoy_${suffix}`;
    const subjectA = `sub_mon_${suffix}`;
    const subjectB = `sub_decoy_${suffix}`;
    const teamA = `team_mon_${suffix}`;
    const teamB = `team_decoy_${suffix}`;
    const adminId = `adm_mon_${suffix}`;
    const username = `adm_mon_${suffix}`;
    const password = `Pw_${suffix}_e2e!`;
    const subjectName = `Monitor Slice ${suffix}`;
    const teamName = `Engineering ${suffix}`;
    const insightSummary = `e2e-fake-insight-${suffix}`;
    const padIds = [1, 2, 3, 4].map((n) => `sub_pad${n}_${suffix}`);
    const today = utcDate(0);

    const pool = new pg.Pool({ connectionString: DB_URL });
    let cleaned = false;
    const cleanup = async () => {
      if (cleaned) return;
      cleaned = true;
      await deleteOrg(pool, orgA);
      await deleteOrg(pool, orgB);
    };

    try {
      await pool.query("INSERT INTO organizations (org_id, name) VALUES ($1,$2), ($3,$4)", [
        orgA,
        `Monitor A ${suffix}`,
        orgB,
        `Decoy B ${suffix}`,
      ]);
      await pool.query(
        `INSERT INTO subjects (subject_id, org_id, display_name) VALUES
           ($1,$2,$3), ($4,$5,$6), ($7,$2,$8), ($9,$2,$10), ($11,$2,$12), ($13,$2,$14)`,
        [
          subjectA,
          orgA,
          subjectName,
          subjectB,
          orgB,
          `Decoy Subject ${suffix}`,
          padIds[0],
          `Pad 1 ${suffix}`,
          padIds[1],
          `Pad 2 ${suffix}`,
          padIds[2],
          `Pad 3 ${suffix}`,
          padIds[3],
          `Pad 4 ${suffix}`,
        ]
      );
      await pool.query("INSERT INTO teams (team_id, org_id, name) VALUES ($1,$2,$3), ($4,$5,$6)", [
        teamA,
        orgA,
        teamName,
        teamB,
        orgB,
        `Decoy Team ${suffix}`,
      ]);
      await pool.query(
        `INSERT INTO team_memberships (team_id, subject_id) VALUES
           ($1,$2), ($1,$3), ($1,$4), ($1,$5), ($1,$6), ($7,$8)`,
        [teamA, subjectA, padIds[0], padIds[1], padIds[2], padIds[3], teamB, subjectB]
      );
      await pool.query(
        `INSERT INTO admin_users (admin_user_id, org_id, username, password_hash, role)
         VALUES ($1,$2,$3,$4,'company_admin')`,
        [adminId, orgA, username, await hashPasswordArgon2id(password)]
      );

      const codeA = "e2e-mon-a-" + suffix;
      const codeB = "e2e-mon-b-" + suffix;
      await pool.query(
        `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at)
         VALUES ($1,$2,$3, now() + interval '15 minutes'),
                ($4,$5,$6, now() + interval '15 minutes')`,
        [
          createHash("sha256").update(codeA).digest("hex"),
          orgA,
          subjectA,
          createHash("sha256").update(codeB).digest("hex"),
          orgB,
          subjectB,
        ]
      );

      const enrollA = await jsonFetch(`${API_BASE}/v1/enroll`, {
        method: "POST",
        body: JSON.stringify({
          enrollment_code: codeA,
          agent_version: "0.1.2",
          os: "macos",
          device_label: "monitor-slice",
        }),
      });
      assert.equal(enrollA.status, 201);
      assert.equal(enrollA.body.org_id, orgA);
      assert.equal(enrollA.body.subject_id, subjectA);
      assert.ok(enrollA.body.device_token);
      const deviceA = enrollA.body.device_id;
      const tokenA = enrollA.body.device_token;

      const enrollB = await jsonFetch(`${API_BASE}/v1/enroll`, {
        method: "POST",
        body: JSON.stringify({
          enrollment_code: codeB,
          agent_version: "0.1.2",
          os: "macos",
          device_label: "decoy",
        }),
      });
      assert.equal(enrollB.status, 201);
      const deviceB = enrollB.body.device_id;
      const tokenB = enrollB.body.device_token;

      const xcodeRange = recentRange(60);
      const chromeRange = recentRange(20);
      const decoyRange = recentRange(30);
      const xcodeEvent = focusEvent({
        eventId: `evt_${suffix}_a1`,
        seq: 1,
        started: xcodeRange.started,
        ended: xcodeRange.ended,
        orgId: orgA,
        deviceId: deviceA,
        subjectId: subjectA,
        source: "system",
        appId: "com.apple.dt.Xcode",
        appName: "Xcode",
        domain: null,
        browser: null,
      });
      const chromeEvent = focusEvent({
        eventId: `evt_${suffix}_a2`,
        seq: 2,
        started: chromeRange.started,
        ended: chromeRange.ended,
        orgId: orgA,
        deviceId: deviceA,
        subjectId: subjectA,
        source: "browser",
        appId: "com.google.Chrome",
        appName: "Chrome",
        domain: "github.com",
        browser: "chrome",
      });
      const decoyEvent = focusEvent({
        eventId: `evt_${suffix}_b1`,
        seq: 1,
        started: decoyRange.started,
        ended: decoyRange.ended,
        orgId: orgB,
        deviceId: deviceB,
        subjectId: subjectB,
        source: "system",
        appId: "com.spotify.client",
        appName: "Spotify",
        domain: null,
        browser: null,
      });

      const uploadA = await jsonFetch(`${API_BASE}/v1/activity-batches`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ events: [xcodeEvent, chromeEvent] }),
      });
      assert.equal(uploadA.status, 200);
      assert.equal(uploadA.body.accepted.length, 2);
      assert.equal(uploadA.body.rejected.length, 0);

      const replay = await jsonFetch(`${API_BASE}/v1/activity-batches`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({ events: [xcodeEvent] }),
      });
      assert.equal(replay.status, 200);
      assert.equal(replay.body.accepted.length, 1);
      assert.equal(replay.body.rejected.length, 0);
      const replayed = await pool.query(
        `SELECT COUNT(*)::int AS n FROM activity_segments WHERE org_id = $1 AND device_id = $2`,
        [orgA, deviceA]
      );
      assert.equal(replayed.rows[0].n, 2, "replay must stay idempotent");

      const uploadB = await jsonFetch(`${API_BASE}/v1/activity-batches`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenB}` },
        body: JSON.stringify({ events: [decoyEvent] }),
      });
      assert.equal(uploadB.status, 200);
      assert.equal(uploadB.body.accepted.length, 1);

      const health = await jsonFetch(`${API_BASE}/v1/health-samples`, {
        method: "POST",
        headers: { authorization: `Bearer ${tokenA}` },
        body: JSON.stringify({
          health: [
            {
              device_id: deviceA,
              agent_version: "0.1.2",
              os: "macos",
              collected_at: new Date().toISOString(),
              queue_depth: 0,
              permissions_ok: true,
              autostart_enabled: true,
            },
          ],
        }),
      });
      assert.equal(health.status, 200);
      assert.equal(health.body.accepted, 1);

      const worker = await runWorkerOnce();
      assert.match(worker.stdout, /classifier done: \d+ classified/);
      assert.match(worker.stdout, /aggregator done: \d+ aggregates/);
      assert.match(worker.stdout, /insight done: .*fallback=rules_only/);

      const classA = await pool.query(
        `SELECT event_id, category, subcategory FROM activity_classifications
         WHERE org_id = $1 ORDER BY event_id`,
        [orgA]
      );
      assert.deepEqual(
        classA.rows.map((row) => [row.event_id, row.category, row.subcategory]),
        [
          [`evt_${suffix}_a1`, "development", "ide"],
          [`evt_${suffix}_a2`, "browser", "web"],
        ]
      );
      const classB = await pool.query(
        `SELECT event_id, category FROM activity_classifications WHERE org_id = $1`,
        [orgB]
      );
      assert.deepEqual(classB.rows, [{ event_id: `evt_${suffix}_b1`, category: "entertainment" }]);
      const leakedClass = await pool.query(
        `SELECT COUNT(*)::int AS n FROM activity_classifications
         WHERE org_id = $1 AND category = 'entertainment'`,
        [orgA]
      );
      assert.equal(leakedClass.rows[0].n, 0);

      const aggA = await pool.query(
        `SELECT category, app_id, total_seconds::int AS total_seconds, segment_count::int AS segment_count
         FROM daily_aggregates WHERE org_id = $1 AND date = $2::date ORDER BY category`,
        [orgA, today]
      );
      assert.deepEqual(
        aggA.rows.map((row) => ({
          category: row.category,
          app_id: row.app_id,
          total_seconds: row.total_seconds,
          segment_count: row.segment_count,
        })),
        [
          { category: "browser", app_id: "com.google.Chrome", total_seconds: 300, segment_count: 1 },
          { category: "development", app_id: "com.apple.dt.Xcode", total_seconds: 300, segment_count: 1 },
        ]
      );
      const aggB = await pool.query(
        `SELECT category, total_seconds::int AS total_seconds FROM daily_aggregates
         WHERE org_id = $1 AND date = $2::date`,
        [orgB, today]
      );
      assert.deepEqual(aggB.rows, [{ category: "entertainment", total_seconds: 300 }]);

      const { runSummarizer } = await import("../../apps/worker/src/jobs/summarizer.ts");
      const {
        createPostgresInsightStore,
        loadCompletedSnapshots,
        processInsightSnapshots,
      } = await import("../../apps/worker/src/jobs/insight.ts");
      const todaySummary = await runSummarizer(pool, today);
      assert.equal(
        todaySummary.summaries.some((row) => row.org_id === orgA && row.team_id === teamA),
        true
      );
      assert.equal(
        todaySummary.summaries.some((row) => row.org_id === orgB),
        false
      );
      const teamRow = todaySummary.summaries.find((row) => row.team_id === teamA);
      assert.equal(teamRow.member_count, 5);
      assert.equal(teamRow.avg_active_seconds, 600);
      assert.equal(teamRow.top_categories.development, 300);
      assert.equal(teamRow.top_categories.browser, 300);

      const snapshots = (await loadCompletedSnapshots(pool, today)).filter((row) => row.orgId === orgA);
      assert.equal(snapshots.length, 1);
      assert.equal(snapshots[0].activeSeconds, 600);
      const fakeProvider = {
        async generate(input) {
          return {
            summary: insightSummary,
            findings: [
              {
                title: "Seeded development and browser time",
                explanation: "Xcode and Chrome/github.com segments produced these category totals.",
                evidence: [
                  {
                    name: "active_seconds",
                    value: input.activeSeconds,
                    unit: "seconds",
                    periodStart: input.periodStart,
                    periodEnd: input.periodEnd,
                  },
                ],
                recommendation: "Keep the monitor-side rules path, then attach model reports.",
                confidence: 0.81,
              },
            ],
            provider: "deepseek",
            model: "fake-e2e",
            generatedAt: new Date().toISOString(),
          };
        },
      };
      const insightJob = await processInsightSnapshots(
        snapshots,
        fakeProvider,
        createPostgresInsightStore(pool),
        new AbortController().signal
      );
      assert.equal(insightJob.succeeded, 1);
      assert.equal(insightJob.failed, 0);

      const reportRows = await pool.query(
        `SELECT org_id, team_id, model, output->>'summary' AS summary
         FROM insight_reports WHERE org_id IN ($1,$2)`,
        [orgA, orgB]
      );
      assert.equal(reportRows.rows.length, 1);
      assert.equal(reportRows.rows[0].org_id, orgA);
      assert.equal(reportRows.rows[0].team_id, teamA);
      assert.equal(reportRows.rows[0].model, "fake-e2e");
      assert.equal(reportRows.rows[0].summary, insightSummary);

      const login = await jsonFetch(`${WEB_BASE}/api/v1/admin/login`, {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.org_id, orgA);
      assert.equal(login.body.user.username, username);
      assert.equal(login.body.user.role, "company_admin");
      assert.equal(Object.hasOwn(login.body, "token"), false);
      const session = cookieValue(login.cookies, "wi_session");
      assert.ok(session, "web login must preserve wi_session");
      const sessionCookie = `wi_session=${session}`;

      const unauth = await jsonFetch(`${WEB_BASE}/api/v1/admin/dashboard`);
      assert.equal(unauth.status, 401);

      const dashboard = await jsonFetch(`${WEB_BASE}/api/v1/admin/dashboard`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(dashboard.status, 200);
      assert.equal(dashboard.body.coverageRate, 0.2);
      assert.equal(dashboard.body.onlineDevices, 1);
      assert.equal(typeof dashboard.body.avgDelaySec, "number");
      const categories = new Map(dashboard.body.categoryBreakdown.map((row) => [row.category, row]));
      assert.deepEqual(categories.get("development"), { category: "development", count: 1, total: 5 });
      assert.deepEqual(categories.get("browser"), { category: "browser", count: 1, total: 5 });
      assert.equal(categories.has("entertainment"), false);
      assert.equal(dashboard.raw.includes("Spotify"), false);
      assert.equal(dashboard.raw.includes(orgB), false);

      const devices = await jsonFetch(`${WEB_BASE}/api/v1/admin/devices`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(devices.status, 200);
      assert.equal(devices.body.length, 1);
      assert.equal(devices.body[0].id, deviceA);
      assert.equal(devices.body[0].os, "macos");
      assert.equal(devices.body[0].agentVersion, "0.1.2");
      assert.equal(devices.body[0].lastHealth, "ok");
      assert.equal(devices.body[0].stale, false);
      assert.equal(devices.body[0].permissionsOk, true);
      assert.equal(
        devices.body.some((row) => row.id === deviceB),
        false
      );

      const subject = await jsonFetch(`${WEB_BASE}/api/v1/admin/subjects/${subjectA}`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(subject.status, 200);
      assert.equal(subject.body.id, subjectA);
      assert.equal(subject.body.name, subjectName);
      assert.equal(subject.body.team, teamName);
      assert.deepEqual(new Set(subject.body.timeline.map((row) => row.event)), new Set(["Chrome", "Xcode"]));
      assert.ok(
        subject.body.dailyAggregates.some((row) => row.date === today && row.activeMin === 10 && row.apps === 2)
      );
      assert.ok(
        subject.body.gaps.some((row) => row.reason === "no_activity"),
        "60-minute and 20-minute segments should leave a >=30m gap"
      );
      assert.equal(subject.raw.includes("Spotify"), false);

      const hidden = await jsonFetch(`${WEB_BASE}/api/v1/admin/subjects/${subjectB}`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(hidden.status, 404);

      const insight = await jsonFetch(`${WEB_BASE}/api/v1/admin/insight`, {
        headers: { cookie: sessionCookie },
      });
      assert.equal(insight.status, 200);
      assert.equal(insight.body.mode, "ai");
      assert.equal(insight.body.reason, null);
      assert.equal(insight.body.reports.length, 1);
      assert.equal(insight.body.reports[0].summary, insightSummary);
      assert.equal(insight.body.reports[0].provider, "deepseek");
      assert.equal(insight.body.reports[0].model, "fake-e2e");
      assert.equal(insight.body.reports[0].findings[0].evidence[0].value, 600);
      assert.equal(insight.raw.includes("org_b_only"), false);
      assert.equal(insight.raw.includes("Spotify"), false);
      assert.ok(insight.body.coverageGaps.some((row) => row.team === teamName && row.missingDays > 0));

      await cleanup();
    } finally {
      try {
        await cleanup();
      } finally {
        await pool.end();
      }
    }
  }
);
