"use client";

import { useEffect, useState } from "react";

interface Device {
  id: string;
  os: string;
  agentVersion: string;
  lastHealth: "ok" | "degraded" | "offline";
  queueDepth: number;
  permissionsOk: boolean;
  lastSeen: string;
  stale: boolean;
}

const HEALTH_LABEL: Record<string, string> = {
  ok: "正常",
  degraded: "降级",
  offline: "离线",
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/devices")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setDevices)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="page loading">加载中...</div>;
  if (error) return <div className="page error-box">加载失败: {error}</div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">设备管理</h1>
        <span style={{ color: "var(--text-secondary)", fontSize: "0.875rem" }}>
          共 {devices.length} 台设备
        </span>
      </div>

      {devices.length === 0 ? (
        <div className="card empty">暂无注册设备</div>
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
              {devices.map((d) => (
                <tr key={d.id} style={d.stale ? { opacity: 0.6 } : undefined}>
                  <td>
                    <code className="mono">{d.id}</code>
                  </td>
                  <td>{d.os}</td>
                  <td className="mono">{d.agentVersion}</td>
                  <td style={{ textAlign: "center" }}>
                    <span className={`badge badge-${d.lastHealth}`}>
                      <span className={`status-dot ${d.lastHealth}`} />
                      {HEALTH_LABEL[d.lastHealth]}
                    </span>
                  </td>
                  <td style={{ textAlign: "right" }}>{d.queueDepth}</td>
                  <td style={{ textAlign: "center" }}>
                    <span className={`badge ${d.permissionsOk ? "badge-ok" : "badge-danger"}`}>
                      {d.permissionsOk ? "正常" : "缺失"}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    {d.stale ? (
                      <span className="badge badge-expired">过期</span>
                    ) : (
                      <span className="badge badge-ok">正常</span>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: "0.8rem" }}>
                    {new Date(d.lastSeen).toLocaleString("zh-CN")}
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
