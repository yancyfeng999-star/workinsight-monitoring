import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import pg from "pg";
import { buildApp } from "../src/index.js";
import type { FastifyRequest } from "fastify";
import { readSessionToken } from "../src/auth/admin-session.js";
import { hashPasswordArgon2id, hashToken } from "../src/auth/password.js";
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

function fakeReq(headers: Record<string, string>): FastifyRequest {
  return { headers } as FastifyRequest;
}

test("readSessionToken prefers Bearer and matches the exact wi_session cookie name", () => {
  assert.equal(readSessionToken(fakeReq({ authorization: "Bearer abc" })), "abc");
  assert.equal(readSessionToken(fakeReq({ cookie: "wi_session=fromcookie" })), "fromcookie");
  assert.equal(readSessionToken(fakeReq({ cookie: "old_wi_session=nope" })), null);
  assert.equal(readSessionToken(fakeReq({ cookie: "prefix_wi_session=nope; wi_session=yes" })), "yes");
  assert.equal(
    readSessionToken(fakeReq({ authorization: "Bearer tok", cookie: "wi_session=other" })),
    "tok"
  );
});

function setCookieHeaders(resp: Response): string[] {
  const headers = resp.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") return headers.getSetCookie();
  const single = resp.headers.get("set-cookie");
  return single ? [single] : [];
}

function cookiePair(setCookie: string): { name: string; value: string } | null {
  const pair = setCookie.split(";", 1)[0]?.trim() ?? "";
  const eq = pair.indexOf("=");
  if (eq <= 0) return null;
  return { name: pair.slice(0, eq), value: pair.slice(eq + 1) };
}

test("admin login sets HttpOnly wi_session and logout clears the session", async () => {
  await withTestSchema(TEST_DB_URL, async (schema) => {
    await runInSchema(schema, async (ctx) => {
      await seed(ctx);
      const password = "admin-pass-test";
      await ctx.app.pool.query(
        `INSERT INTO admin_users (admin_user_id, org_id, username, password_hash, role)
         VALUES ('admin_login','org_a','console_admin',$1,'company_admin')`,
        [await hashPasswordArgon2id(password)]
      );

      const login = await fetch(ctx.url + "/v1/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "console_admin", password }),
      });
      assert.equal(login.status, 200);
      const loginBody = await login.json();
      assert.equal(Object.hasOwn(loginBody, "token"), false);
      assert.deepEqual(loginBody.user, {
        admin_user_id: "admin_login",
        username: "console_admin",
        role: "company_admin",
        org_id: "org_a",
      });

      const loginCookies = setCookieHeaders(login);
      const sessionSet = loginCookies.find((c) => cookiePair(c)?.name === "wi_session");
      assert.ok(sessionSet, "login Set-Cookie must include wi_session");
      assert.match(sessionSet, /HttpOnly/i);
      assert.match(sessionSet, /SameSite=Strict/i);
      assert.match(sessionSet, /Path=\//);
      const sessionValue = cookiePair(sessionSet)?.value ?? "";
      assert.ok(sessionValue.length > 0);

      const me = await fetch(ctx.url + "/v1/admin/me", {
        headers: { cookie: `old_wi_session=forged; wi_session=${sessionValue}` },
      });
      assert.equal(me.status, 200);
      const meBody = await me.json();
      assert.equal(meBody.user.admin_user_id, "admin_login");

      const forgedOnly = await fetch(ctx.url + "/v1/admin/me", {
        headers: { cookie: "old_wi_session=" + sessionValue },
      });
      assert.equal(forgedOnly.status, 401);

      const logout = await fetch(ctx.url + "/v1/admin/logout", {
        method: "POST",
        headers: { cookie: `wi_session=${sessionValue}` },
      });
      assert.equal(logout.status, 200);
      const logoutCookies = setCookieHeaders(logout);
      const cleared = logoutCookies.find((c) => cookiePair(c)?.name === "wi_session");
      assert.ok(cleared, "logout Set-Cookie must clear wi_session");
      assert.match(cleared, /Max-Age=0/i);
      assert.match(cleared, /HttpOnly/i);
      assert.match(cleared, /SameSite=Strict/i);

      const meAfter = await fetch(ctx.url + "/v1/admin/me", {
        headers: { cookie: `wi_session=${sessionValue}` },
      });
      assert.equal(meAfter.status, 401);
      const remaining = await ctx.app.pool.query("SELECT COUNT(*)::int AS n FROM admin_sessions");
      assert.equal(remaining.rows[0].n, 0);
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
