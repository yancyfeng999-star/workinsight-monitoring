import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDeepSeekProvider,
  DeepSeekProviderError,
  DEFAULT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  readDeepSeekConfig,
} from "../src/ai/deepseek.js";
import type { InsightInput, InsightProvider } from "../src/ai/provider.js";
import {
  InsightValidationError,
  validateInsightOutput,
  type InsightOutput,
} from "../src/ai/schema.js";
import {
  buildInsightInput,
  hashEvidenceSnapshot,
  processInsightSnapshots,
  type InsightPersistence,
} from "../src/jobs/insight.js";

const DATE = "2026-08-17";
const PERIOD_START = "2026-08-17T00:00:00.000Z";
const PERIOD_END = "2026-08-18T00:00:00.000Z";

function sampleInput(overrides: Partial<InsightInput> = {}): InsightInput {
  return buildInsightInput({
    orgId: "org_a",
    teamId: "team_alpha",
    date: DATE,
    coverageRate: 0.8,
    activeSeconds: 7200,
    categoryTotals: { development: 5400, communication: 1800 },
    switchCounts: { development: 12, communication: 4 },
    dataQualityFlags: {
      lowCoverage: false,
      zeroActiveSeconds: false,
      missingCategories: false,
    },
    ...overrides,
  });
}

