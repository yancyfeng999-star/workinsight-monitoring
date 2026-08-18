"use client";

import { useParams } from "next/navigation";
import { QueryStatus } from "../../../components/query-state";
import { formatDateTime } from "../../../lib/format";
import { apiFetch, type SubjectDetail } from "../../../lib/api";
import { useAdminQuery } from "../../../lib/use-admin-query";

export default function SubjectDetailPage() {
  const params = useParams<{ id: string }>();
  const subjectId = typeof params.id === "string" ? params.id : "";
  const { data, loading, error, reload } = useAdminQuery<SubjectDetail>(
    `/v1/admin/subjects/${encodeURIComponent(subjectId)}`,
    apiFetch
  );

  return (
    <QueryStatus loading={loading} error={error} onRetry={reload}>
      {data ? <SubjectView data={data} /> : <div className="page empty">未找到该对象，请确认对象已创建</div>}
    </QueryStatus>
  );
}

function SubjectView({ data }: { data: SubjectDetail }) {
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{data.name}</h1>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            团队: {data.team ?? "未分配团队"} &nbsp;|&nbsp; ID: <code>{data.id}</code>
          </span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>活动时间线</h2>
          {data.timeline.length === 0 ? (
            <div className="empty">该对象尚无活动记录。请先注册设备并开始采集</div>
          ) : (
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {data.timeline.map((item, index) => (
                <div
                  key={`${item.ts}-${index}`}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "8px 0",
                    borderBottom: "1px solid var(--border)",
                    fontSize: "0.85rem",
                  }}
                >
                  <span className="mono" style={{ color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                    {formatDateTime(item.ts)}
                  </span>
                  <span>{item.event}</span>
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
                  {data.gaps.map((gap, index) => (
                    <tr key={`${gap.start}-${index}`}>
                      <td className="mono">{formatDateTime(gap.start)}</td>
                      <td className="mono">{formatDateTime(gap.end)}</td>
                      <td>{gap.reason}</td>
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
          <div className="empty">暂无每日数据。请先注册设备并等待日汇总生成</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th style={{ textAlign: "right" }}>活跃时长 (分钟)</th>
                  <th style={{ textAlign: "right" }}>应用数</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyAggregates.map((day) => (
                  <tr key={day.date}>
                    <td className="mono">{day.date}</td>
                    <td style={{ textAlign: "right" }}>{day.activeMin}</td>
                    <td style={{ textAlign: "right" }}>{day.apps}</td>
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
                {data.auditLog.map((entry, index) => (
                  <tr key={`${entry.ts}-${index}`}>
                    <td>{entry.actor}</td>
                    <td>{entry.action}</td>
                    <td className="mono">{formatDateTime(entry.ts)}</td>
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
