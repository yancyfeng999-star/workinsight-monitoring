"use client";

import { useEffect, useState } from "react";

interface SystemHealth {
  api: { status: string; latencyMs: number };
  worker: { status: string; lastRun: string };
  database: { connected: boolean; latencyMs: number };
  queues: { name: string; depth: number }[];
}

export default function SystemPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function fetchHealth() {
    setLoading(true);
    fetch("/api/v1/admin/system/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setHealth)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchHealth();
  }, []);

  if (loading) return <div className="page loading">加载中...</div>;
  if (error) return <div className="page error-box">加载失败: {error}</div>;
  if (!health) return <div className="page empty">暂无系统数据</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">系统状态</h1>
        <button className="btn btn-ghost" onClick={fetchHealth}>
          刷新
        </button>
      </div>

      <div className="stat-grid">
        <div className="card">
          <div className="card-title">API 服务</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span className={`status-dot ${health.api.status === "ok" ? "ok" : "error"}`} />
            <span style={{ fontWeight: 600 }}>{health.api.status === "ok" ? "正常" : "异常"}</span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
            延迟: {health.api.latencyMs}ms
          </div>
        </div>

        <div className="card">
          <div className="card-title">Worker 服务</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span className={`status-dot ${health.worker.status === "ok" ? "ok" : "error"}`} />
            <span style={{ fontWeight: 600 }}>{health.worker.status === "ok" ? "正常" : "异常"}</span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
            最近运行: {new Date(health.worker.lastRun).toLocaleString("zh-CN")}
          </div>
        </div>

        <div className="card">
          <div className="card-title">数据库</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
            <span className={`status-dot ${health.database.connected ? "connected" : "error"}`} />
            <span style={{ fontWeight: 600 }}>
              {health.database.connected ? "已连接" : "未连接"}
            </span>
          </div>
          <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginTop: 4 }}>
            延迟: {health.database.latencyMs}ms
          </div>
        </div>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>队列状态</h2>
        {health.queues.length === 0 ? (
          <div className="empty">暂无队列</div>
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
                {health.queues.map((q) => (
                  <tr key={q.name}>
                    <td className="mono">{q.name}</td>
                    <td style={{ textAlign: "right" }}>{q.depth}</td>
                    <td style={{ textAlign: "center" }}>
                      <span
                        className={`badge ${
                          q.depth === 0 ? "badge-ok" : q.depth < 100 ? "badge-warning" : "badge-danger"
                        }`}
                      >
                        {q.depth === 0 ? "空闲" : q.depth < 100 ? "正常" : "积压"}
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
