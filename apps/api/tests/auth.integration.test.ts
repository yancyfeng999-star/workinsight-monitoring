import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import pg from "pg";
import { buildApp } from "../src/index.js";
import { hashToken } from "../src/auth/password.js";
import { withTestSchema } from "./helpers/test-db.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://workinsight:workinsight_dev@localhost:5433/workinsight_test";

async function runInSchema(schema: string, fn: (ctx: { url: string; app: Awaited<ReturnType<typeof buildApp>> }) => Promise<void>) {
  const conn = new URL(TEST_DB_URL);
  // Every checked-out client must see the isolated schema (concurrent enroll uses many).
  conn.searchParams.set("options", `-csearch_path=${schema},public`);
  const app = await buildApp(conn.toString());
  const address = await app.app.listen({ port: 0, host: "127.0.0.1" });
  try {
    await fn({ url: address, app });
  } finally {
    await app.app.close();
    await app.pool.end();
  }
}

async function seed(ctx: { app: Awaited<ReturnType<typeof buildApp>> }) {
  const { app } = ctx;
  const org = await app.pool.query(
    "INSERT INTO organizations (org_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    ["org_a", "Org A"]
  );
  await app.pool.query(
    "INSERT INTO subjects (subject_id, org_id, display_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    ["sub_alice", "org_a", "Alice"]
  );
  await app.pool.query(
    "INSERT INTO subjects (subject_id, org_id, display_name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
    ["sub_bob", "org_a", "Bob"]
  );
  await app.pool.query(
    `INSERT INTO device_credentials (device_id, org_id, subject_id, token_hash, expires_at)
     VALUES ($1,$2,$3,$4, now() + interval '30 days')`,
    ["dev_alice", "org_a", "sub_alice", hashToken("token_alice"), ]
  );
  return org;
}

test("unauthenticated upload returns 401", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      const resp = await fetch(ctx.url + "/v1/activity-batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: [] }),
      });
      assert.equal(resp.status, 401);
    });
  });
});

test("device cannot write into another subject's scope", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      const evt = {
        schema_version: 1,
        event_id: "evt_cross_1",
        org_id: "org_a",
        device_id: "dev_alice",
        subject_id: "sub_bob",
        sequence_no: 1,
        source: "system",
        kind: "focus_segment",
        started_at: "2026-08-10T01:00:00.000Z",
        ended_at: "2026-08-10T01:05:00.000Z",
        timezone: "UTC",
        activity: { app_id: "com.x", app_name: "X", window_title: null, browser: null, registrable_domain: null, url_path: null },
        privacy: "normal",
        agent: { version: "0.1.1", os: "macos" },
      };
      const resp = await fetch(ctx.url + "/v1/activity-batches", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer token_alice" },
        body: JSON.stringify({ events: [evt] }),
      });
      const body = await resp.json();
      assert.equal(resp.status, 200);
      assert.equal(body.rejected.length, 1);
      assert.equal(body.rejected[0].code, "identity_mismatch");
    });
  });
});

test("revoked device returns 403", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      await ctx.app.pool.query(
        "UPDATE device_credentials SET revoked_at = now() WHERE device_id = 'dev_alice'"
      );
      const resp = await fetch(ctx.url + "/v1/activity-batches", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer token_alice" },
        body: JSON.stringify({ events: [] }),
      });
      assert.equal(resp.status, 403);
    });
  });
});

test("enrollment code is single use and returns token once", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      const code = "single-use-code-abc";
      await ctx.app.pool.query(
        `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at)
         VALUES ($1,$2,$3, now() + interval '15 minutes')`,
        [hashToken(code), "org_a", "sub_alice"]
      );
      const body = JSON.stringify({ enrollment_code: code, agent_version: "0.1.1", os: "macos", device_label: "test" });
      const r1 = await fetch(ctx.url + "/v1/enroll", { method: "POST", headers: { "content-type": "application/json" }, body });
      assert.equal(r1.status, 201);
      const j1 = await r1.json();
      assert.ok(j1.device_token && j1.device_token.length >= 32);
      const r2 = await fetch(ctx.url + "/v1/enroll", { method: "POST", headers: { "content-type": "application/json" }, body });
      assert.equal(r2.status, 409);
    });
  });
});

test("concurrent enrollment of the same code is single use", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      const code = "concurrent-use-code-xyz";
      await ctx.app.pool.query(
        `INSERT INTO enrollment_codes (code_hash, org_id, subject_id, expires_at)
         VALUES ($1,$2,$3, now() + interval '15 minutes')`,
        [hashToken(code), "org_a", "sub_alice"]
      );
      const body = JSON.stringify({ enrollment_code: code, agent_version: "0.1.1", os: "macos", device_label: "test" });
      const responses = await Promise.all(
        Array.from({ length: 50 }, () =>
          fetch(ctx.url + "/v1/enroll", { method: "POST", headers: { "content-type": "application/json" }, body })
        )
      );
      const statuses = responses.map((r) => r.status);
      const credentialCount = (
        await ctx.app.pool.query(
          `SELECT COUNT(*)::int AS n FROM device_credentials WHERE device_id <> $1`,
          ["dev_alice"]
        )
      ).rows[0].n;
      const deviceCount = (await ctx.app.pool.query(`SELECT COUNT(*)::int AS n FROM devices`)).rows[0].n;
      assert.equal(statuses.filter((s) => s === 201).length, 1);
      assert.equal(statuses.filter((s) => s === 409).length, 49);
      assert.equal(credentialCount, 1);
      assert.equal(deviceCount, 1);
    });
  });
});

test("manager cannot read another org's subjects without admin session", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      const resp = await fetch(ctx.url + "/v1/subjects/sub_alice/activity");
      assert.equal(resp.status, 401);
    });
  });
});

test("admin view of subject activity writes audit log", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      await ctx.app.pool.query(
        `INSERT INTO admin_users (admin_user_id, org_id, username, password_hash, role)
         VALUES ('admin_1','org_a','admin','x','company_admin')`
      );
      const session = await ctx.app.sessions.create("admin_1");
      const resp = await fetch(ctx.url + "/v1/subjects/sub_alice/activity", {
        headers: { authorization: "Bearer " + session },
      });
      assert.equal(resp.status, 200);
      const logs = await ctx.app.pool.query("SELECT * FROM audit_logs WHERE action = 'view_subject_activity'");
      assert.ok(logs.rows.length >= 1);
    });
  });
});

test("system operator cannot read personal activity", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      await ctx.app.pool.query(
        `INSERT INTO admin_users (admin_user_id, org_id, username, password_hash, role)
         VALUES ('admin_op','org_a','operator','x','system_operator')`
      );
      const session = await ctx.app.sessions.create("admin_op");
      const resp = await fetch(ctx.url + "/v1/subjects/sub_alice/activity", {
        headers: { authorization: "Bearer " + session },
      });
      assert.equal(resp.status, 403);
    });
  });
});
