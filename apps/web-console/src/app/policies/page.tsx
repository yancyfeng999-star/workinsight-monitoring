"use client";

import { FormEvent, useState } from "react";
import { EmptyHint, QueryStatus } from "../../components/query-state";
import { formatDateTime } from "../../lib/format";
import { useAdminQuery } from "../../lib/use-admin-query";
import { apiFetch, apiPost, classifyQueryError, type Policy } from "../../lib/api";

export const POLICY_PLACEHOLDER = `{
  "collection_enabled": true,
  "window_title_enabled": false,
  "idle_after_seconds": 300,
  "blocked_apps": [],
  "blocked_domains": []
}`;

const POLICY_DEFAULT = `{
  "collection_enabled": true,
  "window_title_enabled": false,
  "idle_after_seconds": 300
}`;

export default function PoliciesPage() {
  const { data, loading, error, reload } = useAdminQuery<Policy[]>("/v1/admin/policies", apiFetch);
  const policies = data ?? [];
  const current = policies[0] ?? null;
  const [newContent, setNewContent] = useState(POLICY_DEFAULT);
  const [rollout, setRollout] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      await apiPost<Policy>("/v1/admin/policies", {
        content: newContent,
        rolloutPercent: Math.trunc(Number(rollout)),
      });
      setNewContent(POLICY_DEFAULT);
      setRollout(0);
      reload();
    } catch (err) {
      setFormError(classifyQueryError(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <QueryStatus loading={loading} error={error} onRetry={reload}>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">策略管理</h1>
        </div>

        {current ? (
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
                发布时间: <span className="mono">{formatDateTime(current.createdAt)}</span>
              </span>
              <span>
                灰度比例: <strong>{current.rolloutPercent}%</strong>
              </span>
            </div>
          </div>
        ) : null}

        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16 }}>新建策略</h2>
          <form onSubmit={handleCreate}>
            <div className="form-group">
              <label htmlFor="content">策略内容 (JSON)</label>
              <textarea
                id="content"
                value={newContent}
                onChange={(event) => setNewContent(event.target.value)}
                rows={8}
                required
                placeholder={POLICY_PLACEHOLDER}
              />
            </div>
            <div className="form-group">
              <label htmlFor="rollout">灰度比例 (%)</label>
              <input
                id="rollout"
                type="number"
                min={0}
                max={100}
                step={1}
                value={rollout}
                onChange={(event) => setRollout(Number(event.target.value))}
              />
            </div>
            {formError ? <div className="alert alert-error">{formError}</div> : null}
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "提交中..." : "创建新版本"}
            </button>
          </form>
        </div>

        <div className="card">
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 12 }}>版本历史</h2>
          {policies.length === 0 ? (
            <EmptyHint>请先发布采集策略</EmptyHint>
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
                  {policies.map((policy) => (
                    <tr key={policy.version}>
                      <td className="mono">v{policy.version}</td>
                      <td className="mono">{formatDateTime(policy.createdAt)}</td>
                      <td style={{ textAlign: "right" }}>{policy.rolloutPercent}%</td>
                      <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {policy.content.slice(0, 80)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </QueryStatus>
  );
}
