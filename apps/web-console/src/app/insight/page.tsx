"use client";

import { EmptyHint, QueryStatus } from "../../components/query-state";
import { apiFetch, type InsightResponse } from "../../lib/api";
import { useAdminQuery } from "../../lib/use-admin-query";

export default function InsightPage() {
  const { data, loading, error, reload } = useAdminQuery<InsightResponse>("/v1/admin/insight", apiFetch);

  return (
    <QueryStatus loading={loading} error={error} onRetry={reload}>
      {data ? <InsightView data={data} /> : <EmptyHint>请先创建团队并注册设备后查看规则统计</EmptyHint>}
    </QueryStatus>
  );
}

function InsightView({ data }: { data: InsightResponse }) {
  const rulesOnly = data.mode === "rules_only";

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">数据洞察</h1>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="alert alert-info">
          {rulesOnly
            ? `当前为规则统计，不是模型生成结果。${data.reason ? `原因：${data.reason}` : ""}`
            : "当前包含模型报告。"}
        </div>
        {rulesOnly || data.reports.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            模型报告尚未接入，下方指标来自已存储的覆盖与健康事实。
          </p>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>覆盖缺口</h2>
          {data.coverageGaps.length === 0 ? (
            <div className="empty">暂无覆盖缺口。请先创建团队并接入设备</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>团队</th>
                    <th style={{ textAlign: "right" }}>缺失天数</th>
                  </tr>
                </thead>
                <tbody>
                  {data.coverageGaps.map((gap) => (
                    <tr key={gap.team}>
                      <td>{gap.team}</td>
                      <td style={{ textAlign: "right" }}>
                        <span className={`badge ${gap.missingDays > 3 ? "badge-danger" : "badge-warning"}`}>
                          {gap.missingDays} 天
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>数据质量指标</h2>
          {data.dataQuality.length === 0 ? (
            <div className="empty">暂无质量指标。请先注册设备并上报健康数据</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>数值</th>
                    <th style={{ textAlign: "center" }}>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dataQuality.map((item) => (
                    <tr key={item.metric}>
                      <td>{item.metric}</td>
                      <td className="mono">{item.value}</td>
                      <td style={{ textAlign: "center" }}>
                        <span
                          className={`badge ${
                            item.status === "ok"
                              ? "badge-ok"
                              : item.status === "warning"
                                ? "badge-warning"
                                : "badge-danger"
                          }`}
                        >
                          {item.status === "ok" ? "正常" : item.status === "warning" ? "警告" : "异常"}
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

      {!rulesOnly && data.reports.length > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>模型报告</h2>
          {data.reports.map((report) => (
            <div key={report.generatedAt} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                {report.model} · {report.generatedAt}
              </div>
              <p>{report.summary}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
