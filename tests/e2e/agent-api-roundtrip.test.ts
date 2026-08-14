import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import pg from "pg";

const DB_URL = process.env.E2E_DATABASE_URL ?? "postgres://workinsight:workinsight_dev@localhost:5433/workinsight_test";
const API_BASE = process.env.E2E_API_BASE ?? "http://127.0.0.1:8080";

function validEvent(seq, started, ended, orgId, deviceId, subjectId) {
  return {
    schema_version: 1,
    event_id: `evt_e2e_${seq}`,
    org_id: orgId,
    device_id: deviceId,
    subject_id: subjectId,
    sequence_no: seq,
    source: "system",
    kind: "focus_segment",
    started_at: started,
    ended_at: ended,
    timezone: "UTC",
    activity: { app_id: "com.apple.Xcode", app_name: "Xcode", window_title: null, browser: null, registrable_domain: null, url_path: null },
    privacy: "normal",
    agent: { version: "0.1.1", os: "macos" },
  };
}

test("full roundtrip: enroll -> upload -> ack -> DB -> exact delete", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const orgId = `org_e2e_${suffix}`;
  const subjectId = `sub_e2e_${suffix}`;
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("INSERT INTO organizations (org_id, name) VALUES ($1,'E2E')", [orgId]);
    await client.query("INSERT INTO subjects (subject_id, org_id, display_name) VALUES ($1,$2,'E2E Subject')", [subjectId, orgId]);
    const code = "e2e-code-" + randomUUID().slice(0, 8);
    const codeHash = createHash("sha256").update(code).digest("hex");
    await client.query(
      `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at)
       VALUES ($1,$2,$3, now() + interval '15 minutes')`,
      [codeHash, orgId, subjectId]
    );

    const enrollResp = await fetch(`${API_BASE}/v1/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollment_code: code, agent_version: "0.1.1", os: "macos", device_label: "e2e" }),
    });
    assert.equal(enrollResp.status, 201);
    const enrolled = await enrollResp.json();
    assert.ok(enrolled.device_token);
    const deviceToken = enrolled.device_token;

    const events = [
      validEvent(1, "2026-08-10T01:00:00.000Z", "2026-08-10T01:05:00.000Z", orgId, enrolled.device_id, subjectId),
      validEvent(2, "2026-08-10T01:05:00.000Z", "2026-08-10T01:10:00.000Z", orgId, enrolled.device_id, subjectId),
    ];
    const upResp = await fetch(`${API_BASE}/v1/activity-batches`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({ events }),
    });
    assert.equal(upResp.status, 200);
    const ack = await upResp.json();
    assert.equal(ack.accepted.length, 2);

    const rows = await client.query(
      `SELECT sequence_no, event_id FROM activity_segments WHERE device_id = $1 ORDER BY sequence_no`,
      [enrolled.device_id]
    );
    assert.equal(rows.rows.length, 2);

    const noAuth = await fetch(`${API_BASE}/v1/activity-batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [] }),
    });
    assert.equal(noAuth.status, 401);

    // cleanup
    await client.query("DELETE FROM activity_segments WHERE device_id = $1", [enrolled.device_id]);
    await client.query("DELETE FROM device_credentials WHERE device_id = $1", [enrolled.device_id]);
    await client.query("DELETE FROM enrollment_codes WHERE org_id = $1", [orgId]);
    await client.query("DELETE FROM subjects WHERE subject_id = $1", [subjectId]);
    await client.query("DELETE FROM organizations WHERE org_id = $1", [orgId]);
  } finally {
    await client.end();
  }
});

test("offline resend is idempotent (no duplicates)", async () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 8);
  const orgId = `org_e2e_${suffix}`;
  const subjectId = `sub_e2e_${suffix}`;
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query("INSERT INTO organizations (org_id, name) VALUES ($1,'E2E')", [orgId]);
    await client.query("INSERT INTO subjects (subject_id, org_id, display_name) VALUES ($1,$2,'E2E Subject')", [subjectId, orgId]);
    const code = "e2e-code-" + randomUUID().slice(0, 8);
    const codeHash = createHash("sha256").update(code).digest("hex");
    await client.query(
      `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at)
       VALUES ($1,$2,$3, now() + interval '15 minutes')`,
      [codeHash, orgId, subjectId]
    );
    const enrollResp = await fetch(`${API_BASE}/v1/enroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enrollment_code: code, agent_version: "0.1.1", os: "macos" }),
    });
    assert.equal(enrollResp.status, 201);
    const enrolled = await enrollResp.json();

    const evt = validEvent(7, "2026-08-10T02:00:00.000Z", "2026-08-10T02:05:00.000Z", orgId, enrolled.device_id, subjectId);
    const send = () =>
      fetch(`${API_BASE}/v1/activity-batches`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${enrolled.device_token}` },
        body: JSON.stringify({ events: [evt] }),
      });
    const r1 = await send();
    const ack1 = await r1.json();
    assert.equal(ack1.accepted.length, 1);
    const r2 = await send();
    const ack2 = await r2.json();
    assert.equal(ack2.accepted.length, 1, "resend of same seq+event accepted once");
    assert.equal(ack2.rejected.length, 0);
    const rows = await client.query(
      `SELECT COUNT(*)::int AS n FROM activity_segments WHERE device_id = $1`,
      [enrolled.device_id]
    );
    assert.equal(rows.rows[0].n, 1, "no duplicate rows");

    await client.query("DELETE FROM activity_segments WHERE device_id = $1", [enrolled.device_id]);
    await client.query("DELETE FROM device_credentials WHERE device_id = $1", [enrolled.device_id]);
    await client.query("DELETE FROM enrollment_codes WHERE org_id = $1", [orgId]);
    await client.query("DELETE FROM subjects WHERE subject_id = $1", [subjectId]);
    await client.query("DELETE FROM organizations WHERE org_id = $1", [orgId]);
  } finally {
    await client.end();
  }
});
