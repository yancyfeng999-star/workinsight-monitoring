"use client";

import { FormEvent, useState } from "react";
import { EmptyHint, QueryStatus } from "../../components/query-state";
import { formatDateTime } from "../../lib/format";
import { useAdminQuery } from "../../lib/use-admin-query";
import {
  apiFetch,
  apiPost,
  classifyQueryError,
  type CreatedEnrollment,
  type EnrollmentCode,
} from "../../lib/api";

const STATUS_LABEL: Record<EnrollmentCode["status"], string> = {
  active: "可用",
  used: "已使用",
  expired: "已过期",
};

export default function EnrollmentPage() {
  const { data, loading, error, reload } = useAdminQuery<EnrollmentCode[]>(
    "/v1/admin/enrollment",
    apiFetch
  );
  const codes = data ?? [];
  const [subjectId, setSubjectId] = useState("");
  const [ttlHours, setTtlHours] = useState(24);
  const [generating, setGenerating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedEnrollment | null>(null);

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    setGenerating(true);
    setFormError(null);
    setCreated(null);
    try {
      const result = await apiPost<CreatedEnrollment>("/v1/admin/enrollment", {
        subjectId,
        ttlHours: Math.trunc(Number(ttlHours)),
      });
      setCreated(result);
      reload();
    } catch (err) {
      setFormError(classifyQueryError(err).message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <QueryStatus loading={loading} error={error} onRetry={reload}>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">注册管理</h1>
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16 }}>生成注册码</h2>
          <form
            onSubmit={handleGenerate}
            style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}
          >
            <div className="form-group" style={{ margin: 0, flex: "1 1 220px" }}>
              <label htmlFor="subjectId">分析对象</label>
              <select
                id="subjectId"
                required
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value)}
              >
                <option value="">请选择分析对象</option>
                {subjectId ? <option value={subjectId}>{subjectId}</option> : null}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0, flex: "1 1 220px" }}>
              <label htmlFor="subjectIdDraft">对象 ID</label>
              <input
                id="subjectIdDraft"
                value={subjectId}
                onChange={(event) => setSubjectId(event.target.value.trim())}
                placeholder="请输入已创建的对象 ID"
              />
            </div>
            <div className="form-group" style={{ margin: 0, flex: "0 0 160px" }}>
              <label htmlFor="ttl">有效期 (小时)</label>
              <input
                id="ttl"
                type="number"
                min={1}
                max={24}
                step={1}
                value={ttlHours}
                onChange={(event) => setTtlHours(Number(event.target.value))}
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={generating || !subjectId}>
              {generating ? "生成中..." : "生成"}
            </button>
          </form>
          <p style={{ marginTop: 12, fontSize: "0.8rem", color: "var(--text-secondary)" }}>
            注册码一次性绑定所选对象。当前没有对象列表接口，请输入已创建的对象 ID 后选择。
          </p>
          {formError ? <div className="alert alert-error" style={{ marginTop: 12 }}>{formError}</div> : null}
          {created ? (
            <div className="alert alert-info" style={{ marginTop: 12 }}>
              一次性注册码已生成，请立即复制。明文仅显示这一次。
              <div style={{ marginTop: 8 }}>
                <code className="mono" style={{ fontSize: "1rem" }}>
                  {created.code}
                </code>
              </div>
              <div style={{ marginTop: 8, fontSize: "0.8rem" }}>
                过期时间: {formatDateTime(created.expiresAt)}
              </div>
            </div>
          ) : null}
        </div>

        {codes.length === 0 ? (
          <EmptyHint>请先选择分析对象并生成一次性注册码</EmptyHint>
        ) : (
          <>
            <p style={{ marginBottom: 12, fontSize: "0.85rem", color: "var(--text-secondary)" }}>
              列表中的标识是哈希前缀，不能作为注册密钥使用。明文只在生成当时显示一次。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>码指纹</th>
                    <th style={{ textAlign: "center" }}>状态</th>
                    <th>创建时间</th>
                    <th>过期时间</th>
                    <th>使用者</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((code) => (
                    <tr key={`${code.code}-${code.createdAt}`}>
                      <td>
                        <code className="mono">{code.code}</code>
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`badge badge-${code.status}`}>{STATUS_LABEL[code.status]}</span>
                      </td>
                      <td className="mono">{formatDateTime(code.createdAt)}</td>
                      <td className="mono">{formatDateTime(code.expiresAt)}</td>
                      <td>{code.usedBy ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </QueryStatus>
  );
}
