"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "../../lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await apiPost("/v1/admin/login", { username, password });
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="page"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "calc(100vh - 57px)",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 400 }}>
        <h1
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            marginBottom: 24,
            textAlign: "center",
          }}
        >
          登录 WorkInsight
        </h1>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">用户名</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
              placeholder="请输入用户名"
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">密码</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="请输入密码"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", justifyContent: "center", marginTop: 8 }}
            disabled={loading}
          >
            {loading ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
