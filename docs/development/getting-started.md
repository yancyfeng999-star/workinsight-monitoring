# 开发入门

本文说明如何在不构建、安装或启动 Mac App 的前提下检查 WorkInsight。它面向贡献者和审查者，不是生产部署手册。

## 1. 获取源码

```bash
git clone https://github.com/yancyfeng999-star/workinsight-monitoring.git
cd workinsight-monitoring
git switch main
```

不要把 `.env`、数据库文件、`target/`、`node_modules/`、`.next/`、`dist/`、个人活动数据或 Provider 密钥加入提交。

## 2. 可选的本地 API 数据库

API 的集成测试使用 `infra/local/docker-compose.yml` 中的 PostgreSQL 端口 `5433`。仅在需要集成测试时启动：

```bash
docker compose -f infra/local/docker-compose.yml up -d postgres
cp apps/api/.env.example apps/api/.env
```

`.env.example` 只包含本地合成凭据；生产环境必须使用独立的密钥管理和数据库配置。

## 3. 按组件安装依赖和检查

### Rust Agent

```bash
cd apps/endpoint-agent/src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

这些命令会产生被忽略的 Rust 测试缓存，但不会生成 `.app`。不要运行 `cargo tauri build`。

### API

```bash
cd apps/api
npm ci
npm test
npm run typecheck
```

需要 PostgreSQL 时，再运行 `npm run test:integration` 或 `npm run db:migrate`，并在结果中记录数据库版本和配置。

### Worker

```bash
cd apps/worker
npm ci
npm test
npm run typecheck
```

### 浏览器扩展

```bash
cd apps/browser-extension
npm ci
npm test
npm run build
```

这里的 build 只生成扩展的 `dist` 资源，不是 Mac App；`dist` 已被 `.gitignore` 忽略。

### Web Console

```bash
cd apps/web-console
npm ci
npm test
npm run typecheck
```

如果要做网页开发，可使用 `npm run dev`；不要把本地会话、Cookie 或活动数据截图提交到仓库。

### 发布校验器

```bash
python3 -m unittest discover -s tools/release-verifier -p 'test_*.py'
```

发布校验器的通过只证明其检查范围通过，不代表真机运行、签名、公证、远端发布或用户安装完成。

## 4. App 构建边界

默认不执行以下操作：

- `cargo tauri build` 或任何 `.app` / `.dmg` / `.pkg` 打包；
- 将 App 复制到 `/Applications`、桌面或其他用户可见目录；
- 启动、重复安装或注册登录项。

只有当前任务明确授权发布构建、签名、公证或安装时，才可以执行对应操作，并且必须先报告产物路径和验证结果。详见仓库根目录 [`AGENTS.md`](../../AGENTS.md)。

## 5. 常见问题

- **缺少依赖**：确认使用对应目录的 `package-lock.json` 并运行 `npm ci`，不要直接提交生成目录。
- **数据库连接失败**：确认 PostgreSQL 运行在 `127.0.0.1:5433`，并检查 `apps/api/.env` 是否来自示例文件。
- **平台采集测试无法运行**：记录平台、权限和工具链限制；不要伪造 `delivery-status.json` 的通过状态。
- **想验证 App**：先停止并取得当前任务的明确授权；普通贡献只做源码检查、测试和类型检查。
