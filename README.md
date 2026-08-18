# WorkInsight

跨平台终端使用与浏览分析系统（macOS / Windows）。WorkInsight 的端点 Agent 负责按策略采集、过滤、加密缓存和上传活动事件；监控端服务负责分类、聚合、规则处理和可选的模型分析；Web Console 用于设备、策略、审计和 Insight 管理。

> **English summary:** WorkInsight is a cross-platform endpoint activity and browser-domain analysis system. The endpoint agent collects policy-scoped events, while monitor-side services handle classification, aggregation, policy evaluation, and optional model-assisted insights.

## 项目定位

WorkInsight 面向需要自托管、可审计和可验证数据边界的团队。它不是键盘记录器、截图工具或网页内容抓取器，默认只处理低敏活动元数据，并把未验证的交付状态明确标记出来。

### 默认数据边界

可以记录（仍受策略、权限和部署配置约束）：

- 前台应用、可选窗口标题、浏览器活动标签页的域名；
- 空闲、锁屏、睡眠和设备健康状态；
- 设备注册、策略版本、上传队列和审计事件。

默认不记录：

- 截图、录屏、键盘输入、剪贴板和麦克风内容；
- 网页正文、表单、Cookie、聊天/邮件正文和私密浏览内容；
- 完整 URL 的 path、query、fragment；
- 任何模型密钥、Prompt 或 Provider 配置到端点 Agent 或浏览器扩展。

详细边界见 [`docs/product/data-collection-matrix.md`](docs/product/data-collection-matrix.md)、[`docs/data-governance/data-flow.md`](docs/data-governance/data-flow.md) 和 [`docs/architecture/threat-model.md`](docs/architecture/threat-model.md)。

## 架构概览

```text
Chrome / Edge MV3 Extension
          │ Native Messaging
          ▼
macOS / Windows Endpoint Agent
  collection → policy filter → encrypted queue → uploader → health
          │
          ▼
Monitor-side API → Worker / rules / aggregation / optional AI analysis
          │
          ▼
Web Console → devices / people / policy / audit / insight / system status
```

端点 Agent 不包含分析模型或 Provider 客户端。事件契约、认证、策略签名和状态流转由共享包与 API 合同约束。

## 仓库结构

```text
apps/
  endpoint-agent/     Rust + Tauri 端点 Agent（macOS / Windows）
  browser-extension/  Chrome / Edge MV3 扩展与 Native Messaging
  api/                TypeScript API
  worker/             分类、聚合、规则和分析作业
  web-console/        Next.js 管理控制台
packages/             共享契约、鉴权、Insight Schema、测试夹具
database/             PostgreSQL 迁移与种子
docs/                 架构、数据治理、运维、产品和证据
tests/                契约、集成、E2E、性能和数据安全测试
tools/                夹具与发布校验工具
assets/               品牌与平台图标资源
```

## 当前状态

当前源码版本：`0.1.2`。

源码已经公开，但“代码存在”“组件测试通过”“可安装发布”“真实运行验证”是不同状态。当前交付证据以 [`docs/evidence/delivery-status.json`](docs/evidence/delivery-status.json) 为准。

| 范围 | 当前说明 |
| --- | --- |
| Agent、API、Worker、扩展、Web Console | 组件测试在本分支已复核：API 43、Worker 64、Web 21、扩展 63、端点 UI 5、Rust workspace 80 + fmt；详见 [`docs/reviews/2026-08-18-grok-remediation-review.md`](docs/reviews/2026-08-18-grok-remediation-review.md) |
| 监控端本地闭环 | `runtime_verified_monitor=pass`（Task 9 E2E 3/3，本地 postgres:5433 / API 8080 / Web 3001；合成事件 + fake Provider） |
| macOS / Windows 真机运行 | Windows 无 Runner，保持 unverified；macOS 仅为历史 debug smoke，登录自启动和长时门禁仍需验证 |
| 模型 Provider / DeepSeek 分析 | 监控端适配器与 fake 测试存在；真实 sandbox 未调用，`deepseek_sandbox_verified=unverified` |
| CI / GitHub Actions | [`.github/workflows/quality.yml`](.github/workflows/quality.yml) 已入库；GitHub 尚未跑过，只能记 `local_equivalent`，不能记 `ci_passed` |
| 签名、公证、安装、远端发布、自动更新 | 未验证；Git 源码合并 ≠ 已安装 App 自动更新，也不等于签名 Release |

## 开发准备

建议准备：

- Rust `1.89` 或 workspace 要求的兼容版本；
- Node.js LTS 与 npm；
- Python 3；
- 需要 API 集成测试时，再准备 PostgreSQL（本地 compose 配置见 `infra/local`）。

