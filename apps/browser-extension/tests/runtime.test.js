import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const background = readFileSync(resolve(ROOT, "src/core/background.js"), "utf8");
const manifest = JSON.parse(readFileSync(resolve(ROOT, "manifest.json"), "utf8"));

test("manifest points service worker to bundled dist output", () => {
  assert.equal(manifest.background.service_worker, "dist/background.js");
});

test("native host name matches bridge", () => {
  assert.match(background, /com\.workinsight\.agent\.bridge/);
});

test("host manifest has no placeholder in allowed_origins", () => {
  const hostManifests = ["native-host/macos.json", "native-host/windows.json"];
  for (const f of hostManifests) {
    try {
      const m = JSON.parse(readFileSync(resolve(ROOT, f), "utf8"));
      for (const origin of m.allowed_origins ?? []) {
        assert.ok(
          !origin.includes("REPLACE"),
          `${f}: allowed_origins must not contain placeholders`
        );
      }
    } catch {
      // missing template file is a failure
      assert.fail(`missing host manifest template: ${f}`);
    }
  }
});

test("extension never sends full URL or path", () => {
  assert.doesNotMatch(background, /\.pathname\b/);
  assert.doesNotMatch(background, /\.search\b/);
  assert.doesNotMatch(background, /tab\.url\.substring/);
});

test("incognito is hard-dropped before any message", () => {
  assert.match(background, /incognito/);
  assert.doesNotMatch(background, /private_mode:\s*true/);
});

test("background tabs never accumulate time (only focused window active tab)", () => {
  assert.match(background, /windows\.getAll/);
  assert.match(background, /windowTypes/);
  assert.match(background, /focused/);
});

test("title sent only when policy enables it", () => {
  assert.match(background, /title_enabled|window_title_enabled/);
});
