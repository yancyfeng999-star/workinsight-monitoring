import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiPost, classifyQueryError, loginNavigation, resetUnauthorizedRedirect } from "./api";

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
    resetUnauthorizedRedirect();
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

  it("parses JSON success bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ onlineDevices: 2 }),
      })
    );

    await expect(apiFetch("/v1/admin/dashboard")).resolves.toEqual({ onlineDevices: 2 });
  });

  it("preserves non-401 text error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "db unavailable",
      })
    );

    await expect(apiFetch("/v1/admin/dashboard")).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
      message: "db unavailable",
    });
  });

  it("throws ApiError 401 登录已过期 without leaking the response body", async () => {
    const redirect = vi.spyOn(loginNavigation, "go").mockImplementation(() => undefined);
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
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("redirects to login only once across repeated 401s", async () => {
    const redirect = vi.spyOn(loginNavigation, "go").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "unauthorized",
      })
    );

    await expect(apiFetch("/v1/admin/devices")).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch("/v1/admin/devices")).rejects.toBeInstanceOf(ApiError);
    expect(redirect).toHaveBeenCalledTimes(1);
  });

  it("classifies 403 as 当前账号无此权限", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "forbidden body",
      })
    );

    await expect(apiFetch("/v1/admin/insight")).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      message: "当前账号无此权限",
    });
  });

  it("keeps login credential failures off the expired-session path", async () => {
    const redirect = vi.spyOn(loginNavigation, "go").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => '{"error":"invalid credentials"}',
      })
    );

    await expect(apiPost("/v1/admin/login", { username: "a", password: "b" })).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: '{"error":"invalid credentials"}',
    });
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("classifyQueryError", () => {
  it("maps network failures for retry UI", () => {
    expect(classifyQueryError(new TypeError("Failed to fetch"))).toEqual({
      kind: "network",
      message: "网络连接失败，请检查网络后重试",
    });
  });
});
