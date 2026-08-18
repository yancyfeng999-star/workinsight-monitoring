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

export const DEVICE_KEYS = [
  "agentVersion",
  "id",
  "lastHealth",
  "lastSeen",
  "os",
  "permissionsOk",
  "queueDepth",
  "stale",
] as const;

export const DASHBOARD_KEYS = [
  "avgDelaySec",
  "categoryBreakdown",
  "coverageRate",
  "onlineDevices",
  "recentAlerts",
] as const;

export const TEAM_SUMMARY_KEYS = ["coverageRate", "id", "memberCount", "name", "trend"] as const;

export const SUBJECT_DETAIL_KEYS = [
  "auditLog",
  "dailyAggregates",
  "gaps",
  "id",
  "name",
  "team",
  "timeline",
] as const;

export const ENROLLMENT_CODE_KEYS = ["code", "createdAt", "expiresAt", "status"] as const;

export const CREATED_ENROLLMENT_KEYS = ["code", "expiresAt"] as const;

export const POLICY_KEYS = ["content", "createdAt", "rolloutPercent", "version"] as const;

export const AUDIT_ENTRY_KEYS = ["action", "actor", "id", "requestId", "target", "ts"] as const;

export const INSIGHT_RESPONSE_KEYS = [
  "coverageGaps",
  "dataQuality",
  "mode",
  "reason",
  "reports",
] as const;

export const SYSTEM_HEALTH_KEYS = ["api", "database", "queues", "worker"] as const;
