const FORBIDDEN_FIELDS = ["category", "score", "metric", "insight", "prompt", "llm", "model"];
const MAX_TITLE = 256;
const MAX_DOMAIN = 253;
const MAX_SEGMENT_SECONDS = 4 * 3600;
const DOMAIN_RE =
  /^(?!.*:\/\/)(?!.*[/?#:])(?!^\d+\.\d+\.\d+\.\d+$)(?!^localhost$)[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

export interface RawActivity {
  app_id: string;
  app_name: string;
  window_title: string | null;
  browser: string | null;
  registrable_domain: string | null;
  url_path: null;
}

export interface RawState {
  presence: "active" | "idle" | "locked" | "unlocked" | "sleeping" | "awake";
  started_at: string;
}

export interface RawEvent {
  schema_version: 1;
  event_id: string;
  org_id: string;
  device_id: string;
  subject_id: string;
  sequence_no: number;
  source: "system" | "browser";
  kind: "focus_segment" | "state_change";
  started_at: string;
  ended_at: string;
  timezone: string;
  activity?: RawActivity;
  state?: RawState;
  privacy: "normal";
  agent: { version: string; os: string };
}

export type ValidateResult =
  | { ok: true; event: RawEvent }
  | { ok: false; error: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function checkUnknownFields(obj: Record<string, unknown>, allowed: string[], what: string): string | null {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) return `unknown field ${what}.${k}`;
  }
  return null;
}

function checkString(v: unknown, what: string, max: number): string | null {
  if (typeof v !== "string" || v.length === 0) return `${what} must be a non-empty string`;
  if (v.length > max) return `${what} exceeds ${max} chars`;
  return null;
}

export function validateEvent(raw: unknown): ValidateResult {
  if (!isObj(raw)) return { ok: false, error: "event must be an object" };

  const topAllowed = [
    "schema_version", "event_id", "org_id", "device_id", "subject_id",
    "sequence_no", "source", "kind", "started_at", "ended_at",
    "timezone", "privacy", "agent", "activity", "state",
  ];
  const bad = checkUnknownFields(raw, topAllowed, "event");
  if (bad) return { ok: false, error: bad };

  const e = raw as unknown as RawEvent;

  for (const f of FORBIDDEN_FIELDS) {
    if (e[f as keyof RawEvent] !== undefined) return { ok: false, error: `forbidden field ${f}` };
  }

  if (e.schema_version !== 1) return { ok: false, error: "bad schema_version" };
  for (const [name, v] of [
    ["event_id", e.event_id], ["org_id", e.org_id],
    ["device_id", e.device_id], ["subject_id", e.subject_id],
  ] as const) {
    const err = checkString(v, name, 64);
    if (err) return { ok: false, error: err };
  }
  if (typeof e.sequence_no !== "number" || !Number.isInteger(e.sequence_no) || e.sequence_no < 1)
    return { ok: false, error: "sequence_no must be a positive integer" };
  if (e.source !== "system" && e.source !== "browser")
    return { ok: false, error: `bad source ${String(e.source)}` };
  if (e.kind !== "focus_segment" && e.kind !== "state_change")
    return { ok: false, error: `bad kind ${String(e.kind)}` };
  if (e.privacy !== "normal") return { ok: false, error: "private_mode event rejected" };
  if (!isObj(e.agent) || checkUnknownFields(e.agent, ["version", "os"], "agent"))
    return { ok: false, error: "bad agent object" };
  {
    const err = checkString(e.agent.version, "agent.version", 32);
    if (err) return { ok: false, error: err };
  }
  {
    const err = checkString(e.agent.os, "agent.os", 32);
    if (err) return { ok: false, error: err };
  }

  const start = Date.parse(e.started_at);
  const end = Date.parse(e.ended_at);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start)
    return { ok: false, error: "bad time range" };
  if ((end - start) / 1000 > MAX_SEGMENT_SECONDS)
    return { ok: false, error: "segment too long" };

  if (e.kind === "focus_segment") {
    if (!isObj(e.activity)) return { ok: false, error: "focus_segment requires activity" };
    const a = e.activity;
    const badAct = checkUnknownFields(
      a, ["app_id", "app_name", "window_title", "browser", "registrable_domain", "url_path"], "activity"
    );
    if (badAct) return { ok: false, error: badAct };
    for (const [name, v] of [["app_id", a.app_id], ["app_name", a.app_name]] as const) {
      const err = checkString(v, name, 128);
      if (err) return { ok: false, error: err };
    }
    if (a.window_title !== null && a.window_title !== undefined) {
      if (typeof a.window_title !== "string" || a.window_title.length > MAX_TITLE)
        return { ok: false, error: "bad window_title" };
    }
    if (a.browser !== null && a.browser !== undefined) {
      const err = checkString(a.browser, "browser", 32);
      if (err) return { ok: false, error: err };
    }
    if (a.registrable_domain !== null && a.registrable_domain !== undefined) {
      if (typeof a.registrable_domain !== "string" || !DOMAIN_RE.test(a.registrable_domain))
        return { ok: false, error: "bad registrable_domain" };
    }
    if (a.url_path !== null && a.url_path !== undefined)
      return { ok: false, error: "url_path must be null" };
  } else {
    if (!isObj(e.state)) return { ok: false, error: "state_change requires state" };
    const badState = checkUnknownFields(e.state, ["presence", "started_at"], "state");
    if (badState) return { ok: false, error: badState };
    const presence = e.state.presence;
    if (!["active", "idle", "locked", "unlocked", "sleeping", "awake"].includes(String(presence)))
      return { ok: false, error: "bad presence" };
    if (Number.isNaN(Date.parse(e.state.started_at)))
      return { ok: false, error: "bad state.started_at" };
  }

  return { ok: true, event: e };
}
