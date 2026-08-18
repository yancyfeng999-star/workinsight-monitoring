"use client";

import { EmptyHint, QueryStatus } from "../../components/query-state";
import { apiFetch, type InsightOutput, type InsightResponse } from "../../lib/api";
import { formatDateTime } from "../../lib/format";
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
  const reports = data.reports ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">数据洞察</h1>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="alert alert-info">
          {rulesOnly
            ? `当前为规则统计，不是模型生成结果。${data.reason ? `原因：${data.reason}` : ""}`
            : "当前包含模型报告。规则统计仍单独列出，不是模型生成结果。"}
        </div>
        {rulesOnly || reports.length === 0 ? (
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            模型报告尚未接入，下方指标来自已存储的覆盖与健康事实。
          </p>
        ) : (
          <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            降级状态：未降级。覆盖缺口与数据质量仍是规则事实。
          </p>
        )}
      </div>

      {!rulesOnly && reports.length > 0 ? <ReportList reports={reports} /> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>覆盖缺口</h2>
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 12 }}>
            规则统计（非模型生成）
          </p>
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
          <p style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 12 }}>
            规则统计（非模型生成）
          </p>
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
    </div>
  );
}

function ReportList({ reports }: { reports: InsightOutput[] }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>模型报告</h2>
      {reports.map((report) => (
        <article key={`${report.model}-${report.generatedAt}`} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: 8 }}>
            <div>生成时间：{formatDateTime(report.generatedAt)}</div>
            <div>
              Provider / 模型：{report.provider} / {report.model}
            </div>
            <div>证据区间：{evidencePeriod(report)}</div>
          </div>
          <p style={{ marginBottom: 12 }}>{report.summary}</p>
          {report.findings.map((finding) => (
            <section key={finding.title} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600 }}>{finding.title}</h3>
              <p style={{ margin: "6px 0" }}>{finding.explanation}</p>
              <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", marginBottom: 8 }}>
                置信度：{Math.round(finding.confidence * 100)}%
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>证据指标</th>
                      <th>数值</th>
                      <th>单位</th>
                      <th>区间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finding.evidence.map((metric) => (
                      <tr key={`${metric.name}-${metric.periodStart}`}>
                        <td>{metric.name}</td>
                        <td className="mono">{metric.value}</td>
                        <td>{metric.unit}</td>
                        <td>
                          {metric.periodStart} — {metric.periodEnd}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ marginTop: 8 }}>建议：{finding.recommendation}</p>
            </section>
          ))}
        </article>
      ))}
    </div>
  );
}

function evidencePeriod(report: InsightOutput): string {
  let start: string | null = null;
  let end: string | null = null;
  for (const finding of report.findings) {
    for (const metric of finding.evidence) {
      if (!start || metric.periodStart < start) start = metric.periodStart;
      if (!end || metric.periodEnd > end) end = metric.periodEnd;
    }
  }
  if (!start || !end) return "—";
  return `${start} — ${end}`;
}
