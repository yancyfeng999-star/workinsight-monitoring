"use client";

import { useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  requestId: string;
  ts: string;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actorFilter, setActorFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (actorFilter) params.set("actor", actorFilter);
    if (actionFilter) params.set("action", actionFilter);

    fetch(`/api/v1/admin/audit?${params}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setEntries(data.items ?? data);
        setTotalPages(data.totalPages ?? 1);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, actorFilter, actionFilter]);

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
              onChange={(e) => {
                setActorFilter(e.target.value);
                setPage(1);
              }}
              placeholder="筛选操作人..."
            />
          </div>
          <div className="form-group" style={{ margin: 0, flex: "1 1 200px" }}>
            <label htmlFor="action">操作类型</label>
            <input
              id="action"
              type="text"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              placeholder="筛选操作类型..."
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card loading">加载中...</div>
      ) : error ? (
        <div className="card error-box">加载失败: {error}</div>
      ) : entries.length === 0 ? (
        <div className="card empty">暂无审计记录</div>
      ) : (
        <>
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
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>
                      {new Date(e.ts).toLocaleString("zh-CN")}
                    </td>
                    <td>{e.actor}</td>
                    <td>{e.action}</td>
                    <td>{e.target}</td>
                    <td>
                      <code className="mono" style={{ fontSize: "0.75rem" }}>
                        {e.requestId}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              第 {page} / {totalPages} 页
            </span>
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              下一页
            </button>
          </div>
        </>
      )}
    </div>
  );
}
