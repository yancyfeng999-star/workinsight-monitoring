export const ALLOWED_POLICY_KEYS = [
  "policy_version",
  "collection_enabled",
  "window_title_enabled",
  "idle_after_seconds",
  "blocked_apps",
  "blocked_domains",
  "issued_at",
  "expires_at",
] as const;

export const FORBIDDEN_POLICY_KEY =
  /screenshot|recording|keylog|clipboard|cookie|webcam|microphone|keystroke/i;

const DOMAIN_RE =
  /^(?!.*:\/\/)(?!.*[/?#:])(?!^\d+\.\d+\.\d+\.\d+$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export function validateCollectionFields(
  value: Record<string, unknown>
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_POLICY_KEY.test(key)) return { ok: false, error: "forbidden collection field" };
    if (!ALLOWED_POLICY_KEYS.includes(key as (typeof ALLOWED_POLICY_KEYS)[number])) {
      return { ok: false, error: `unknown policy field ${key}` };
    }
  }
  if ("collection_enabled" in value && typeof value.collection_enabled !== "boolean") {
    return { ok: false, error: "collection_enabled must be a boolean" };
  }
  if ("window_title_enabled" in value && typeof value.window_title_enabled !== "boolean") {
    return { ok: false, error: "window_title_enabled must be a boolean" };
  }
  if ("idle_after_seconds" in value) {
    const idle = value.idle_after_seconds;
    if (!Number.isInteger(idle) || Number(idle) < 30 || Number(idle) > 3600) {
      return { ok: false, error: "idle_after_seconds must be an integer from 30 to 3600" };
    }
  }
  if ("blocked_apps" in value && !isStringArray(value.blocked_apps)) {
    return { ok: false, error: "blocked_apps must be an array of strings" };
  }
  if ("blocked_domains" in value) {
    if (!isStringArray(value.blocked_domains)) {
      return { ok: false, error: "blocked_domains must be an array of strings" };
    }
    for (const domain of value.blocked_domains) {
      if (!DOMAIN_RE.test(domain)) return { ok: false, error: `invalid blocked domain ${domain}` };
    }
  }
  return { ok: true, value };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
