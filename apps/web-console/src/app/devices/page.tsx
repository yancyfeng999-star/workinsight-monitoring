"use client";

import { EmptyHint, QueryStatus } from "../../components/query-state";
import { formatDateTime } from "../../lib/format";
import { apiFetch, type Device } from "../../lib/api";
import { useAdminQuery } from "../../lib/use-admin-query";

const HEALTH_LABEL: Record<Device["lastHealth"], string> = {
  ok: "正常",
  degraded: "降级",
  offline: "离线",
};

export default function DevicesPage() {
  const { data, loading, error, reload } = useAdminQuery<Device[]>("/v1/admin/devices", apiFetch);
  const devices = data ?? [];

  return (
    <QueryStatus loading={loading} error={error} onRetry={reload}>
      <div className="page">
        <div className="page-header">
          <h1 className="page-title">设备管理</h1>
          <span style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
            共 {devices.length} 台设备
          </span>
        </div>

        {devices.length === 0 ? (
          <EmptyHint>请先注册设备</EmptyHint>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>设备 ID</th>
                  <th>操作系统</th>
                  <th>Agent 版本</th>
                  <th style={{ textAlign: "center" }}>健康状态</th>
                  <th style={{ textAlign: "right" }}>队列深度</th>
                  <th style={{ textAlign: "center" }}>权限</th>
                  <th style={{ textAlign: "center" }}>数据新鲜度</th>
                  <th>最后上报</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={device.id} style={device.stale ? { opacity: 0.6 } : undefined}>
                    <td>
                      <code className="mono">{device.id}</code>
                    </td>
                    <td>{device.os}</td>
                    <td className="mono">{device.agentVersion}</td>
                    <td style={{ textAlign: "center" }}>
                      <span className={`badge badge-${device.lastHealth}`}>
                        <span className={`status-dot ${device.lastHealth}`} />
                        {HEALTH_LABEL[device.lastHealth]}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>{device.queueDepth}</td>
                    <td style={{ textAlign: "center" }}>
                      <span className={`badge ${device.permissionsOk ? "badge-ok" : "badge-danger"}`}>
                        {device.permissionsOk ? "正常" : "缺失"}
                      </span>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      {device.stale ? (
                        <span className="badge badge-expired">过期</span>
                      ) : (
                        <span className="badge badge-ok">正常</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: "0.8rem" }}>
                      {formatDateTime(device.lastSeen, "从未上报")}
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
