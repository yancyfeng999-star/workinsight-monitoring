"use client";

import { EmptyHint, QueryStatus } from "../../components/query-state";
import { formatPercent } from "../../lib/format";
import { apiFetch, type TeamSummary } from "../../lib/api";
import { useAdminQuery } from "../../lib/use-admin-query";

const TREND_ICON: Record<TeamSummary["trend"], string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

const TREND_COLOR: Record<TeamSummary["trend"], string> = {
  up: "var(--success)",
  down: "var(--danger)",
  flat: "var(--text-secondary)",
};

export default function TeamsPage() {
  const { data, loading, error, reload } = useAdminQuery<TeamSummary[]>("/v1/admin/teams", apiFetch);
  const teams = data ?? [];

  return (
    <QueryStatus loading={loading} error={error} onRetry={reload}>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">团队管理</h1>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            共 {teams.length} 个团队
          </span>
        </div>

        {teams.length === 0 ? (
          <EmptyHint>请先创建团队，创建后将在此显示覆盖率汇总</EmptyHint>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>团队名称</th>
                  <th style={{ textAlign: "right" }}>成员数</th>
                  <th style={{ textAlign: "right" }}>覆盖率</th>
                  <th style={{ textAlign: "center" }}>趋势</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.id}>
                    <td style={{ fontWeight: 600 }}>{team.name}</td>
                    <td style={{ textAlign: "right" }}>{team.memberCount}</td>
                    <td style={{ textAlign: "right" }}>{formatPercent(team.coverageRate)}</td>
                    <td style={{ textAlign: "center" }}>
                      <span style={{ color: TREND_COLOR[team.trend], fontWeight: 700 }}>
                        {TREND_ICON[team.trend]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </QueryStatus>
  );
}
