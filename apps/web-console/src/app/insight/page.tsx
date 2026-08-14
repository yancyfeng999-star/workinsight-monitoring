"use client";

import { useEffect, useState } from "react";

interface InsightStats {
  coverageGaps: { team: string; missingDays: number }[];
  dataQuality: { metric: string; value: string; status: string }[];
}

export default function InsightPage() {
  const [stats, setStats] = useState<InsightStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/insight")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">AI 洞察</h1>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="alert alert-info">
          AI 分析功能尚未配置。以下展示基础统计指标。
        </div>
      </div>

      {loading ? (
        <div className="card loading">加载中...</div>
      ) : error ? (
        <div className="card error-box">加载失败: {error}</div>
      ) : !stats ? (
        <div className="card empty">暂无统计数据</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div className="card">
            <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>覆盖缺口</h2>
            {stats.coverageGaps.length === 0 ? (
              <div className="empty">无覆盖缺口</div>
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
                    {stats.coverageGaps.map((g) => (
                      <tr key={g.team}>
                        <td>{g.team}</td>
                        <td style={{ textAlign: "right" }}>
                          <span
                            className={`badge ${g.missingDays > 3 ? "badge-danger" : "badge-warning"}`}
                          >
                            {g.missingDays} 天
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
            {stats.dataQuality.length === 0 ? (
              <div className="empty">暂无质量指标</div>
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
                    {stats.dataQuality.map((q) => (
                      <tr key={q.metric}>
                        <td>{q.metric}</td>
                        <td className="mono">{q.value}</td>
                        <td style={{ textAlign: "center" }}>
                          <span
                            className={`badge ${
                              q.status === "ok"
                                ? "badge-ok"
                                : q.status === "warning"
                                ? "badge-warning"
                                : "badge-danger"
                            }`}
                          >
                            {q.status === "ok" ? "正常" : q.status === "warning" ? "警告" : "异常"}
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
      )}
    </div>
  );
}
