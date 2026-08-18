const BASE = "/api";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type QueryErrorKind = "unauthorized" | "forbidden" | "network" | "http";

export interface QueryError {
  kind: QueryErrorKind;
  message: string;
}

let unauthorizedRedirected = false;

export const loginNavigation = {
  go() {
    if (typeof window !== "undefined") {
      window.location.replace("/login");
    }
  },
};

export function resetUnauthorizedRedirect(): void {
  unauthorizedRedirected = false;
}

export function redirectToLoginOnce(): void {
  if (unauthorizedRedirected) return;
  unauthorizedRedirected = true;
  loginNavigation.go();
}

export function classifyQueryError(error: unknown): QueryError {
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "unauthorized", message: "登录已过期" };
    if (error.status === 403) return { kind: "forbidden", message: "当前账号无此权限" };
    return { kind: "http", message: error.message };
  }
  return { kind: "network", message: "网络连接失败，请检查网络后重试" };
}

function isLoginPost(path: string): boolean {
  return path === "/v1/admin/login";
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error("network error");
  }

  if (res.status === 401) {
    if (isLoginPost(path)) {
      const body = await res.text().catch(() => "");
      throw new ApiError(401, body || "登录失败");
    }
    redirectToLoginOnce();
    throw new ApiError(401, "登录已过期");
  }
  if (res.status === 403) {
    throw new ApiError(403, "当前账号无此权限");
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/* ── Shared types (aligned with Task 4 admin-console.types) ── */

export interface DashboardStats {
  coverageRate: number;
  onlineDevices: number;
  avgDelaySec: number;
  categoryBreakdown: Array<{ category: string; count: number; total: number }>;
  recentAlerts: Array<{
    id: string;
    message: string;
    severity: "info" | "warning" | "critical";
    ts: string;
  }>;
}

export interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  coverageRate: number;
  trend: "up" | "down" | "flat";
}

export interface SubjectDetail {
  id: string;
  name: string;
  team: string | null;
  timeline: Array<{ ts: string; event: string }>;
  dailyAggregates: Array<{ date: string; activeMin: number; apps: number }>;
  gaps: Array<{ start: string; end: string; reason: string }>;
  auditLog: Array<{ actor: string; action: string; ts: string }>;
}

export interface Device {
  id: string;
  os: string;
  agentVersion: string;
  lastHealth: "ok" | "degraded" | "offline";
  queueDepth: number;
  permissionsOk: boolean;
  lastSeen: string | null;
  stale: boolean;
}

export interface EnrollmentCode {
  code: string;
  status: "active" | "used" | "expired";
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
}

export interface CreateEnrollmentBody {
  subjectId: string;
  ttlHours: number;
}

export interface CreatedEnrollment {
  code: string;
  expiresAt: string;
}

export interface Policy {
  version: number;
  content: string;
  createdAt: string;
  rolloutPercent: number;
}

export interface CreatePolicyBody {
  content: string;
  rolloutPercent: number;
}

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  requestId: string;
  ts: string;
}

export interface InsightMetric {
  name: string;
  value: number;
  unit: "seconds" | "count" | "ratio" | "percent";
  periodStart: string;
  periodEnd: string;
}

export interface InsightFinding {
  title: string;
  explanation: string;
  evidence: InsightMetric[];
  recommendation: string;
  confidence: number;
}

export interface InsightOutput {
  summary: string;
  findings: InsightFinding[];
  provider: "deepseek";
  model: string;
  generatedAt: string;
}

export interface InsightResponse {
  mode: "rules_only" | "ai";
  reason: string | null;
  coverageGaps: Array<{ team: string; missingDays: number }>;
  dataQuality: Array<{ metric: string; value: string; status: "ok" | "warning" | "error" }>;
  reports: InsightOutput[];
}

export interface SystemHealth {
  api: { status: "ok" | "degraded"; latencyMs: number };
  worker: { status: "ok" | "stale" | "error"; lastRun: string | null };
  database: { connected: boolean; latencyMs: number };
  queues: Array<{ name: string; depth: number }>;
}

