import { getDomain } from "tldts";

const NATIVE_HOST = "com.workinsight.agent.bridge";
const BLOCKED_DOMAINS = [
  "onepassword.com",
  "1password.com",
  "bitwarden.com",
  "bankofamerica.com",
  "icbc.com.cn",
  "cmbchina.com",
  "alipay.com",
  "mail.google.com",
  "qq.com",
  "126.com",
  "163.com",
  "outlook.com",
];

let port = null;
let titleEnabled = false;
let retryDelay = 1000;
let current = null;

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

function isBlocked(domain) {
  return BLOCKED_DOMAINS.some((b) => domain === b || domain.endsWith("." + b));
}

function connectNative() {
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener((msg) => {
      if (msg?.type === "policy_snapshot") {
        titleEnabled = !!msg.window_title_enabled;
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      // exponential backoff reconnect: 1s, 2s, 4s, ... capped at 60s
      setTimeout(connectNative, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 60000);
    });
    retryDelay = 1000;
  } catch {
    port = null;
    setTimeout(connectNative, retryDelay);
  }
}

function send(msg) {
  if (!port) return;
  try {
    port.postMessage(msg);
  } catch {
    port = null;
  }
}

async function snapshot() {
  const wins = await chrome.windows.getAll({ windowTypes: ["normal"] });
  const focused = wins.find((w) => w.focused);
  if (!focused) return null;
  const tabs = await chrome.tabs.query({ windowId: focused.id, active: true });
  return tabs.length === 1 ? tabs[0] : null;
}

async function check() {
  const tab = await snapshot();
  if (!tab) {
    if (current) {
      send({ type: "browser_inactive", browser: "chrome", tab_id: current });
      current = null;
    }
    return;
  }
  // incognito is hard-dropped: never forms an observation
  if (tab.incognito) {
    if (current) {
      send({ type: "browser_inactive", browser: "chrome", tab_id: current });
      current = null;
    }
    return;
  }
  const domain = registrableDomain(tab.url);
  const key = `${tab.id}`;
  if (current === key) return;
  if (current) send({ type: "browser_inactive", browser: "chrome", tab_id: current });
  current = key;
  if (!domain || isBlocked(domain)) return;
  send({
    type: "browser_active",
    browser: "chrome",
    tab_id: key,
    registrable_domain: domain,
    title: titleEnabled ? (tab.title || "").slice(0, 256) : undefined,
  });
}

chrome.tabs.onActivated.addListener(check);
chrome.tabs.onUpdated.addListener((_id, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.title) check();
});
chrome.windows.onFocusChanged.addListener(check);

connectNative();
check();
setInterval(check, 10_000);
