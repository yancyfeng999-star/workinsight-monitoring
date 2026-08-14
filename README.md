# 电脑监控软件（终端使用与浏览分析系统）

公司内部、集中分析、可运维审计的终端使用监控系统。被监控端（macOS/Windows）只负责
采集、过滤、加密缓存与上传；所有分类、统计、规则和大模型分析都在监控端完成。

## 产品边界（一句话）

- 记录：前台应用、窗口标题（策略开启时，默认关）、浏览器活动标签页域名、空闲/锁屏/睡眠。
- 不记录：截图、键盘、剪贴板、网页正文、表单、聊天/邮件正文、私密浏览、完整 URL。
- 分析：应用/网站分类、时长聚合、团队汇总、AI 日/周总结 —— 全部在监控端。

## 仓库结构

```text
apps/
  endpoint-agent/     Rust + Tauri 被监控端 Agent
  browser-extension/  Chrome/Edge MV3 扩展（Native Messaging）
  api/                TypeScript 模块化单体 API
  worker/             监控端聚合/分类/规则/AI 作业
  web-console/        Next.js 管理端
packages/             共享契约、鉴权、Insight Schema、测试夹具
database/             PostgreSQL 迁移与种子
docs/                 产品、架构、数据治理、运维文档
tests/                契约/集成/e2e/性能/数据安全测试
tools/                夹具生成器与发布校验器
```

## 状态

- **当前阶段：Phase 1 核心功能已完成。** 所有组件级测试通过，完整链路代码已贯通。
- 真实交付证据见 `docs/evidence/delivery-status.json`；未验证项一律不宣称完成。
- 已完成：
  - Agent: Activity Event 契约、macOS 采集、浏览器 IPC、加密队列、PlatformSecretStore、Uploader 主循环、Health 上报、Tauri setup 窗口
  - API: enrollment（并发安全）、activity 暴力ing、health、admin session、RBAC、policy 签名
  - Worker: 确定性分类（45 app + 38 domain 规则）、跨午夜聚合、团队汇总（≥5 人隐私门控）
  - Web Console: 登录、总览、团队、人员、设备、注册、策略、审计、Insight、系统状态
  - Browser Extension: 63 项测试通过（含 E2E 协议验证）
- 未验证：Windows 真机、签名/公证、远端发布、DeepSeek AI、8h/7h 门禁

## 标准命令（开发环境）

```text
# Agent（Rust 工作区）
cd apps/endpoint-agent/src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked

# 浏览器扩展
cd apps/browser-extension && npm test

# 监控端 API（需要 PostgreSQL，见 infra/local/docker-compose.yml，端口 5433）
cd apps/api
npm test
npm run typecheck

# 发布校验器
python3 -m unittest discover -s tools/release-verifier -p 'test_*.py'
python3 tools/release-verifier/verify_agent.py \
  --artifact apps/endpoint-agent/src-tauri/target/debug/workinsight-agent
```

## 已知限制（未完成，不宣称通过）

- Windows 采集/自启动/打包尚无真机证据；
- macOS 登录自启动、8 小时实机门禁、浏览器 Native Messaging 端到端尚未验证；
- 设备注册/认证、加密队列、Web Console、Worker 聚合、DeepSeek Insight 未完成；
- 无签名/公证/远端发布/Pilot/用户安装证据。
