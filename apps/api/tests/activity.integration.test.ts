import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/index.js";
import { hashToken } from "../src/auth/password.js";
import { withTestSchema } from "./helpers/test-db.js";

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://workinsight:workinsight_dev@localhost:5433/workinsight_test";

async function runInSchema(schema: string, fn: (ctx: { url: string; app: Awaited<ReturnType<typeof buildApp>> }) => Promise<void>) {
  const app = await buildApp(TEST_DB_URL);
  const address = await app.app.listen({ port: 0, host: "127.0.0.1" });
  try {
    await app.pool.query(`SET search_path TO "${schema}", public`);
    await fn({ url: address, app });
  } finally {
    await app.app.close();
    await app.pool.end();
  }
}

function validEvent(seq: number, started: string, ended: string) {
  return {
    schema_version: 1,
    event_id: "evt_" + seq,
    org_id: "org_a",
    device_id: "dev_alice",
    subject_id: "sub_alice",
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

test("activity batch accepted and stored without raw JSON bloat", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await ctx.app.pool.query("INSERT INTO organizations (org_id, name) VALUES ('org_a','A')");
      await ctx.app.pool.query("INSERT INTO subjects (subject_id, org_id, display_name) VALUES ('sub_alice','org_a','Alice')");
      await ctx.app.pool.query(
        `INSERT INTO device_credentials (device_id, org_id, subject_id, token_hash, expires_at)
         VALUES ('dev_alice','org_a','sub_alice',$1, now() + interval '30 days')`,
        [hashToken("token_alice")]
      );
      const body = JSON.stringify({
        events: [
          validEvent(1, "2026-08-10T01:00:00.000Z", "2026-08-10T01:05:00.000Z"),
          validEvent(2, "2026-08-10T01:05:00.000Z", "2026-08-10T01:10:00.000Z"),
        ],
      });
      const resp = await fetch(ctx.url + "/v1/activity-batches", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer token_alice" },
        body,
      });
      assert.equal(resp.status, 200);
      const j = await resp.json();
      assert.equal(j.accepted.length, 2);
      const rows = await ctx.app.pool.query("SELECT sequence_no, event_id FROM activity_segments WHERE device_id='dev_alice' ORDER BY sequence_no");
      assert.equal(rows.rows.length, 2);
    });
  });
});

test("replayed sequence with same event_id is accepted once (idempotent)", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await ctx.app.pool.query("INSERT INTO organizations (org_id, name) VALUES ('org_a','A')");
      await ctx.app.pool.query("INSERT INTO subjects (subject_id, org_id, display_name) VALUES ('sub_alice','org_a','Alice')");
      await ctx.app.pool.query(
        `INSERT INTO device_credentials (device_id, org_id, subject_id, token_hash, expires_at)
         VALUES ('dev_alice','org_a','sub_alice',$1, now() + interval '30 days')`,
        [hashToken("token_alice")]
      );
      const evt = validEvent(7, "2026-08-10T01:00:00.000Z", "2026-08-10T01:05:00.000Z");
      const send = () =>
        fetch(ctx.url + "/v1/activity-batches", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer token_alice" },
          body: JSON.stringify({ events: [evt] }),
        });
      const r1 = await send();
      const j1 = await r1.json();
      assert.equal(j1.accepted.length, 1);
      const r2 = await send();
      const j2 = await r2.json();
      assert.equal(j2.accepted.length, 1);
      assert.equal(j2.rejected.length, 0);
    });
  });
});

test("same sequence different event_id returns sequence_conflict", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await ctx.app.pool.query("INSERT INTO organizations (org_id, name) VALUES ('org_a','A')");
      await ctx.app.pool.query("INSERT INTO subjects (subject_id, org_id, display_name) VALUES ('sub_alice','org_a','Alice')");
      await ctx.app.pool.query(
        `INSERT INTO device_credentials (device_id, org_id, subject_id, token_hash, expires_at)
         VALUES ('dev_alice','org_a','sub_alice',$1, now() + interval '30 days')`,
        [hashToken("token_alice")]
      );
      const e1 = validEvent(9, "2026-08-10T01:00:00.000Z", "2026-08-10T01:05:00.000Z");
      const e2 = { ...e1, event_id: "evt_9b" };
      const send = (evt: unknown) =>
        fetch(ctx.url + "/v1/activity-batches", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer token_alice" },
          body: JSON.stringify({ events: [evt] }),
        });
      await send(e1);
      const r2 = await send(e2);
      const j2 = await r2.json();
      assert.equal(j2.accepted.length, 0);
      assert.equal(j2.rejected.length, 1);
      assert.equal(j2.rejected[0].code, "sequence_conflict");
    });
  });
});

test("future-dated event beyond drift window rejected", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await ctx.app.pool.query("INSERT INTO organizations (org_id, name) VALUES ('org_a','A')");
      await ctx.app.pool.query("INSERT INTO subjects (subject_id, org_id, display_name) VALUES ('sub_alice','org_a','Alice')");
      await ctx.app.pool.query(
        `INSERT INTO device_credentials (device_id, org_id, subject_id, token_hash, expires_at)
         VALUES ('dev_alice','org_a','sub_alice',$1, now() + interval '30 days')`,
        [hashToken("token_alice")]
      );
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const evt = validEvent(1, future, new Date(Date.now() + 3605 * 1000).toISOString());
      const resp = await fetch(ctx.url + "/v1/activity-batches", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer token_alice" },
        body: JSON.stringify({ events: [evt] }),
      });
      const j = await resp.json();
      assert.equal(j.accepted.length, 0);
      assert.equal(j.rejected.length, 1);
      assert.equal(j.rejected[0].code, "invalid_schema");
    });
  });
});
