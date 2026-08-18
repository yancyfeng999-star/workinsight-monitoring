"use client";

import { QueryStatus } from "../../components/query-state";
import { formatDateTime } from "../../lib/format";
import { apiFetch, type SystemHealth } from "../../lib/api";
import { useAdminQuery } from "../../lib/use-admin-query";

const API_LABEL: Record<SystemHealth["api"]["status"], string> = {
  ok: "正常",
  degraded: "降级",
};

const WORKER_LABEL: Record<SystemHealth["worker"]["status"], string> = {
  ok: "正常",
  stale: "过期",
  error: "异常",
};

export default function SystemPage() {
  const { data, loading, error, reload } = useAdminQuery<SystemHealth>("/v1/admin/system/health", apiFetch);

  return (
    <QueryStatus loading={loading} error={error} onRetry={reload}>
      {data ? <SystemView health={data} onRefresh={reload} /> : <div className="page empty">请先确认 API 与数据库可用</div>}
    </QueryStatus>
  );
}

function SystemView({ health, onRefresh }: { health: SystemHealth; onRefresh: () => void }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">系统状态</h1>
        <button type="button" className="btn btn-ghost" onClick={onRefresh}>
          刷新
        </button>
      </div>

      <div className="stat-grid">
        <div className="card">
          <div className="card-title">API 服务</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span className={`status-dot ${health.api.status === "ok" ? "ok" : "degraded"}`} />
            <span style={{ fontWeight: 600 }}>{API_LABEL[health.api.status]}</span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
            延迟: {health.api.latencyMs}ms
          </div>
        </div>

        <div className="card">
          <div className="card-title">Worker 服务</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span
              className={`status-dot ${
                health.worker.status === "ok" ? "ok" : health.worker.status === "stale" ? "degraded" : "error"
              }`}
            />
            <span style={{ fontWeight: 600 }}>{WORKER_LABEL[health.worker.status]}</span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
            最近运行: {formatDateTime(health.worker.lastRun, "从未运行")}
          </div>
        </div>

        <div className="card">
          <div className="card-title">数据库</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span className={`status-dot ${health.database.connected ? "connected" : "error"}`} />
            <span style={{ fontWeight: 600 }}>{health.database.connected ? "已连接" : "未连接"}</span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
            延迟: {health.database.latencyMs}ms
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>队列状态</h2>
        {health.queues.length === 0 ? (
          <div className="empty">暂无队列数据。请先注册设备并产生健康上报</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>队列名称</th>
                  <th style={{ textAlign: "right" }}>深度</th>
                  <th style={{ textAlign: "center" }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {health.queues.map((queue) => (
                  <tr key={queue.name}>
                    <td className="mono">{queue.name}</td>
                    <td style={{ textAlign: "right" }}>{queue.depth}</td>
                    <td style={{ textAlign: "center" }}>
                      <span
                        className={`badge ${
                          queue.depth === 0 ? "badge-ok" : queue.depth < 100 ? "badge-warning" : "badge-danger"
                        }`}
                      >
                        {queue.depth === 0 ? "空闲" : queue.depth < 100 ? "正常" : "积压"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
