"use client";

import { EmptyHint, QueryStatus } from "../components/query-state";
import { formatPercent, formatTime } from "../lib/format";
import { apiFetch, type DashboardStats } from "../lib/api";
import { useAdminQuery } from "../lib/use-admin-query";

export default function DashboardPage() {
  const { data, loading, error, reload } = useAdminQuery<DashboardStats>("/v1/admin/dashboard", apiFetch);

  return (
    <QueryStatus loading={loading} error={error} onRetry={reload}>
      {data ? <DashboardView data={data} /> : <EmptyHint>请先注册设备</EmptyHint>}
    </QueryStatus>
  );
}

function DashboardView({ data }: { data: DashboardStats }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">系统概览</h1>
      </div>

      {data.onlineDevices === 0 ? <div className="alert alert-info">请先注册设备</div> : null}

      <div className="stat-grid">
        <div className="card">
          <div className="card-title">今日覆盖率</div>
          <div className="card-value">{formatPercent(data.coverageRate)}</div>
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
            <div className="empty">暂无分类数据，待设备上报活动后生成</div>
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
                  {data.categoryBreakdown.map((item) => (
                    <tr key={item.category}>
                      <td>{item.category}</td>
                      <td style={{ textAlign: "right" }}>{item.count}</td>
                      <td style={{ textAlign: "right" }}>{item.total}</td>
                      <td style={{ textAlign: "right" }}>
                        {item.total > 0 ? formatPercent(item.count / item.total) : "-"}
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
            <div className="empty">暂无告警。设备健康异常将在此显示</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {data.recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`alert ${
                    alert.severity === "critical"
                      ? "alert-error"
                      : alert.severity === "warning"
                        ? "alert-warning"
                        : "alert-info"
                  }`}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span>{alert.message}</span>
                    <span className="mono" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                      {formatTime(alert.ts)}
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
