"use client";

import { useEffect, useState } from "react";

interface DashboardStats {
  coverageRate: number;
  onlineDevices: number;
  avgDelaySec: number;
  categoryBreakdown: { category: string; count: number; total: number }[];
  recentAlerts: { id: string; message: string; severity: string; ts: string }[];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/dashboard")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page loading">加载中...</div>;
  if (error) return <div className="page error-box">加载失败: {error}</div>;
  if (!data) return <div className="page empty">暂无数据</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">系统概览</h1>
      </div>

      <div className="stat-grid">
        <div className="card">
          <div className="card-title">今日覆盖率</div>
          <div className="card-value">{(data.coverageRate * 100).toFixed(1)}%</div>
        </div>
        <div className="card">
          <div className="card-title">在线设备</div>
          <div className="card-value">{data.onlineDevices}</div>
        </div>
        <div className="card">
          <div className="card-title">平均数据延迟</div>
          <div className="card-value">{data.avgDelaySec}s</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>分类明细</h2>
          {data.categoryBreakdown.length === 0 ? (
            <div className="empty">暂无分类数据</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>分类</th>
                    <th style={{ textAlign: "right" }}>已采集</th>
                    <th style={{ textAlign: "right" }}>总量</th>
                    <th style={{ textAlign: "right" }}>覆盖率</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categoryBreakdown.map((c) => (
                    <tr key={c.category}>
                      <td>{c.category}</td>
                      <td style={{ textAlign: "right" }}>{c.count}</td>
                      <td style={{ textAlign: "right" }}>{c.total}</td>
                      <td style={{ textAlign: "right" }}>
                        {c.total > 0 ? ((c.count / c.total) * 100).toFixed(1) + "%" : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>最近告警</h2>
          {data.recentAlerts.length === 0 ? (
            <div className="empty">暂无告警</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.recentAlerts.map((a) => (
                <div
                  key={a.id}
                  className={`alert ${
                    a.severity === "critical"
                      ? "alert-error"
                      : a.severity === "warning"
                      ? "alert-warning"
                      : "alert-info"
                  }`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{a.message}</span>
                    <span className="mono" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                      {new Date(a.ts).toLocaleTimeString("zh-CN")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