每个应用目录都有独立的 `package-lock.json`。首次进入对应目录后使用 `npm ci`，不要把 `.env`、数据库文件、个人活动数据或 Provider 密钥提交到仓库。

## 安全验证命令（不构建或安装 Mac App）

以下命令用于格式检查、静态检查、单元测试和类型检查；它们不会运行 `cargo tauri build`，也不会把应用复制到 `/Applications`。

```bash
# Rust Agent：只做格式、静态检查和测试
cd apps/endpoint-agent/src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

# API
cd apps/api
npm ci
npm test
npm run typecheck

# Worker
cd apps/worker
npm ci
npm test
npm run typecheck

# 浏览器扩展（构建的是扩展资源，不是 Mac App）
cd apps/browser-extension
npm ci
npm test
npm run build

# Web Console
cd apps/web-console
npm ci
npm test
npm run typecheck

# 发布校验器
python3 -m unittest discover -s tools/release-verifier -p 'test_*.py'
```

### 公共仓库质量门禁（不打包 App）

[`.github/workflows/quality.yml`](.github/workflows/quality.yml) 在 **pull request** 与向 **`main` 的 push** 上运行源码级质量门禁。权限仅为 `contents: read`，不读取或注入仓库 secrets。

独立 job 覆盖：

| Job | 内容 |
| --- | --- |
| `rust-agent` | 在 `macos-latest` 上跑 `cargo fmt` / Clippy / workspace tests（**不**运行 `cargo tauri build`） |
| `api` | `npm ci`、PostgreSQL 16 服务上的 `workinsight_test` 迁移、单元与集成测试、typecheck |
| `worker` | `npm ci`、test、typecheck |
| `web-console` | `npm ci`、test、typecheck |
| `browser-extension` | `npm ci`、test、扩展资源 `build`（不是 Mac App） |
| `endpoint-ui` | `npm ci`、test、typecheck |
| `contracts-release-verifier` | 发布校验器单测 + 契约 JSON Schema/fixtures 可解析检查 |

该 workflow **不**执行 Tauri 打包、签名、公证、GitHub Release、部署或 App 安装。在 GitHub 尚未实际跑过该 workflow 之前，本地等价命令通过只能记为 `local_equivalent`，不能记为 `ci_passed`。

### Mac App 构建边界

默认禁止运行 `cargo tauri build`、生成 `.app` / `.dmg` / `.pkg`、复制到 `/Applications`、启动或重复安装应用。只有用户在当前任务中明确授权发布构建、签名、公证或安装时，才可以执行对应操作；详见 [`AGENTS.md`](AGENTS.md)。

## 文档入口

- 开发环境与组件验证：[`docs/development/getting-started.md`](docs/development/getting-started.md)
- 贡献流程：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 安全报告：[`SECURITY.md`](SECURITY.md)
- 行为准则：[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)
- 许可、依赖与品牌：[`docs/licensing.md`](docs/licensing.md)
- 产品契约：[`docs/product/product-contract.md`](docs/product/product-contract.md)
- 事件契约：[`docs/architecture/event-contract.md`](docs/architecture/event-contract.md)
- 发布与回滚：[`docs/operations/release-runbook.md`](docs/operations/release-runbook.md)、[`docs/operations/rollback-runbook.md`](docs/operations/rollback-runbook.md)
- 真实交付证据：[`docs/evidence/delivery-status.json`](docs/evidence/delivery-status.json)

## 从远端更新

仓库代码可以正常通过 Git 更新：

```bash
git pull --ff-only origin main
```

贡献者在自己的分支完成检查后，通过 Pull Request 合并到 `main`。这只更新源码仓库，不等于已安装终端自动更新；签名、发布包、更新清单和用户安装仍需单独验证。

## 许可证与品牌

除文件或第三方目录另有说明外，本仓库源代码以 [Apache License 2.0](LICENSE) 发布。Apache-2.0 允许商业使用、修改和再分发，并包含专利授权与无担保条款。

第三方依赖、浏览器平台、操作系统 SDK 和外部模型 Provider 各自受其原始许可或服务条款约束；请在分发前检查对应依赖的许可证。`WorkInsight` 名称、Logo 和品牌标识不因 Apache-2.0 自动获得商标授权，详见 [`docs/licensing.md`](docs/licensing.md)。

## 免责声明

本项目按现状提供，不对特定用途、运行稳定性、数据完整性或部署环境作保证。使用者必须自行配置访问控制、密钥、保留期限、审计和组织内部数据治理；未验证的交付状态不得作为生产能力承诺。
