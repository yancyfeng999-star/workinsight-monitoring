import { createHash } from "node:crypto";
import type pg from "pg";
import type { InsightDataQualityFlags, InsightInput, InsightProvider } from "../ai/provider.js";
import { validateInsightOutput, type InsightOutput } from "../ai/schema.js";

const FORBIDDEN_INPUT = /window[_-]?title|raw[_-]?event|cookie|authorization|bearer|api[_-]?key|device[_-]?token|prompt|password|secret/i;

export interface InsightPersistence {
  findReportHash(orgId: string, teamId: string, date: string): Promise<string | null>;
  markJobRunning(input: InsightInput, hash: string): Promise<{ jobId: string; attempts: number }>;
  saveReport(jobId: string, input: InsightInput, hash: string, output: InsightOutput): Promise<void>;
  markJobFailed(jobId: string, errorCode: string): Promise<void>;
}

export interface InsightJobResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  fallback: "none" | "rules_only";
}

export interface InsightSnapshotFields {
  orgId: string;
  teamId: string;
  date: string;
  coverageRate: number;
  activeSeconds: number;
  categoryTotals: Record<string, number>;
  switchCounts: Record<string, number>;
  dataQualityFlags: InsightDataQualityFlags;
}

export function buildInsightInput(fields: InsightSnapshotFields): InsightInput {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) {
    throw new Error("insight snapshot date must be YYYY-MM-DD");
  }
  const start = new Date(`${fields.date}T00:00:00.000Z`);
  const input: InsightInput = {
    orgId: String(fields.orgId),
    teamId: String(fields.teamId),
    date: fields.date,
    periodStart: start.toISOString(),
    periodEnd: new Date(start.getTime() + 86_400_000).toISOString(),
    coverageRate: asFiniteNumber(fields.coverageRate),
    activeSeconds: asFiniteNumber(fields.activeSeconds),
    categoryTotals: copyNumberRecord(fields.categoryTotals),
    switchCounts: copyNumberRecord(fields.switchCounts),
    dataQualityFlags: {
      lowCoverage: Boolean(fields.dataQualityFlags.lowCoverage),
      zeroActiveSeconds: Boolean(fields.dataQualityFlags.zeroActiveSeconds),
      missingCategories: Boolean(fields.dataQualityFlags.missingCategories),
    },
  };
  assertSafeInsightInput(input);
  return input;
}

export function hashEvidenceSnapshot(input: InsightInput): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(input))).digest("hex");
}

export function assertSafeInsightInput(input: InsightInput): void {
  const serialized = JSON.stringify(input);
  if (FORBIDDEN_INPUT.test(serialized)) {
    throw new Error("insight input contains a forbidden field");
  }
}

export async function processInsightSnapshots(
  snapshots: InsightInput[],
  provider: InsightProvider,
  persist: InsightPersistence,
  signal: AbortSignal
): Promise<InsightJobResult> {
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const input of snapshots) {
    if (signal.aborted) break;
    assertSafeInsightInput(input);
    const hash = hashEvidenceSnapshot(input);
    const existing = await persist.findReportHash(input.orgId, input.teamId, input.date);
    if (existing === hash) {
      skipped += 1;
      continue;
    }
    const job = await persist.markJobRunning(input, hash);
    try {
      const raw = await provider.generate(input, signal);
      const output = validateInsightOutput(raw, input);
      await persist.saveReport(job.jobId, input, hash, output);
      succeeded += 1;
    } catch (err) {
      await persist.markJobFailed(job.jobId, errorCodeFrom(err));
      failed += 1;
    }
  }

  return {
    processed: snapshots.length,
    succeeded,
    failed,
    skipped,
    fallback: failed > 0 && succeeded === 0 ? "rules_only" : "none",
  };
}

