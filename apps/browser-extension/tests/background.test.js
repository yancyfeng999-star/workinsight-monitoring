import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const background = readFileSync(
  new URL("../src/core/background.js", import.meta.url),
  "utf8"
);

test("extension never sends full URLs or query strings", () => {
  assert.match(background, /registrable_domain/);
  assert.doesNotMatch(background, /\.pathname\b/);
  assert.doesNotMatch(background, /\.search\b/);
  assert.doesNotMatch(background, /history\./);
});

test("private mode is hard-dropped", () => {
  assert.match(background, /incognito/);
  assert.match(background, /tab\.incognito/);
  assert.doesNotMatch(background, /private_mode:\s*true/);
});

test("no content scripts / webRequest / cookie permissions", () => {
  const manifest = readFileSync(
    new URL("../manifest.json", import.meta.url),
    "utf8"
  );
  const m = JSON.parse(manifest);
  assert.ok(!m.permissions.includes("webRequest"));
  assert.ok(!m.permissions.includes("cookies"));
  assert.ok(!m.permissions.includes("clipboardRead"));
  assert.ok(!m.content_scripts);
});

test("domain blocklist includes critical categories", () => {
  for (const d of [
    "onepassword.com",
    "alipay.com",
    "mail.google.com",
    "qq.com",
  ]) {
    assert.ok(background.includes(d), `blocklist missing ${d}`);
  }
});

test("title is truncated to 256", () => {
  assert.match(background, /slice\(0, 256\)/);
});
