# 事件契约（Event Contract）

> 版本：v1.0 · 对应 `packages/contracts`

## 统一事件

```json
{
  "schema_version": 1,
  "event_id": "019...uuidv7",
  "org_id": "org_...",
  "device_id": "device_...",
  "subject_id": "subject_...",
  "sequence_no": 18423,
  "source": "browser",
  "kind": "focus_segment",
  "started_at": "2026-08-10T01:23:45.123Z",
  "ended_at": "2026-08-10T01:28:12.456Z",
  "timezone": "Asia/Shanghai",
  "activity": {
    "app_id": "com.google.Chrome",
    "app_name": "Google Chrome",
    "window_title": null,
    "browser": "chrome",
    "registrable_domain": "example.com",
    "url_path": null
  },
  "privacy": {
    "policy_version": 7,
    "redaction_flags": ["query_removed", "title_pii_removed"],
    "private_mode": false
  },
  "agent": {
    "version": "0.1.0",
    "os": "macos"
  }
}
```

## 硬约束（两端同时校验）

| 约束 | 规则 |
| --- | --- |
| 时间 | `ended_at > started_at`；单段最大 4 小时，超出切段 |
| duration | 服务端重新计算，不信任客户端 duration |
| 标题 | ≤ 256 Unicode 字符 |
| 域名 | ≤ 253 ASCII 字符，必须为 registrable domain |
| url_path | 默认必须为 `null` |
| 禁止字段 | Agent payload 不允许 `category`/`score`/`metric`/`insight`/模型输出字段 |
| private_mode | `true` 的活动事件在 Agent 层拒绝入队，服务端二次拒绝 |
| 幂等 | 同一设备同一 `sequence_no` 只能绑定一个 `event_id` |
| Schema | 只允许已知字段；未知字段拒绝或隔离，不直接入生产表 |

## kind 枚举（Phase 1 子集）

- `focus_segment`：前台应用/标签页活动区间（主要事件）
- `state_change`：idle / locked / unlocked / wake / sleep（用于切段与状态上报）
- `health_sample`：健康事件（队列深度、权限状态、版本），走 `agent_health_samples`

## 事件语义

- 事件 = 开始时间 + 结束时间 + 数据（ActivityWatch heartbeat 合并思想，改为强类型版本化）。
- 相邻相同状态在窗口内合并为不重叠区间。
- 时钟回拨/时区/DST 不修改 UTC 事实时间，另存客户端时区用于展示。
- 浏览器事件只在窗口聚焦时累计；后台标签不累计时长。

## 序列化与传输

- 传输格式：JSON Lines 压缩批量（gzip），单批次上限 1 MB（Phase 1 最小接收器）。
- 请求头带设备签名（Phase 2 完成非对称签名；Phase 1 用调试 token 占位并标注）。
- 服务端幂等键：`(org_id, device_id, sequence_no)`。

## 校验优先级（服务端接收层）

Schema 校验 → 组织/设备身份 → 时间与字段上限 → private_mode 拒绝 → 幂等去重 → 落库。
