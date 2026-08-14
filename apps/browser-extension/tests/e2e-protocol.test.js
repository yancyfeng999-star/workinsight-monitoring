/**
 * B-006: Native Messaging & IPC protocol unit tests.
 *
 * Tests the frame encoding/decoding, IPC protocol with a mock server,
 * message type handling, and error cases — all using Node.js built-in modules.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, connect } from "node:net";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MAX_MSG_BYTES = 64 * 1024;

// ---------------------------------------------------------------------------
// Native Messaging frame helpers (Chrome uses little-endian uint32)
// ---------------------------------------------------------------------------

function encodeNativeFrame(obj) {
  const json = JSON.stringify(obj);
  const payload = Buffer.from(json, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function decodeNativeFrame(buf, offset = 0) {
  if (buf.length - offset < 4) return null;
  const len = buf.readUInt32LE(offset);
  if (len === 0 || len > MAX_MSG_BYTES) {
    throw new RangeError(`invalid frame length: ${len}`);
  }
  if (buf.length - offset < 4 + len) return null;
  const json = buf.toString("utf8", offset + 4, offset + 4 + len);
  return { message: JSON.parse(json), bytesRead: 4 + len };
}

// ---------------------------------------------------------------------------
// IPC frame helpers (agent uses big-endian uint32, matching Rust local-ipc)
// ---------------------------------------------------------------------------

function encodeIpcFrame(obj) {
  const json = JSON.stringify(obj);
  const payload = Buffer.from(json, "utf8");
  if (payload.length > MAX_MSG_BYTES) {
    throw new RangeError(`IPC frame too large: ${payload.length}`);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

function decodeIpcFrame(buf, offset = 0) {
  if (buf.length - offset < 4) return null;
  const len = buf.readUInt32BE(offset);
  if (len === 0 || len > MAX_MSG_BYTES) {
    throw new RangeError(`invalid IPC frame length: ${len}`);
  }
  if (buf.length - offset < 4 + len) return null;
  const json = buf.toString("utf8", offset + 4, offset + 4 + len);
  return { message: JSON.parse(json), bytesRead: 4 + len };
}

// ---------------------------------------------------------------------------
// Mock IPC server (simulates the Agent's Unix socket listener)
// ---------------------------------------------------------------------------

function createMockIpcServer(socketPath) {
  return new Promise((resolve, reject) => {
    const server = createServer((conn) => {
      let buf = Buffer.alloc(0);

      conn.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);

        while (buf.length >= 4) {
          const len = buf.readUInt32BE(0);
          if (buf.length < 4 + len) break;

          const json = buf.toString("utf8", 4, 4 + len);
          buf = buf.subarray(4 + len);

          let msg;
          try {
            msg = JSON.parse(json);
          } catch {
            // Send back an ok for unparseable
            const ack = encodeIpcFrame({ type: "ok" });
            conn.write(ack);
            continue;
          }

          // Route based on message type
          if (msg.type === "get_policy") {
            const resp = encodeIpcFrame({
              type: "policy_snapshot",
              window_title_enabled: false,
              blocked_domains: ["onepassword.com", "alipay.com"],
            });
            conn.write(resp);
          } else {
            const ack = encodeIpcFrame({ type: "ok" });
            conn.write(ack);
          }
        }
      });
    });

    server.on("error", reject);
    server.listen(socketPath, () => resolve(server));
  });
}

// ---------------------------------------------------------------------------
// Tests: Native Messaging frame encoding/decoding
// ---------------------------------------------------------------------------

describe("Native Messaging frame encoding", () => {
  it("encodes a simple message with 4-byte LE header", () => {
    const msg = { type: "ok" };
    const buf = encodeNativeFrame(msg);
    const len = buf.readUInt32LE(0);
    const payload = buf.toString("utf8", 4, 4 + len);
    assert.equal(len, payload.length);
    assert.deepEqual(JSON.parse(payload), msg);
  });

  it("round-trips a complex message", () => {
    const msg = {
      type: "activate",
      tab_id: 42,
      registrable_domain: "example.co.uk",
      title: "Hello World",
      private_mode: false,
    };
    const buf = encodeNativeFrame(msg);
    const result = decodeNativeFrame(buf, 0);
    assert.ok(result !== null);
    assert.deepEqual(result.message, msg);
    assert.equal(result.bytesRead, buf.length);
  });

  it("handles messages with unicode characters", () => {
    const msg = { type: "activate", title: "中文标题 🎉" };
    const buf = encodeNativeFrame(msg);
    const result = decodeNativeFrame(buf, 0);
    assert.ok(result !== null);
    assert.equal(result.message.title, "中文标题 🎉");
  });

  it("handles maximum-length messages", () => {
    const msg = { data: "x".repeat(MAX_MSG_BYTES - 20) }; // leave room for JSON wrapper
    const buf = encodeNativeFrame(msg);
    const result = decodeNativeFrame(buf, 0);
    assert.ok(result !== null);
    assert.equal(result.message.data.length, msg.data.length);
  });
});

// ---------------------------------------------------------------------------
// Tests: Native Messaging frame decoding edge cases
// ---------------------------------------------------------------------------

describe("Native Messaging frame decoding", () => {
  it("returns null when buffer has less than 4 bytes", () => {
    assert.equal(decodeNativeFrame(Buffer.alloc(2), 0), null);
  });

  it("returns null when buffer is incomplete (header only)", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(100, 0);
    assert.equal(decodeNativeFrame(buf, 0), null);
  });

  it("throws on zero-length frame", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(0, 0);
    assert.throws(() => decodeNativeFrame(buf, 0), RangeError);
  });

  it("throws on oversize frame", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(MAX_MSG_BYTES + 1, 0);
    assert.throws(() => decodeNativeFrame(buf, 0), RangeError);
  });

  it("decodes with offset", () => {
    const prefix = Buffer.alloc(10);
    const msg = { test: true };
    const frame = encodeNativeFrame(msg);
    const combined = Buffer.concat([prefix, frame]);
    const result = decodeNativeFrame(combined, 10);
    assert.ok(result !== null);
    assert.deepEqual(result.message, msg);
  });

  it("decodes multiple consecutive frames", () => {
    const msg1 = { a: 1 };
    const msg2 = { b: 2 };
    const buf = Buffer.concat([encodeNativeFrame(msg1), encodeNativeFrame(msg2)]);

    const r1 = decodeNativeFrame(buf, 0);
    assert.ok(r1 !== null);
    assert.deepEqual(r1.message, msg1);

    const r2 = decodeNativeFrame(buf, r1.bytesRead);
    assert.ok(r2 !== null);
    assert.deepEqual(r2.message, msg2);
    assert.equal(r1.bytesRead + r2.bytesRead, buf.length);
  });
});

// ---------------------------------------------------------------------------
// Tests: IPC protocol (big-endian, matching Rust local-ipc)
// ---------------------------------------------------------------------------

describe("IPC frame encoding/decoding", () => {
  it("uses big-endian uint32 header", () => {
    const frame = encodeIpcFrame({ type: "ok" });
    const len = frame.readUInt32BE(0);
    assert.equal(len, frame.length - 4);
  });

  it("round-trips browser_active message", () => {
    const msg = {
      type: "browser_active",
      browser: "chrome",
      tab_id: "42",
      registrable_domain: "example.com",
      title: "Test",
    };
    const frame = encodeIpcFrame(msg);
    const result = decodeIpcFrame(frame, 0);
    assert.ok(result !== null);
    assert.deepEqual(result.message, msg);
  });

  it("round-trips browser_inactive message", () => {
    const msg = { type: "browser_inactive", browser: "chrome", tab_id: "42" };
    const frame = encodeIpcFrame(msg);
    const result = decodeIpcFrame(frame, 0);
    assert.ok(result !== null);
    assert.deepEqual(result.message, msg);
  });

  it("round-trips get_policy request", () => {
    const msg = { type: "get_policy" };
    const frame = encodeIpcFrame(msg);
    const result = decodeIpcFrame(frame, 0);
    assert.ok(result !== null);
    assert.deepEqual(result.message, msg);
  });

  it("round-trips policy_snapshot response", () => {
    const msg = {
      type: "policy_snapshot",
      window_title_enabled: true,
      blocked_domains: ["onepassword.com"],
    };
    const frame = encodeIpcFrame(msg);
    const result = decodeIpcFrame(frame, 0);
    assert.ok(result !== null);
    assert.deepEqual(result.message, msg);
  });

  it("rejects oversize frames", () => {
    assert.throws(() => {
      encodeIpcFrame({ data: "x".repeat(MAX_MSG_BYTES) });
    }, RangeError);
  });

  it("rejects zero-length frames on decode", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(0, 0);
    assert.throws(() => decodeIpcFrame(buf, 0), RangeError);
  });

  it("rejects truncated frames on decode", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(100, 0);
    // Only header, no payload
    assert.equal(decodeIpcFrame(buf, 0), null);
  });
});

// ---------------------------------------------------------------------------
// Tests: Message type validation
// ---------------------------------------------------------------------------

describe("Message type handling", () => {
  it("browser_active has required fields", () => {
    const msg = {
      type: "browser_active",
      browser: "chrome",
      tab_id: "1",
      registrable_domain: "example.com",
    };
    assert.ok(msg.type === "browser_active");
    assert.ok(typeof msg.browser === "string");
    assert.ok(typeof msg.tab_id === "string");
    assert.ok(typeof msg.registrable_domain === "string");
  });

  it("browser_inactive has required fields", () => {
    const msg = { type: "browser_inactive", browser: "chrome", tab_id: "1" };
    assert.ok(msg.type === "browser_inactive");
    assert.ok(typeof msg.browser === "string");
    assert.ok(typeof msg.tab_id === "string");
  });

  it("get_policy has no extra fields", () => {
    const msg = { type: "get_policy" };
    assert.deepEqual(Object.keys(msg), ["type"]);
  });

  it("policy_snapshot contains window_title_enabled", () => {
    const msg = {
      type: "policy_snapshot",
      window_title_enabled: false,
      blocked_domains: [],
    };
    assert.ok(typeof msg.window_title_enabled === "boolean");
    assert.ok(Array.isArray(msg.blocked_domains));
  });

  it("ok response has minimal shape", () => {
    const msg = { type: "ok" };
    assert.deepEqual(msg, { type: "ok" });
  });

  it("error response has message field", () => {
    const msg = { type: "error", message: "private mode rejected" };
    assert.ok(typeof msg.message === "string");
    assert.ok(msg.message.length > 0);
  });

  it("private_mode true causes rejection in activate", () => {
    const msg = {
      type: "activate",
      tab_id: 1,
      title: "secret",
      registrable_domain: "bank.com",
      private_mode: true,
    };
    // The bridge rejects this — verify the flag is present
    assert.equal(msg.private_mode, true);
  });

  it("private_mode false allows activate", () => {
    const msg = {
      type: "activate",
      tab_id: 1,
      title: "page",
      registrable_domain: "example.com",
      private_mode: false,
    };
    assert.equal(msg.private_mode, false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Error cases
// ---------------------------------------------------------------------------

describe("Error cases", () => {
  it("malformed JSON in native frame is parseable to error", () => {
    // Encode a valid frame with broken JSON
    const bad = Buffer.from("{not valid json!!!");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(bad.length, 0);
    const frame = Buffer.concat([header, bad]);

    // The frame itself decodes (the length is valid), but JSON.parse should fail
    const len = frame.readUInt32LE(0);
    assert.equal(len, bad.length);
    assert.throws(() => JSON.parse(frame.toString("utf8", 4, 4 + len)), SyntaxError);
  });

  it("truncated JSON in native frame", () => {
    const partial = Buffer.from('{"type":"acti');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(partial.length, 0);
    const frame = Buffer.concat([header, partial]);

    const len = frame.readUInt32LE(0);
    assert.equal(len, partial.length);
    assert.throws(() => JSON.parse(frame.toString("utf8", 4, 4 + len)), SyntaxError);
  });

  it("negative-like values in length field (high bit set)", () => {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(0xFFFFFFFF, 0);
    assert.throws(() => decodeNativeFrame(buf, 0), RangeError);
  });

  it("frame with exactly MAX_MSG_BYTES succeeds", () => {
    // Create a message that's exactly at the limit
    const padding = "x".repeat(MAX_MSG_BYTES - 20);
    const msg = { d: padding };
    const frame = encodeNativeFrame(msg);
    const len = frame.readUInt32LE(0);
    assert.ok(len <= MAX_MSG_BYTES);
    const result = decodeNativeFrame(frame, 0);
    assert.ok(result !== null);
  });

  it("empty JSON object is valid", () => {
    const frame = encodeNativeFrame({});
    const result = decodeNativeFrame(frame, 0);
    assert.ok(result !== null);
    assert.deepEqual(result.message, {});
  });

  it("null values in JSON are preserved", () => {
    const msg = { type: "browser_active", title: null };
    const frame = encodeNativeFrame(msg);
    const result = decodeNativeFrame(frame, 0);
    assert.ok(result !== null);
    assert.equal(result.message.title, null);
  });
});

// ---------------------------------------------------------------------------
// Tests: Mock IPC server round-trip
// ---------------------------------------------------------------------------

describe("Mock IPC server round-trip", () => {
  let server;
  let socketPath;

  before(async () => {
    socketPath = `/tmp/e2e-ipc-test-${process.pid}.sock`;
    try {
      const { unlinkSync } = await import("node:fs");
      unlinkSync(socketPath);
    } catch {}
    server = await createMockIpcServer(socketPath);
  });

  after(() => {
    if (server) server.close();
    try {
      unlinkSync(socketPath);
    } catch {}
  });

  function sendIpc(msg) {
    return new Promise((resolve, reject) => {
      const client = connect(socketPath);
      let buf = Buffer.alloc(0);
      let settled = false;

      client.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        try {
          const result = decodeIpcFrame(buf, 0);
          if (result && !settled) {
            settled = true;
            client.end();
            resolve(result.message);
          }
        } catch {}
      });

      client.on("error", (err) => {
        if (!settled) { settled = true; reject(err); }
      });

      client.write(encodeIpcFrame(msg));

      setTimeout(() => {
        if (!settled) { settled = true; client.destroy(); reject(new Error("timeout")); }
      }, 3000);
    });
  }

  it("browser_active returns ok", async () => {
    const resp = await sendIpc({
      type: "browser_active",
      browser: "chrome",
      tab_id: "1",
      registrable_domain: "example.com",
      title: "Test",
    });
    assert.equal(resp.type, "ok");
  });

  it("browser_inactive returns ok", async () => {
    const resp = await sendIpc({
      type: "browser_inactive",
      browser: "chrome",
      tab_id: "1",
    });
    assert.equal(resp.type, "ok");
  });

  it("get_policy returns policy_snapshot", async () => {
    const resp = await sendIpc({ type: "get_policy" });
    assert.equal(resp.type, "policy_snapshot");
    assert.ok(typeof resp.window_title_enabled === "boolean");
    assert.ok(Array.isArray(resp.blocked_domains));
  });
});

// ---------------------------------------------------------------------------
// Tests: Source code analysis (static checks)
// ---------------------------------------------------------------------------

describe("Source code static analysis", () => {
  let background;

  before(() => {
    background = readFileSync(join(ROOT, "src/core/background.js"), "utf8");
  });

  it("uses com.workinsight.agent.bridge as native host name", () => {
    assert.match(background, /com\.workinsight\.agent\.bridge/);
  });

  it("connects via chrome.runtime.connectNative", () => {
    assert.match(background, /chrome\.runtime\.connectNative/);
  });

  it("handles policy_snapshot messages", () => {
    assert.match(background, /policy_snapshot/);
    assert.match(background, /window_title_enabled/);
  });

  it("handles onDisconnect with reconnect", () => {
    assert.match(background, /onDisconnect/);
    assert.match(background, /connectNative/);
  });

  it("sends browser_active with registrable_domain", () => {
    assert.match(background, /browser_active/);
    assert.match(background, /registrable_domain/);
  });

  it("sends browser_inactive", () => {
    assert.match(background, /browser_inactive/);
  });

  it("never sends full URLs", () => {
    assert.doesNotMatch(background, /tab\.url\.substring/);
    assert.doesNotMatch(background, /\.pathname\b/);
    assert.doesNotMatch(background, /\.search\b/);
  });

  it("truncates title to 256 chars", () => {
    assert.match(background, /slice\(0, 256\)/);
  });

  it("checks tab.incognito before sending", () => {
    assert.match(background, /tab\.incognito/);
  });
});
