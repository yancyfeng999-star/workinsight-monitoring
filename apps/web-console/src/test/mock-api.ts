import { vi } from "vitest";

export interface MockApiResult {
  status?: number;
  body?: unknown;
  text?: string;
}

export function mockApi(
  handlers: Record<string, MockApiResult | Error>
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const hit = handlers[`${method} ${url}`] ?? handlers[url];
    if (!hit) {
      return jsonResponse(404, { error: "not found" }, "not found");
    }
    if (hit instanceof Error) throw hit;
    const status = hit.status ?? 200;
    const text =
      hit.text ??
      (typeof hit.body === "string" ? hit.body : JSON.stringify(hit.body ?? ""));
    return jsonResponse(status, hit.body, text);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(status: number, body: unknown, text: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => text,
  };
}
