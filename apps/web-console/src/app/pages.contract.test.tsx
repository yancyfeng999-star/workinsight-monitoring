import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { loginNavigation } from "../lib/api";
import { mockApi } from "../test/mock-api";
import DashboardPage from "./page";
import DevicesPage from "./devices/page";
import EnrollmentPage from "./enrollment/page";
import InsightPage from "./insight/page";
import PoliciesPage, { POLICY_PLACEHOLDER } from "./policies/page";

const POLICY_TEMPLATE_KEYS = [
  "collection_enabled",
  "window_title_enabled",
  "idle_after_seconds",
  "blocked_apps",
  "blocked_domains",
];
const FORBIDDEN_POLICY_TOKEN = "screen" + "shot";

describe("Dashboard page", () => {
  it("renders live dashboard stats from the admin API", async () => {
    const fetchMock = mockApi({
      "/api/v1/admin/dashboard": {
        body: {
          coverageRate: 0.5,
          onlineDevices: 3,
          avgDelaySec: 12,
          categoryBreakdown: [{ category: "editor", count: 2, total: 4 }],
          recentAlerts: [],
        },
      },
    });

    render(<DashboardPage />);

    expect(await screen.findByText("系统概览")).toBeInTheDocument();
    expect(screen.getByText("在线设备")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("editor")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/admin/dashboard", expect.objectContaining({
      credentials: "same-origin",
    }));
  });

  it("shows 请先注册设备 when there are no online devices", async () => {
    mockApi({
      "/api/v1/admin/dashboard": {
        body: {
          coverageRate: 0,
          onlineDevices: 0,
          avgDelaySec: 0,
          categoryBreakdown: [],
          recentAlerts: [],
        },
      },
    });

    render(<DashboardPage />);
    expect(await screen.findByText("请先注册设备")).toBeInTheDocument();
  });
});