export function createPostgresInsightStore(pool: pg.Pool): InsightPersistence {
  return {
    async findReportHash(orgId, teamId, date) {
      const res = await pool.query<{ evidence_snapshot_hash: string }>(
        `SELECT evidence_snapshot_hash
         FROM insight_reports
         WHERE org_id = $1 AND team_id = $2 AND date = $3::date
         LIMIT 1`,
        [orgId, teamId, date]
      );
      return res.rows[0]?.evidence_snapshot_hash ?? null;
    },

    async markJobRunning(input, hash) {
      const res = await pool.query<{ id: string | number; attempts: number }>(
        `INSERT INTO insight_jobs (
           org_id, team_id, date, status, attempts, provider, model,
           evidence_snapshot, evidence_snapshot_hash, started_at, updated_at, error_code
         ) VALUES ($1,$2,$3,'running',1,'deepseek',NULL,$4,$5, now(), now(), NULL)
         ON CONFLICT (org_id, team_id, date) DO UPDATE SET
           status = 'running',
           attempts = insight_jobs.attempts + 1,
           evidence_snapshot = EXCLUDED.evidence_snapshot,
           evidence_snapshot_hash = EXCLUDED.evidence_snapshot_hash,
           error_code = NULL,
           started_at = now(),
           updated_at = now(),
           finished_at = NULL
         RETURNING id, attempts`,
        [input.orgId, input.teamId, input.date, JSON.stringify(input), hash]
      );
      return { jobId: String(res.rows[0]?.id), attempts: Number(res.rows[0]?.attempts ?? 1) };
    },

    async saveReport(jobId, input, hash, output) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE insight_jobs
           SET status = 'succeeded',
               model = $2,
               error_code = NULL,
               finished_at = now(),
               updated_at = now()
           WHERE id = $1`,
          [jobId, output.model]
        );
        await client.query(
          `INSERT INTO insight_reports (
             org_id, team_id, date, job_id, provider, model, output, evidence_snapshot_hash, generated_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (org_id, team_id, date) DO UPDATE SET
             job_id = EXCLUDED.job_id,
             provider = EXCLUDED.provider,
             model = EXCLUDED.model,
             output = EXCLUDED.output,
             evidence_snapshot_hash = EXCLUDED.evidence_snapshot_hash,
             generated_at = EXCLUDED.generated_at`,
          [
            input.orgId,
            input.teamId,
            input.date,
            jobId,
            output.provider,
            output.model,
            JSON.stringify(output),
            hash,
            output.generatedAt,
          ]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async markJobFailed(jobId, errorCode) {
      await pool.query(
        `UPDATE insight_jobs
         SET status = 'failed',
             error_code = $2,
             finished_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [jobId, errorCode]
      );
    },
  };
}

export async function loadCompletedSnapshots(pool: pg.Pool, date: string): Promise<InsightInput[]> {
  const summaries = await pool.query<{
    org_id: string;
    team_id: string;
    date: string;
    coverage_rate: string | number | null;
  }>(
    `SELECT org_id, team_id, to_char(date, 'YYYY-MM-DD') AS date, coverage_rate
     FROM team_summaries
     WHERE date = $1::date`,
    [date]
  );

  const snapshots: InsightInput[] = [];
  for (const row of summaries.rows) {
    const totals = await pool.query<{ category: string; total_seconds: number; switch_count: number }>(
      `SELECT da.category,
              COALESCE(SUM(da.total_seconds), 0)::int AS total_seconds,
              COALESCE(SUM(da.segment_count), 0)::int AS switch_count
       FROM team_memberships tm
       JOIN subjects s ON s.subject_id = tm.subject_id AND s.org_id = $1
       JOIN daily_aggregates da
         ON da.subject_id = s.subject_id AND da.org_id = $1 AND da.date = $3::date
       WHERE tm.team_id = $2
       GROUP BY da.category`,
      [row.org_id, row.team_id, row.date]
    );
    const categoryTotals: Record<string, number> = {};
    const switchCounts: Record<string, number> = {};
    let activeSeconds = 0;
    for (const total of totals.rows) {
      categoryTotals[total.category] = Number(total.total_seconds);
      switchCounts[total.category] = Number(total.switch_count);
      activeSeconds += Number(total.total_seconds);
    }
    const coverageRate = Number(row.coverage_rate ?? 0);
    snapshots.push(
      buildInsightInput({
        orgId: row.org_id,
        teamId: row.team_id,
        date: row.date,
        coverageRate: Number.isFinite(coverageRate) ? coverageRate : 0,
        activeSeconds,
        categoryTotals,
        switchCounts,
        dataQualityFlags: {
          lowCoverage: coverageRate < 0.5,
          zeroActiveSeconds: activeSeconds === 0,
          missingCategories: Object.keys(categoryTotals).length === 0,
        },
      })
    );
  }
  return snapshots;
}

export async function runInsightJobs(
  pool: pg.Pool,
  provider: InsightProvider | null,
  options: { targetDate?: string; signal?: AbortSignal } = {}
): Promise<InsightJobResult> {
  if (!provider) {
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, fallback: "rules_only" };
  }
  const date = options.targetDate ?? yesterdayUtc();
  const snapshots = await loadCompletedSnapshots(pool, date);
  const result = await processInsightSnapshots(
    snapshots,
    provider,
    createPostgresInsightStore(pool),
    options.signal ?? new AbortController().signal
  );
  await pool.query(
    `INSERT INTO worker_watermarks (job_name, last_processed_at)
     VALUES ('insight', now())
     ON CONFLICT (job_name) DO UPDATE SET last_processed_at = now(), updated_at = now()`
  );
  return result;
}

export function errorCodeFrom(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
    return sanitizeErrorCode((err as { code: string }).code);
  }
  return "provider_error";
}

function sanitizeErrorCode(code: string): string {
  const cleaned = code.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64);
  return cleaned.length > 0 ? cleaned : "provider_error";
}

function yesterdayUtc(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

function asFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function copyNumberRecord(value: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = Number(raw);
    if (Number.isFinite(n)) out[key] = n;
  }
  return out;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(rec).sort()) {
      out[key] = canonicalize(rec[key]);
    }
    return out;
  }
  return value;
}
