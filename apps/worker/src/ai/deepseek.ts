import type { InsightInput, InsightProvider } from "./provider.js";
import { InsightValidationError, validateInsightOutput, type InsightOutput } from "./schema.js";

export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 2_000;

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class DeepSeekProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DeepSeekProviderError";
    this.code = code;
  }
}

export function readDeepSeekConfig(env: NodeJS.ProcessEnv = process.env): DeepSeekConfig | null {
  const apiKey = env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return null;
  const timeoutRaw = env.DEEPSEEK_TIMEOUT_MS;
  const parsedTimeout = timeoutRaw === undefined || timeoutRaw === "" ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw);
  return {
    apiKey,
    baseUrl: (env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, ""),
    model: env.DEEPSEEK_MODEL?.trim() || "deepseek-chat",
    timeoutMs: Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS,
  };
}

export function createDeepSeekProviderFromEnv(env: NodeJS.ProcessEnv = process.env): InsightProvider | null {
  const cfg = readDeepSeekConfig(env);
  return cfg ? createDeepSeekProvider(cfg) : null;
}

export function createDeepSeekProvider(config: DeepSeekConfig): InsightProvider {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? defaultSleep;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = chatCompletionsUrl(config.baseUrl);

  return {
    async generate(input: InsightInput, signal: AbortSignal): Promise<InsightOutput> {
      let lastError: DeepSeekProviderError | undefined;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        if (signal.aborted) {
          throw new DeepSeekProviderError("aborted", "request aborted");
        }
        try {
          return await once(fetchImpl, url, config, input, signal, timeoutMs);
        } catch (err) {
          lastError = toProviderError(err);
          const retryable = lastError.code === "http_429" || /^http_5\d\d$/.test(lastError.code);
          if (!retryable || attempt === MAX_ATTEMPTS) {
            throw lastError;
          }
          await sleep(backoffMs(attempt), signal);
        }
      }
      throw lastError ?? new DeepSeekProviderError("provider_error", "provider failed");
    },
  };
}

async function once(
  fetchImpl: typeof fetch,
  url: string,
  config: DeepSeekConfig,
  input: InsightInput,
  signal: AbortSignal,
  timeoutMs: number
): Promise<InsightOutput> {
  const timeout = withTimeout(signal, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_INSTRUCTION },
          { role: "user", content: JSON.stringify(input) },
        ],
      }),
      signal: timeout.signal,
    });
    if (!response.ok) {
      const code = `http_${response.status}`;
      if (response.status === 429 || response.status >= 500) {
        throw new DeepSeekProviderError(code, `provider returned ${response.status}`);
      }
      throw new DeepSeekProviderError(code, `provider rejected the request (${response.status})`);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new DeepSeekProviderError("invalid_json", "provider returned invalid JSON");
    }
    return parseCompletion(payload, input, config.model);
  } catch (err) {
    if (timeout.timedOut()) {
      throw new DeepSeekProviderError("timeout", "request timed out");
    }
    if (isAbortError(err)) {
      throw new DeepSeekProviderError("aborted", "request aborted");
    }
    throw err;
  } finally {
    timeout.cleanup();
  }
}

function parseCompletion(payload: unknown, input: InsightInput, model: string): InsightOutput {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new DeepSeekProviderError("invalid_json", "provider returned invalid JSON");
  }
  const rec = payload as Record<string, unknown>;
  const choices = rec.choices;
  if (!Array.isArray(choices) || choices.length === 0 || !choices[0] || typeof choices[0] !== "object") {
    throw new DeepSeekProviderError("invalid_json", "provider returned invalid JSON");
  }
  const choice = choices[0] as Record<string, unknown>;
  if (choice.finish_reason === "length") {
    throw new DeepSeekProviderError("invalid_json", "provider returned invalid JSON");
  }
  const message = choice.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new DeepSeekProviderError("invalid_json", "provider returned invalid JSON");
  }
  const content = (message as Record<string, unknown>).content;
  let parsed: unknown = content;
  if (typeof content === "string") {
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new DeepSeekProviderError("invalid_json", "provider returned invalid JSON");
    }
  }
  const normalized = normalizeModelPayload(parsed, model);
  try {
    return validateInsightOutput(normalized, input);
  } catch (err) {
    if (err instanceof InsightValidationError) throw err;
    throw new DeepSeekProviderError("invalid_schema", "provider output failed validation");
  }
}

function normalizeModelPayload(parsed: unknown, model: string): unknown {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return parsed;
  const rec = { ...(parsed as Record<string, unknown>) };
  if (!("provider" in rec)) rec.provider = "deepseek";
  if (!("model" in rec)) rec.model = model;
  if (!("generatedAt" in rec)) rec.generatedAt = new Date().toISOString();
  return rec;
}

function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/chat/completions`;
}

function backoffMs(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 250 * 2 ** (attempt - 1));
}

function withTimeout(
  signal: AbortSignal,
  timeoutMs: number
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener("abort", onAbort);
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    },
  };
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DeepSeekProviderError("aborted", "request aborted"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DeepSeekProviderError("aborted", "request aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "name" in err && (err as { name: string }).name === "AbortError");
}

function toProviderError(err: unknown): DeepSeekProviderError {
  if (err instanceof DeepSeekProviderError) return err;
  if (err instanceof InsightValidationError) {
    return new DeepSeekProviderError(err.code, "provider output failed validation");
  }
  if (isAbortError(err)) return new DeepSeekProviderError("aborted", "request aborted");
  return new DeepSeekProviderError("provider_error", "provider failed");
}

const SYSTEM_INSTRUCTION =
  "Return only a JSON object with keys summary, findings, provider, model, generatedAt. " +
  "Each finding must include title, explanation, evidence, recommendation, and confidence. " +
  "Each evidence item must include name, value, unit, periodStart, and periodEnd. " +
  "Use only the supplied aggregate numbers. Do not invent people, domains, raw events, or secrets. " +
  'provider must be "deepseek". confidence is a number from 0 through 1.';