function validOutput(input: InsightInput, overrides: Partial<InsightOutput> = {}): InsightOutput {
  return {
    summary: "Team time concentrated in development.",
    findings: [
      {
        title: "Development focus",
        explanation: "Most active seconds were development.",
        evidence: [
          {
            name: "development_seconds",
            value: input.categoryTotals.development ?? input.activeSeconds,
            unit: "seconds",
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
          },
        ],
        recommendation: "Protect consecutive development blocks.",
        confidence: 0.82,
      },
    ],
    provider: "deepseek",
    model: "deepseek-chat",
    generatedAt: "2026-08-18T01:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function completionBody(content: unknown, model = "deepseek-chat"): unknown {
  return {
    id: "chatcmpl-test",
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  };
}

class MemoryPersistence implements InsightPersistence {
  jobs: Array<{
    id: string;
    orgId: string;
    teamId: string;
    date: string;
    status: "running" | "succeeded" | "failed";
    attempts: number;
    hash: string;
    errorCode: string | null;
  }> = [];
  reports: Array<{
    jobId: string;
    orgId: string;
    teamId: string;
    date: string;
    hash: string;
    output: InsightOutput;
  }> = [];

  async findReportHash(orgId: string, teamId: string, date: string): Promise<string | null> {
    return this.reports.find((row) => row.orgId === orgId && row.teamId === teamId && row.date === date)?.hash ?? null;
  }

  async markJobRunning(
    input: InsightInput,
    hash: string
  ): Promise<{ jobId: string; attempts: number }> {
    const existing = this.jobs.find(
      (job) => job.orgId === input.orgId && job.teamId === input.teamId && job.date === input.date
    );
    if (existing) {
      existing.status = "running";
      existing.attempts += 1;
      existing.hash = hash;
      existing.errorCode = null;
      return { jobId: existing.id, attempts: existing.attempts };
    }
    const job = {
      id: `job_${this.jobs.length + 1}`,
      orgId: input.orgId,
      teamId: input.teamId,
      date: input.date,
      status: "running" as const,
      attempts: 1,
      hash,
      errorCode: null,
    };
    this.jobs.push(job);
    return { jobId: job.id, attempts: job.attempts };
  }

  async saveReport(jobId: string, input: InsightInput, hash: string, output: InsightOutput): Promise<void> {
    const job = this.jobs.find((row) => row.id === jobId);
    if (job) {
      job.status = "succeeded";
      job.hash = hash;
    }
    this.reports = this.reports.filter(
      (row) => !(row.orgId === input.orgId && row.teamId === input.teamId && row.date === input.date)
    );
    this.reports.push({
      jobId,
      orgId: input.orgId,
      teamId: input.teamId,
      date: input.date,
      hash,
      output,
    });
  }

  async markJobFailed(jobId: string, errorCode: string): Promise<void> {
    const job = this.jobs.find((row) => row.id === jobId);
    if (job) {
      job.status = "failed";
      job.errorCode = errorCode;
    }
  }
}

function fakeProvider(impl: InsightProvider["generate"]): InsightProvider {
  return { generate: impl };
}

describe("insight input snapshot", () => {
  it("includes only aggregate facts and derived period bounds", () => {
    const input = sampleInput();
    assert.deepEqual(Object.keys(input).sort(), [
      "activeSeconds",
      "categoryTotals",
      "coverageRate",
      "dataQualityFlags",
      "date",
      "orgId",
      "periodEnd",
      "periodStart",
      "switchCounts",
      "teamId",
    ]);
    assert.equal(input.periodStart, PERIOD_START);
    assert.equal(input.periodEnd, PERIOD_END);
    const serialized = JSON.stringify(input);
    assert.equal(/window[_-]?title/i.test(serialized), false);
    assert.equal(/raw[_-]?event/i.test(serialized), false);
    assert.equal(/cookie/i.test(serialized), false);
    assert.equal(/authorization/i.test(serialized), false);
    assert.equal(/api[_-]?key/i.test(serialized), false);
    assert.equal(/device[_-]?token/i.test(serialized), false);
    assert.equal(/prompt/i.test(serialized), false);
    assert.equal(/secret/i.test(serialized), false);
    assert.equal(serialized.includes("github.com/org/repo"), false);
  });

  it("hashes the same snapshot stably", () => {
    const a = sampleInput();
    const b = sampleInput();
    assert.equal(hashEvidenceSnapshot(a), hashEvidenceSnapshot(b));
    assert.notEqual(hashEvidenceSnapshot(a), hashEvidenceSnapshot(sampleInput({ activeSeconds: 1 })));
  });
});

describe("insight output schema", () => {
  it("accepts schema-valid output", () => {
    const input = sampleInput();
    const output = validateInsightOutput(validOutput(input), input);
    assert.equal(output.provider, "deepseek");
    assert.equal(output.findings[0]?.evidence.length, 1);
  });

  it("rejects unknown output properties", () => {
    const input = sampleInput();
    assert.throws(
      () => validateInsightOutput({ ...validOutput(input), extra: true }, input),
      InsightValidationError
    );
  });

  it("rejects empty evidence arrays", () => {
    const input = sampleInput();
    const output = validOutput(input);
    output.findings[0]!.evidence = [];
    assert.throws(() => validateInsightOutput(output, input), InsightValidationError);
  });

  it("rejects confidence outside 0 through 1", () => {
    const input = sampleInput();
    const high = validOutput(input);
    high.findings[0]!.confidence = 1.2;
    assert.throws(() => validateInsightOutput(high, input), InsightValidationError);
    const low = validOutput(input);
    low.findings[0]!.confidence = -0.01;
    assert.throws(() => validateInsightOutput(low, input), InsightValidationError);
  });

  it("rejects evidence periods outside the snapshot period", () => {
    const input = sampleInput();
    const output = validOutput(input);
    output.findings[0]!.evidence[0]!.periodStart = "2026-08-16T00:00:00.000Z";
    assert.throws(() => validateInsightOutput(output, input), InsightValidationError);
  });

  it("rejects invalid JSON payloads that are not objects", () => {
    const input = sampleInput();
    assert.throws(() => validateInsightOutput("not-json", input), InsightValidationError);
    assert.throws(() => validateInsightOutput(null, input), InsightValidationError);
  });
});

describe("DeepSeek adapter", () => {
  it("uses the configured base URL, model, and 30s default timeout", async () => {
    const input = sampleInput();
    const output = validOutput(input);
    let seenUrl = "";
    let seenAuth = "";
    let seenModel = "";
    const provider = createDeepSeekProvider({
      apiKey: "sk-test-key",
      baseUrl: "https://example.test/v1",
      model: "deepseek-chat",
      fetchImpl: async (url, init) => {
        seenUrl = String(url);
        seenAuth = String(new Headers(init?.headers).get("authorization"));
        const body = JSON.parse(String(init?.body)) as { model: string };
        seenModel = body.model;
        return jsonResponse(200, completionBody(JSON.stringify(output)));
      },
    });
    const result = await provider.generate(input, new AbortController().signal);
    assert.equal(seenUrl, "https://example.test/v1/chat/completions");
    assert.equal(seenAuth, "Bearer sk-test-key");
    assert.equal(seenModel, "deepseek-chat");
    assert.equal(result.summary, output.summary);
    assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
    assert.equal(MAX_ATTEMPTS, 3);
  });

  it("retries 429 then succeeds", async () => {
    const input = sampleInput();
    const delays: number[] = [];
    let calls = 0;
    const provider = createDeepSeekProvider({
      apiKey: "sk-test-key",
      baseUrl: "https://example.test",
      model: "deepseek-chat",
      sleep: async (ms) => {
        delays.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) return jsonResponse(429, { error: { message: "rate limited" } });
        return jsonResponse(200, completionBody(JSON.stringify(validOutput(input))));
      },
    });
    const result = await provider.generate(input, new AbortController().signal);
    assert.equal(calls, 3);
    assert.equal(delays.length, 2);
    assert.ok(delays.every((ms) => ms >= 0 && ms <= 2_000));
    assert.equal(result.provider, "deepseek");
  });

  it("retries 5xx then fails after three attempts", async () => {
    const input = sampleInput();
    let calls = 0;
    const provider = createDeepSeekProvider({
      apiKey: "sk-test-key",
      baseUrl: "https://example.test",
      model: "deepseek-chat",
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(503, { error: { message: "unavailable" } });
      },
    });
    await assert.rejects(
      () => provider.generate(input, new AbortController().signal),
      (err: unknown) => {
        assert.ok(err instanceof DeepSeekProviderError);
        assert.equal(err.code, "http_503");
        return true;
      }
    );
    assert.equal(calls, 3);
  });

  it("does not retry authentication or validation 4xx", async () => {
    const input = sampleInput();
    let calls = 0;
    const provider = createDeepSeekProvider({
      apiKey: "sk-test-key",
      baseUrl: "https://example.test",
      model: "deepseek-chat",
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(401, { error: { message: "invalid api key sk-leaked" } });
      },
    });
    await assert.rejects(
      () => provider.generate(input, new AbortController().signal),
      (err: unknown) => {
        assert.ok(err instanceof DeepSeekProviderError);
        assert.equal(err.code, "http_401");
        return true;
      }
    );
    assert.equal(calls, 1);
  });

  it("times out without leaking request details", async () => {
    const input = sampleInput();
    const provider = createDeepSeekProvider({
      apiKey: "sk-secret-live",
      baseUrl: "https://example.test",
      model: "deepseek-chat",
      timeoutMs: 15,
      fetchImpl: async (_url, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error("missing signal");
        await new Promise<void>((resolve, reject) => {
          if (signal.aborted) {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
            return;
          }
          signal.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        });
        return jsonResponse(200, {});
      },
    });
    await assert.rejects(
      () => provider.generate(input, new AbortController().signal),
      (err: unknown) => {
        assert.ok(err instanceof DeepSeekProviderError);
        assert.equal(err.code, "timeout");
        const text = String(err);
        assert.equal(text.includes("sk-secret-live"), false);
        assert.equal(text.includes("Protect consecutive"), false);
        assert.equal(text.includes("Authorization"), false);
        return true;
      }
    );
  });

  it("rejects invalid JSON from the model", async () => {
    const input = sampleInput();
    const provider = createDeepSeekProvider({
      apiKey: "sk-test-key",
      baseUrl: "https://example.test",
      model: "deepseek-chat",
      fetchImpl: async () => jsonResponse(200, completionBody("not-json{")),
    });
    await assert.rejects(
      () => provider.generate(input, new AbortController().signal),
      (err: unknown) => {
        assert.ok(err instanceof DeepSeekProviderError);
        assert.equal(err.code, "invalid_json");
        return true;
      }
    );
  });

  it("redacts secrets from provider errors", async () => {
    const input = sampleInput();
    const provider = createDeepSeekProvider({
      apiKey: "sk-super-secret-value",
      baseUrl: "https://example.test",
      model: "deepseek-chat",
      fetchImpl: async () =>
        jsonResponse(400, {
          error: {
            message: "bad request using Bearer sk-super-secret-value and prompt Team time",
          },
        }),
    });
    await assert.rejects(
      () => provider.generate(input, new AbortController().signal),
      (err: unknown) => {
        assert.ok(err instanceof DeepSeekProviderError);
        const dumped = JSON.stringify(err) + String(err) + (err instanceof Error ? err.message : "");
        assert.equal(dumped.includes("sk-super-secret-value"), false);
        assert.equal(/Bearer\s+sk-/i.test(dumped), false);
        assert.equal(dumped.includes("Team time"), false);
        return true;
      }
    );
  });

  it("reads env configuration without treating a missing key as a live call", () => {
    assert.equal(
      readDeepSeekConfig({
        DEEPSEEK_BASE_URL: "https://api.deepseek.com",
        DEEPSEEK_MODEL: "deepseek-chat",
        DEEPSEEK_TIMEOUT_MS: "15000",
      }),
      null
    );
    const cfg = readDeepSeekConfig({
      DEEPSEEK_API_KEY: "sk-env",
      DEEPSEEK_BASE_URL: "https://api.deepseek.com",
      DEEPSEEK_MODEL: "deepseek-chat",
      DEEPSEEK_TIMEOUT_MS: "15000",
    });
    assert.ok(cfg);
    assert.equal(cfg.timeoutMs, 15_000);
    assert.equal(cfg.model, "deepseek-chat");
    assert.equal(cfg.baseUrl, "https://api.deepseek.com");
  });
});

