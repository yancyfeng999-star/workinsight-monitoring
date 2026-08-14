import test from "node:test";
import assert from "node:assert/strict";
import { getDomain } from "tldts";

function registrableDomain(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const d = getDomain(u.hostname);
    return d || null;
  } catch {
    return null;
  }
}

test("example.co.uk normalizes to example.co.uk", () => {
  assert.equal(registrableDomain("https://foo.example.co.uk/page?q=1"), "example.co.uk");
});

test("com.cn suffix handled", () => {
  assert.equal(registrableDomain("https://sub.example.com.cn/x"), "example.com.cn");
});

test("localhost returns null", () => {
  assert.equal(registrableDomain("http://localhost:8080/admin"), null);
});

test("bare IP returns null", () => {
  assert.equal(registrableDomain("http://192.168.0.1/"), null);
});

test("invalid url returns null", () => {
  assert.equal(registrableDomain("not a url"), null);
});

test("non-http scheme returns null", () => {
  assert.equal(registrableDomain("file:///etc/passwd"), null);
});

test("query and path stripped", () => {
  const d = registrableDomain("https://example.com/private/path?token=abc#frag");
  assert.equal(d, "example.com");
  assert.ok(!d.includes("/") && !d.includes("?") && !d.includes("#"));
});
