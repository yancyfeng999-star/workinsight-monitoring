"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface SubjectDetail {
  id: string;
  name: string;
  team: string;
  timeline: { ts: string; event: string }[];
  dailyAggregates: { date: string; activeMin: number; apps: number; screenshots: number }[];
  gaps: { start: string; end: string; reason: string }[];
  auditLog: { actor: string; action: string; ts: string }[];
}

export default function SubjectDetailPage() {
  const params = useParams<{ id: string }>();
  const [data, setData] = useState<SubjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/v1/admin/subjects/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [params.id]);

  if (loading) return <div className="page loading">加载中...</div>;
  if (error) return <div className="page error-box">加载失败: {error}</div>;
  if (!data) return <div className="page empty">未找到该对象</div>;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{data.name}</h1>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            团队: {data.team} &nbsp;|&nbsp; ID: <code>{data.id}</code>
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>活动时间线</h2>
          {data.timeline.length === 0 ? (
            <div className="empty">暂无活动记录</div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {data.timeline.map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "0.85rem",
                  }}
                >
                  <span className="mono" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {new Date(t.ts).toLocaleString("zh-CN", { hour12: false })}
                  </span>
                  <span>{t.event}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>离线/空窗期</h2>
          {data.gaps.length === 0 ? (
            <div className="empty">无空窗期记录</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>开始</th>
                    <th>结束</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {data.gaps.map((g, i) => (
                    <tr key={i}>
                      <td className="mono">{new Date(g.start).toLocaleString("zh-CN")}</td>
                      <td className="mono">{new Date(g.end).toLocaleString("zh-CN")}</td>
                      <td>{g.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>每日汇总</h2>
        {data.dailyAggregates.length === 0 ? (
          <div className="empty">暂无每日数据</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th style={{ textAlign: "right" }}>活跃时长 (分钟)</th>
                  <th style={{ textAlign: "right" }}>应用数</th>
                  <th style={{ textAlign: "right" }}>截屏数</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyAggregates.map((d) => (
                  <tr key={d.date}>
                    <td className="mono">{d.date}</td>
                    <td style={{ textAlign: "right" }}>{d.activeMin}</td>
                    <td style={{ textAlign: "right" }}>{d.apps}</td>
                    <td style={{ textAlign: "right" }}>{d.screenshots}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>访问审计</h2>
        {data.auditLog.length === 0 ? (
          <div className="empty">暂无访问记录</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>操作人</th>
                  <th>操作</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.auditLog.map((a, i) => (
                  <tr key={i}>
                    <td>{a.actor}</td>
                    <td>{a.action}</td>
                    <td className="mono">{new Date(a.ts).toLocaleString("zh-CN")}</td>
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