describe("insight job", () => {
  it("persists schema-valid provider output", async () => {
    const input = sampleInput();
    const persist = new MemoryPersistence();
    const output = validOutput(input);
    const result = await processInsightSnapshots(
      [input],
      fakeProvider(async () => output),
      persist,
      new AbortController().signal
    );
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.fallback, "none");
    assert.equal(persist.reports.length, 1);
    assert.equal(persist.jobs[0]?.status, "succeeded");
    assert.equal(persist.reports[0]?.output.summary, output.summary);
    assert.equal(persist.reports[0]?.hash, hashEvidenceSnapshot(input));
  });

  it("rejects invalid provider schema and falls back to rules_only", async () => {
    const input = sampleInput();
    const persist = new MemoryPersistence();
    const aggregates = [{ orgId: input.orgId, date: input.date, total_seconds: 7200 }];
    const frozen = structuredClone(aggregates);
    const bad = validOutput(input);
    bad.findings[0]!.evidence = [];
    const result = await processInsightSnapshots(
      [input],
      fakeProvider(async () => bad),
      persist,
      new AbortController().signal
    );
    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.fallback, "rules_only");
    assert.equal(persist.reports.length, 0);
    assert.equal(persist.jobs[0]?.status, "failed");
    assert.equal(persist.jobs[0]?.errorCode, "invalid_schema");
    assert.deepEqual(aggregates, frozen);
  });

  it("does not persist a report when the provider times out", async () => {
    const input = sampleInput();
    const persist = new MemoryPersistence();
    const result = await processInsightSnapshots(
      [input],
      fakeProvider(async (_input, signal) => {
        if (signal.aborted) throw new DeepSeekProviderError("timeout", "request timed out");
        throw new DeepSeekProviderError("timeout", "request timed out");
      }),
      persist,
      new AbortController().signal
    );
    assert.equal(result.fallback, "rules_only");
    assert.equal(persist.reports.length, 0);
    assert.equal(persist.jobs[0]?.errorCode, "timeout");
  });

  it("does not delete or rewrite rule aggregates after a failed model call", async () => {
    const input = sampleInput();
    const persist = new MemoryPersistence();
    const ruleAggregates = {
      daily_aggregates: [{ category: "development", total_seconds: 5400 }],
      team_summaries: [{ coverage_rate: 0.8, avg_active_seconds: 7200 }],
    };
    const frozen = structuredClone(ruleAggregates);
    await processInsightSnapshots(
      [input],
      fakeProvider(async () => {
        throw new DeepSeekProviderError("http_500", "upstream failed");
      }),
      persist,
      new AbortController().signal
    );
    assert.deepEqual(ruleAggregates, frozen);
    assert.equal(persist.reports.length, 0);
    assert.equal(persist.jobs[0]?.status, "failed");
    assert.equal(persist.jobs[0]?.errorCode, "http_500");
  });

  it("skips regeneration when the evidence snapshot hash is unchanged", async () => {
    const input = sampleInput();
    const persist = new MemoryPersistence();
    const output = validOutput(input);
    await processInsightSnapshots(
      [input],
      fakeProvider(async () => output),
      persist,
      new AbortController().signal
    );
    let calls = 0;
    const second = await processInsightSnapshots(
      [input],
      fakeProvider(async () => {
        calls += 1;
        return output;
      }),
      persist,
      new AbortController().signal
    );
    assert.equal(calls, 0);
    assert.equal(second.skipped, 1);
    assert.equal(persist.reports.length, 1);
  });
});

describe("insight source boundaries", () => {
  it("does not store keys or prompts and does not mutate rule tables", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const migration = readFileSync(resolve(here, "../../../database/migrations/004_insights.sql"), "utf8");
    assert.match(migration, /CREATE TABLE IF NOT EXISTS insight_jobs/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS insight_reports/);
    assert.match(migration, /evidence_snapshot_hash/);
    assert.match(migration, /error_code/);
    assert.equal(/\bapi_key\b/i.test(migration), false);
    assert.equal(/\bprompt\b/i.test(migration), false);
    assert.equal(/\bauthorization\b/i.test(migration), false);

    const jobSrc = readFileSync(resolve(here, "../src/jobs/insight.ts"), "utf8");
    assert.equal(/DELETE\s+FROM\s+(daily_aggregates|team_summaries)/i.test(jobSrc), false);
    assert.equal(/UPDATE\s+(daily_aggregates|team_summaries)/i.test(jobSrc), false);

    const deepseekSrc = readFileSync(resolve(here, "../src/ai/deepseek.ts"), "utf8");
    assert.equal(deepseekSrc.includes("console.log"), false);
    assert.match(deepseekSrc, /Authorization/);
  });
});
