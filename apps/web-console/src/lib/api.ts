const BASE = "/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (res.status === 401) {
    throw new ApiError(401, "登录已过期");
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

/* ── Shared types ── */

export interface DashboardStats {
  coverageRate: number;
  onlineDevices: number;
  avgDelaySec: number;
  categoryBreakdown: { category: string; count: number; total: number }[];
  recentAlerts: { id: string; message: string; severity: string; ts: string }[];
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
  team: string;
  timeline: { ts: string; event: string }[];
  dailyAggregates: { date: string; activeMin: number; apps: number; screenshots: number }[];
  gaps: { start: string; end: string; reason: string }[];
  auditLog: { actor: string; action: string; ts: string }[];
}

export interface Device {
  id: string;
  os: string;
  agentVersion: string;
  lastHealth: "ok" | "degraded" | "offline";
  queueDepth: number;
  permissionsOk: boolean;
  lastSeen: string;
  stale: boolean;
}

export interface EnrollmentCode {
  code: string;
  status: "active" | "used" | "expired";
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
}

export interface Policy {
  version: number;
  content: string;
  createdAt: string;
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

export interface SystemHealth {
  api: { status: string; latencyMs: number };
  worker: { status: string; lastRun: string };
  database: { connected: boolean; latencyMs: number };
  queues: { name: string; depth: number }[];
}

export interface InsightStats {
  coverageGaps: { team: string; missingDays: number }[];
  dataQuality: { metric: string; value: string; status: string }[];
}
