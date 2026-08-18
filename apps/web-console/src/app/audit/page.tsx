"use client";

import { useMemo, useState } from "react";
import { EmptyHint, QueryStatus } from "../../components/query-state";
import { formatDateTime } from "../../lib/format";
import { apiFetch, type AuditEntry } from "../../lib/api";
import { useAdminQuery } from "../../lib/use-admin-query";

export default function AuditPage() {
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (actorFilter) params.set("actor", actorFilter);
    if (actionFilter) params.set("action", actionFilter);
    const query = params.toString();
    return query ? `/v1/admin/audit?${query}` : "/v1/admin/audit";
  }, [actorFilter, actionFilter]);
  const { data, loading, error, reload } = useAdminQuery<AuditEntry[]>(path, apiFetch);
  const entries = data ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">审计日志</h1>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div className="form-group" style={{ margin: 0, flex: "1 1 200px" }}>
            <label htmlFor="actor">操作人</label>
            <input
              id="actor"
              type="text"
              value={actorFilter}
              onChange={(event) => setActorFilter(event.target.value)}
              placeholder="筛选操作人..."
            />
          </div>
          <div className="form-group" style={{ margin: 0, flex: "1 1 200px" }}>
            <label htmlFor="action">操作类型</label>
            <input
              id="action"
              type="text"
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              placeholder="筛选操作类型..."
            />
          </div>
        </div>
      </div>

      <QueryStatus loading={loading} error={error} onRetry={reload} className="card">
        {entries.length === 0 ? (
          <EmptyHint>暂无审计记录。完成登录、策略或注册操作后将在此显示</EmptyHint>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作人</th>
                  <th>操作</th>
                  <th>目标</th>
                  <th>请求 ID</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {formatDateTime(entry.ts)}
                    </td>
                    <td>{entry.actor}</td>
                    <td>{entry.action}</td>
                    <td>{entry.target}</td>
                    <td>
                      <code className="mono" style={{ fontSize: "0.75rem" }}>
                        {entry.requestId}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryStatus>
    </div>
  );
}
