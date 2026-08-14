"use client";

import { FormEvent, useEffect, useState } from "react";

interface Policy {
  version: number;
  content: string;
  createdAt: string;
  rolloutPercent: number;
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newContent, setNewContent] = useState("");
  const [rollout, setRollout] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  function fetchPolicies() {
    setLoading(true);
    fetch("/api/v1/admin/policies")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setPolicies)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchPolicies();
  }, []);

  const current = policies.length > 0 ? policies[0] : null;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/admin/policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent, rolloutPercent: rollout }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setNewContent("");
      setRollout(0);
      fetchPolicies();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">策略管理</h1>
      </div>

      {current && (
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>
            当前策略 (v{current.version})
          </h2>
          <pre
            style={{
              background: "var(--bg-secondary)",
              padding: 16,
              borderRadius: "var(--radius)",
              fontSize: "0.85rem",
              overflowX: "auto",
              whiteSpace: "pre-wrap",
              marginBottom: 12,
            }}
          >
            {current.content}
          </pre>
          <div style={{ display: "flex", gap: 24, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
            <span>
              发布时间: <span className="mono">{new Date(current.createdAt).toLocaleString("zh-CN")}</span>
            </span>
            <span>
              灰度比例: <strong>{current.rolloutPercent}%</strong>
            </span>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16 }}>新建策略</h2>
        <form onSubmit={handleCreate}>
          <div className="form-group">
            <label htmlFor="content">策略内容 (JSON)</label>
            <textarea
              id="content"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={6}
              required
              placeholder='{"screenshotInterval": 300, "dataRetentionDays": 90}'
            />
          </div>
          <div className="form-group">
            <label htmlFor="rollout">灰度比例 (%)</label>
            <input
              id="rollout"
              type="number"
              min={0}
              max={100}
              value={rollout}
              onChange={(e) => setRollout(Number(e.target.value))}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "提交中..." : "创建新版本"}
          </button>
        </form>
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>版本历史</h2>
        {loading ? (
          <div className="loading">加载中...</div>
        ) : error ? (
          <div className="error-box">加载失败: {error}</div>
        ) : policies.length === 0 ? (
          <div className="empty">暂无策略记录</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>版本</th>
                  <th>发布时间</th>
                  <th style={{ textAlign: "right" }}>灰度比例</th>
                  <th>内容摘要</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr key={p.version}>
                    <td className="mono">v{p.version}</td>
                    <td className="mono">{new Date(p.createdAt).toLocaleString("zh-CN")}</td>
                    <td style={{ textAlign: "right" }}>{p.rolloutPercent}%</td>
                    <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.content.slice(0, 80)}
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
