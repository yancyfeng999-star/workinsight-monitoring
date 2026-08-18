import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./api";

describe("ApiError", () => {
  it("preserves the HTTP status and message for console callers", () => {
    const error = new ApiError(403, "forbidden");

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ApiError");
    expect(error.status).toBe(403);
    expect(error.message).toBe("forbidden");
  });
});

describe("apiFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends same-origin JSON requests under /api without reading cookies", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ user: { username: "admin" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiFetch("/v1/admin/me")).resolves.toEqual({ user: { username: "admin" } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/me");
    expect(init.credentials).toBe("same-origin");
    expect(init.cache).toBe("no-store");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("throws ApiError 401 登录已过期 without leaking the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      })
    );

    await expect(apiFetch("/v1/admin/me")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "登录已过期",
    });
  });
});