describe("Devices page", () => {
  it("explains the empty state and renders lastSeen null as 从未上报", async () => {
    mockApi({
      "/api/v1/admin/devices": {
        body: [],
      },
    });

    const { unmount } = render(<DevicesPage />);
    expect(await screen.findByText("请先注册设备")).toBeInTheDocument();
    unmount();

    mockApi({
      "/api/v1/admin/devices": {
        body: [
          {
            id: "dev_1",
            os: "macos",
            agentVersion: "0.1.1",
            lastHealth: "offline",
            queueDepth: 0,
            permissionsOk: true,
            lastSeen: null,
            stale: true,
          },
        ],
      },
    });

    render(<DevicesPage />);
    expect(await screen.findByText("从未上报")).toBeInTheDocument();
    expect(screen.getByText("dev_1")).toBeInTheDocument();
  });

  it("shows a retry button on network failure", async () => {
    mockApi({
      "/api/v1/admin/devices": new TypeError("Failed to fetch"),
    });

    render(<DevicesPage />);
    expect(await screen.findByText("网络连接失败，请检查网络后重试")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});

describe("Enrollment page", () => {
  it("requires a subject, omits maxUses, and shows the one-time code only from POST", async () => {
    const fetchMock = mockApi({
      "GET /api/v1/admin/enrollment": { body: [] },
      "POST /api/v1/admin/enrollment": {
        status: 201,
        body: { code: "PLAINTEXT-ONCE", expiresAt: "2026-08-18T12:00:00.000Z" },
      },
    });
    const user = userEvent.setup();

    render(<EnrollmentPage />);
    expect(await screen.findByText("请先选择分析对象并生成一次性注册码")).toBeInTheDocument();
    expect(screen.queryByLabelText("最大使用次数")).toBeNull();

    const selector = screen.getByLabelText("分析对象");
    expect(selector.tagName).toBe("SELECT");
    expect(selector).toBeRequired();

    await user.type(screen.getByLabelText("对象 ID"), "sub_a");
    await user.clear(screen.getByLabelText("有效期 (小时)"));
    await user.type(screen.getByLabelText("有效期 (小时)"), "2");
    await user.click(screen.getByRole("button", { name: "生成" }));

    expect(await screen.findByText("PLAINTEXT-ONCE")).toBeInTheDocument();
    expect(screen.getByText(/明文仅显示这一次/)).toBeInTheDocument();

    const post = fetchMock.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      return String(call[0]) === "/api/v1/admin/enrollment" && init?.method === "POST";
    });
    expect(post).toBeTruthy();
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toEqual({
      subjectId: "sub_a",
      ttlHours: 2,
    });
  });

  it("does not treat the list hash prefix as a reusable secret", async () => {
    mockApi({
      "/api/v1/admin/enrollment": {
        body: [
          {
            code: "ab12cd34ef56",
            status: "active",
            createdAt: "2026-08-18T00:00:00.000Z",
            expiresAt: "2026-08-18T12:00:00.000Z",
          },
        ],
      },
    });

    render(<EnrollmentPage />);
    expect(await screen.findByText("码指纹")).toBeInTheDocument();
    expect(screen.getByText("ab12cd34ef56")).toBeInTheDocument();
    expect(screen.getByText(/哈希前缀/)).toBeInTheDocument();
    expect(screen.queryByText(/列表.*注册密钥/)).toBeTruthy();
  });
});

describe("Policies page", () => {
  it("uses allowed collection keys and posts content plus rolloutPercent", async () => {
    const fetchMock = mockApi({
      "GET /api/v1/admin/policies": { body: [] },
      "POST /api/v1/admin/policies": {
        status: 201,
        body: {
          version: 1,
          content: '{"collection_enabled":true}',
          createdAt: "2026-08-18T00:00:00.000Z",
          rolloutPercent: 10,
        },
      },
    });
    const user = userEvent.setup();

    render(<PoliciesPage />);
    expect(await screen.findByText("请先发布采集策略")).toBeInTheDocument();

    const textarea = screen.getByLabelText("策略内容 (JSON)");
    const placeholder = textarea.getAttribute("placeholder") ?? "";
    expect(placeholder).toBe(POLICY_PLACEHOLDER);
    for (const key of POLICY_TEMPLATE_KEYS) {
      expect(placeholder).toContain(key);
    }
    expect(placeholder.toLowerCase().includes(FORBIDDEN_POLICY_TOKEN)).toBe(false);

    fireEvent.change(textarea, {
      target: {
        value:
          '{"collection_enabled":true,"window_title_enabled":false,"idle_after_seconds":300,"blocked_apps":[],"blocked_domains":[]}',
      },
    });
    fireEvent.change(screen.getByLabelText("灰度比例 (%)"), { target: { value: "10" } });
    await user.click(screen.getByRole("button", { name: "创建新版本" }));

    const post = fetchMock.mock.calls.find((call) => {
      const init = call[1] as RequestInit | undefined;
      return String(call[0]) === "/api/v1/admin/policies" && init?.method === "POST";
    });
    expect(post).toBeTruthy();
    const body = JSON.parse(String((post?.[1] as RequestInit).body)) as {
      content: string;
      rolloutPercent: number;
    };
    expect(body.rolloutPercent).toBe(10);
    expect(body.content).toContain("collection_enabled");
    expect(body.content.toLowerCase().includes(FORBIDDEN_POLICY_TOKEN)).toBe(false);
  });
});

describe("Insight page", () => {
  it("renders the rules_only contract without labeling it as AI-generated", async () => {
    mockApi({
      "/api/v1/admin/insight": {
        body: {
          mode: "rules_only",
          reason: "model reports unavailable",
          coverageGaps: [{ team: "平台", missingDays: 2 }],
          dataQuality: [{ metric: "stale_devices", value: "1", status: "warning" }],
          reports: [],
        },
      },
    });

    render(<InsightPage />);
    expect(await screen.findByText(/规则统计/)).toBeInTheDocument();
    expect(screen.getByText(/model reports unavailable/)).toBeInTheDocument();
    expect(screen.getByText("平台")).toBeInTheDocument();
    expect(screen.getByText("stale_devices")).toBeInTheDocument();
    expect(screen.queryByText(/AI 生成/)).toBeNull();
    expect(screen.queryByText(/DeepSeek/i)).toBeNull();
    expect(screen.queryByText("AI 洞察")).toBeNull();
  });

  it("shows 当前账号无此权限 on 403", async () => {
    mockApi({
      "/api/v1/admin/insight": { status: 403, text: "forbidden" },
    });

    render(<InsightPage />);
    expect(await screen.findByText("当前账号无此权限")).toBeInTheDocument();
  });
});

describe("global 401 path", () => {
  it("displays 登录已过期 and redirects once", async () => {
    const redirect = vi.spyOn(loginNavigation, "go").mockImplementation(() => undefined);
    mockApi({
      "/api/v1/admin/dashboard": { status: 401, text: "unauthorized" },
    });

    render(<DashboardPage />);
    expect(await screen.findByText("登录已过期")).toBeInTheDocument();
    expect(redirect).toHaveBeenCalledTimes(1);
  });
});
