"use client";

import { FormEvent, useEffect, useState } from "react";

interface EnrollmentCode {
  code: string;
  status: "active" | "used" | "expired";
  createdAt: string;
  expiresAt: string;
  usedBy?: string;
}

const STATUS_LABEL: Record<string, string> = {
  active: "可用",
  used: "已使用",
  expired: "已过期",
};

export default function EnrollmentPage() {
  const [codes, setCodes] = useState<EnrollmentCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [ttlHours, setTtlHours] = useState(24);
  const [maxUses, setMaxUses] = useState(1);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);

  function fetchCodes() {
    setLoading(true);
    fetch("/api/v1/admin/enrollment")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setCodes)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchCodes();
  }, []);

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setGenerating(true);
    setGeneratedCode(null);
    try {
      const res = await fetch("/api/v1/admin/enrollment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlHours, maxUses }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGeneratedCode(data.code);
      fetchCodes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">注册管理</h1>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: 16 }}>生成注册码</h2>
        <form onSubmit={handleGenerate} style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="form-group" style={{ margin: 0, flex: "0 0 160px" }}>
            <label htmlFor="ttl">有效期 (小时)</label>
            <input
              id="ttl"
              type="number"
              min={1}
              max={720}
              value={ttlHours}
              onChange={(e) => setTtlHours(Number(e.target.value))}
            />
          </div>
          <div className="form-group" style={{ margin: 0, flex: "0 0 120px" }}>
            <label htmlFor="maxUses">最大使用次数</label>
            <input
              id="maxUses"
              type="number"
              min={1}
              max={100}
              value={maxUses}
              onChange={(e) => setMaxUses(Number(e.target.value))}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={generating}>
            {generating ? "生成中..." : "生成"}
          </button>
        </form>
        {generatedCode && (
          <div className="alert alert-info" style={{ marginTop: 12 }}>
            注册码已生成: <code className="mono" style={{ fontSize: "1rem" }}>{generatedCode}</code>
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : error ? (
        <div className="error-box">加载失败: {error}</div>
      ) : codes.length === 0 ? (
        <div className="card empty">暂无注册码</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>注册码</th>
                <th style={{ textAlign: "center" }}>状态</th>
                <th>创建时间</th>
                <th>过期时间</th>
                <th>使用者</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code}>
                  <td>
                    <code className="mono">{c.code}</code>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className={`badge badge-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                  </td>
                  <td className="mono">{new Date(c.createdAt).toLocaleString("zh-CN")}</td>
                  <td className="mono">{new Date(c.expiresAt).toLocaleString("zh-CN")}</td>
                  <td>{c.usedBy ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
