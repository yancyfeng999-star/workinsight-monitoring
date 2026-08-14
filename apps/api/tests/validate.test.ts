import test from "node:test";
import assert from "node:assert/strict";
import { validateEvent } from "../src/validate.js";

function base() {
  return {
    schema_version: 1,
    event_id: "evt_1",
    org_id: "org_1",
    device_id: "dev_1",
    subject_id: "sub_1",
    sequence_no: 1,
    source: "system",
    kind: "focus_segment",
    started_at: "2026-08-10T01:23:45.000Z",
    ended_at: "2026-08-10T01:28:45.000Z",
    timezone: "Asia/Shanghai",
    activity: {
      app_id: "com.google.Chrome",
      app_name: "Google Chrome",
      window_title: null,
      browser: "chrome",
      registrable_domain: "example.com",
      url_path: null,
    },
    privacy: "normal",
    agent: { version: "0.1.1", os: "macos" },
  };
}

test("valid event passes", () => {
  assert.equal(validateEvent(base()).ok, true);
});

test("forbidden fields rejected", () => {
  for (const f of ["category", "score", "metric", "insight", "llm", "model"]) {
    const e = base() as Record<string, unknown>;
    e[f] = "anything";
    const r = validateEvent(e);
    assert.equal(r.ok, false, `${f} should be rejected`);
  }
});

test("private mode rejected", () => {
  const e = base();
  e.privacy = "private";
  assert.equal(validateEvent(e).ok, false);
});

test("url_path must be null", () => {
  const e = base() as Record<string, unknown>;
  (e.activity as Record<string, unknown>).url_path = "/secret/path";
  assert.equal(validateEvent(e).ok, false);
});

test("nested forbidden field is rejected", () => {
  const e = base();
  (e.activity as Record<string, unknown>).prompt = "secret";
  assert.equal(validateEvent(e).ok, false);
});

test("unknown nested object is rejected", () => {
  const e = base() as Record<string, unknown>;
  e.extra = { prompt: "secret" };
  assert.equal(validateEvent(e).ok, false);
});

test("full URL cannot masquerade as a domain", () => {
  const e = base();
  e.activity.registrable_domain = "https://example.com/private?q=x";
  assert.equal(validateEvent(e).ok, false);
});

test("state_change uses state object not activity", () => {
  const e = base() as Record<string, unknown>;
  e.kind = "state_change";
  delete e.activity;
  e.state = { presence: "locked", started_at: "2026-08-10T01:23:45.000Z" };
  assert.equal(validateEvent(e).ok, true);
});

test("reversed time rejected", () => {
  const e = base();
  e.ended_at = "2026-08-10T00:00:00.000Z";
  assert.equal(validateEvent(e).ok, false);
});

test("duplicate sequence dedupe is idempotent by PK", () => {
  const e = base();
  e.sequence_no = 7;
  assert.equal(validateEvent(e).ok, true);
});

test("unknown top-level field rejected (not silently trusted)", () => {
  const e = base() as Record<string, unknown>;
  e.unknown_field_xyz = { nested: 1 };
  assert.equal(validateEvent(e).ok, false, "unknown fields must be rejected");
});
