"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  coverageRate: number;
  trend: "up" | "down" | "flat";
}

const TREND_ICON: Record<string, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

const TREND_COLOR: Record<string, string> = {
  up: "var(--success)",
  down: "var(--danger)",
  flat: "var(--text-secondary)",
};

export default function TeamsPage() {
  const router = useRouter();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/teams")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setTeams)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page loading">加载中...</div>;
  if (error) return <div className="page error-box">加载失败: {error}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">团队管理</h1>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
          共 {teams.length} 个团队
        </span>
      </div>

      {teams.length === 0 ? (
        <div className="card empty">暂无团队数据</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>团队名称</th>
                <th style={{ textAlign: "right" }}>成员数</th>
                <th style={{ textAlign: "right" }}>覆盖率</th>
                <th style={{ textAlign: "center" }}>趋势</th>
                <th style={{ textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td style={{ textAlign: "right" }}>{t.memberCount}</td>
                  <td style={{ textAlign: "right" }}>
                    {(t.coverageRate * 100).toFixed(1)}%
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span style={{ color: TREND_COLOR[t.trend], fontWeight: 700 }}>
                      {TREND_ICON[t.trend]}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button
                      className="btn btn-ghost"
                      onClick={() => router.push(`/teams?id=${t.id}`)}
                    >
                      查看详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
