import type { InsightInput } from "./provider.js";

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

const OUTPUT_KEYS = ["summary", "findings", "provider", "model", "generatedAt"] as const;
const FINDING_KEYS = ["title", "explanation", "evidence", "recommendation", "confidence"] as const;
const METRIC_KEYS = ["name", "value", "unit", "periodStart", "periodEnd"] as const;
const UNITS = new Set(["seconds", "count", "ratio", "percent"]);

export class InsightValidationError extends Error {
  readonly code = "invalid_schema";

  constructor(message: string) {
    super(message);
    this.name = "InsightValidationError";
  }
}

export function validateInsightOutput(raw: unknown, input: InsightInput): InsightOutput {
  const rec = asExactObject(raw, OUTPUT_KEYS, "output");
  if (typeof rec.summary !== "string" || rec.summary.trim().length === 0) {
    throw new InsightValidationError("summary must be a non-empty string");
  }
  if (rec.provider !== "deepseek") {
    throw new InsightValidationError("provider must be deepseek");
  }
  if (typeof rec.model !== "string" || rec.model.trim().length === 0) {
    throw new InsightValidationError("model must be a non-empty string");
  }
  if (typeof rec.generatedAt !== "string" || Number.isNaN(Date.parse(rec.generatedAt))) {
    throw new InsightValidationError("generatedAt must be an ISO timestamp");
  }
  if (!Array.isArray(rec.findings)) {
    throw new InsightValidationError("findings must be an array");
  }
  const snapshot = snapshotBounds(input);
  return {
    summary: rec.summary,
    findings: rec.findings.map((finding, index) => parseFinding(finding, snapshot, index)),
    provider: "deepseek",
    model: rec.model,
    generatedAt: rec.generatedAt,
  };
}

function parseFinding(raw: unknown, snapshot: PeriodBounds, index: number): InsightFinding {
  const rec = asExactObject(raw, FINDING_KEYS, `findings[${index}]`);
  if (typeof rec.title !== "string" || rec.title.trim().length === 0) {
    throw new InsightValidationError(`findings[${index}].title must be a non-empty string`);
  }
  if (typeof rec.explanation !== "string" || rec.explanation.trim().length === 0) {
    throw new InsightValidationError(`findings[${index}].explanation must be a non-empty string`);
  }
  if (typeof rec.recommendation !== "string" || rec.recommendation.trim().length === 0) {
    throw new InsightValidationError(`findings[${index}].recommendation must be a non-empty string`);
  }
  if (typeof rec.confidence !== "number" || !Number.isFinite(rec.confidence) || rec.confidence < 0 || rec.confidence > 1) {
    throw new InsightValidationError(`findings[${index}].confidence must be between 0 and 1`);
  }
  if (!Array.isArray(rec.evidence) || rec.evidence.length === 0) {
    throw new InsightValidationError(`findings[${index}].evidence must be a non-empty array`);
  }
  return {
    title: rec.title,
    explanation: rec.explanation,
    recommendation: rec.recommendation,
    confidence: rec.confidence,
    evidence: rec.evidence.map((metric, metricIndex) => parseMetric(metric, snapshot, index, metricIndex)),
  };
}

function parseMetric(
  raw: unknown,
  snapshot: PeriodBounds,
  findingIndex: number,
  metricIndex: number
): InsightMetric {
  const label = `findings[${findingIndex}].evidence[${metricIndex}]`;
  const rec = asExactObject(raw, METRIC_KEYS, label);
  if (typeof rec.name !== "string" || rec.name.trim().length === 0) {
    throw new InsightValidationError(`${label}.name must be a non-empty string`);
  }
  if (typeof rec.value !== "number" || !Number.isFinite(rec.value)) {
    throw new InsightValidationError(`${label}.value must be a finite number`);
  }
  if (typeof rec.unit !== "string" || !UNITS.has(rec.unit)) {
    throw new InsightValidationError(`${label}.unit is not allowed`);
  }
  if (typeof rec.periodStart !== "string" || typeof rec.periodEnd !== "string") {
    throw new InsightValidationError(`${label} periods must be strings`);
  }
  const start = parsePeriodBound(rec.periodStart, "start");
  const end = parsePeriodBound(rec.periodEnd, "end");
  if (start < snapshot.start || end > snapshot.end || start >= end) {
    throw new InsightValidationError(`${label} period is outside the snapshot window`);
  }
  return {
    name: rec.name,
    value: rec.value,
    unit: rec.unit as InsightMetric["unit"],
    periodStart: rec.periodStart,
    periodEnd: rec.periodEnd,
  };
}

function asExactObject(
  raw: unknown,
  allowed: readonly string[],
  label: string
): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InsightValidationError(`${label} must be an object`);
  }
  const rec = raw as Record<string, unknown>;
  const keys = Object.keys(rec);
  for (const key of keys) {
    if (!allowed.includes(key)) {
      throw new InsightValidationError(`${label} has unknown property ${key}`);
    }
  }
  for (const key of allowed) {
    if (!(key in rec)) {
      throw new InsightValidationError(`${label} is missing ${key}`);
    }
  }
  return rec;
}

interface PeriodBounds {
  start: Date;
  end: Date;
}

export function snapshotBounds(input: Pick<InsightInput, "periodStart" | "periodEnd">): PeriodBounds {
  return {
    start: parsePeriodBound(input.periodStart, "start"),
    end: parsePeriodBound(input.periodEnd, "end"),
  };
}

export function parsePeriodBound(value: string, role: "start" | "end"): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const start = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) {
      throw new InsightValidationError("invalid date bound");
    }
    return role === "end" ? new Date(start.getTime() + 86_400_000) : start;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new InsightValidationError("invalid timestamp bound");
  }
  return new Date(ms);
}
