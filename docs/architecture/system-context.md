# 系统上下文（System Context）

> 版本：v1.0

## 参与者

- **公司管理员（Admin）**：创建组织/团队、设置策略、查看组织汇总、查看个人明细（需审计）、管理模型与导出。
- **团队主管（Manager）**：查看授权团队的汇总与趋势。
- **内部审计（Auditor）**：查看审计日志、按审计范围查看数据。
- **IT 运维（Operator）**：查看 Agent 在线、版本、权限、上传与升级状态（仅健康数据）。
- **被监控员工**：不是监控端必需角色；个人查看页按公司策略决定。
- **DeepSeek API**：监控端唯一模型 Provider（Phase 1 不接入，Phase 3 接入）。

## 系统组件

```mermaid
flowchart LR
  subgraph Endpoint["被监控端：macOS / Windows"]
    OS["OS 前台应用与空闲事件"]
    BE["Chrome / Edge 扩展"]
    NM["Native Messaging"]
    PE["采集策略、字段过滤与规范化"]
    AG["后台 Agent：分段、加密队列、上传"]
    UI["菜单栏/托盘：状态与诊断"]
    AS["登录自启动与崩溃恢复"]
    OS --> PE
    BE --> NM --> PE
    PE --> AG
    UI <--> AG
    AS --> AG
  end

  subgraph Control["监控端控制面（部署在公司管理员 Mac）"]
    EN["设备注册与证书"]
    PS["策略/版本/灰度"]
    AU["身份、团队、RBAC、审计"]
  end

  subgraph Data["监控端数据与分析面"]
    IN["幂等事件接收 API"]
    DB["PostgreSQL 原始事件与聚合"]
    WK["集中聚合/分类/规则 Worker"]
    AI["DeepSeek Insight Worker（Phase 3）"]
    WC["监控端 Web Console"]
  end

  AG -- "TLS + 设备签名" --> IN
  AG <--> EN
  AG <--> PS
  IN --> DB --> WK --> DB
  DB --> AI --> DB
  AU --> WC
  DB --> WC
```

## 部署拓扑（Phase 1/2）

- 监控端：公司管理员 Mac 本机运行 `api`、`worker`、PostgreSQL（Docker）；Web Console 同机。
- 被监控端：公司设备清单中的 macOS 13+ / Windows 11 电脑。
- 网络：公司内网或可达管理员 Mac 的网络；TLS + 设备签名。
- 无 MDM/SSO：MVP 使用内置账号、手动映射、手动分发。

## 数据流

1. OS 事件与浏览器事件 → 本地过滤 → 分段合并 → 加密 SQLite 队列 → 批量上传。
2. API 校验 Schema、幂等去重 → 写入 `activity_events_raw` / `activity_segments`。
3. Worker 日聚合 → 分类（规则优先）→ 规则事实 → （Phase 3）DeepSeek Insight。
4. Web Console 查询聚合与明细（明细需授权 + 审计）。
5. 保留作业按策略清理，写删除证明。
