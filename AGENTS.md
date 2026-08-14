# AGENTS.md

本文件面向在本仓库工作的 AI 代理与开发人员，说明硬性边界与常规命令。

## 硬性边界（违反即阻断发布）

1. **Agent 无分析能力**：`apps/endpoint-agent` 依赖图中不得出现 analytics、insight、
   llm、模型 SDK 或模型 Provider 客户端。`segmenter` 只合成时间区间，不计算分类/分数/报告。
2. **禁止字段**：Agent payload 不允许出现 `category`、`score`、`metric`、`insight`
   或模型输出字段；完整 URL（path/query/fragment）默认禁止；`private_mode=true` 事件
   在 Agent 层拒绝入队。
3. **密钥位置**：模型密钥、Prompt、Provider 配置只存在于监控端，不下发 Agent/扩展。
4. **不做内容监控**：不采集截图、录屏、键盘、剪贴板、网页正文、邮件/聊天正文、
   表单输入、Cookie。
5. **不绕过权限**：不伪装系统进程、不绕过 TCC/UAC、不提供远程 Shell/脚本/任意命令。

## 本地构建边界

- **默认禁止构建或打包 Mac App**：不得运行 `cargo tauri build`、生成 `.app`/`.dmg`/`.pkg`，也不得将应用复制或安装到 `/Applications`、桌面或其他用户可见的应用目录。
- 只有用户在当前任务中明确授权发布构建、签名、公证或安装时，才可以执行对应操作；授权前只允许源码检查、测试和类型检查。
- 即使获得构建授权，也不得自动启动应用或重复安装；完成后必须先报告产物路径，再等待后续操作指令。

## 常规命令

```text
# Agent（Rust 工作区，必须在 apps/endpoint-agent/src-tauri 目录内执行；默认不构建 App）
cd apps/endpoint-agent/src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

# 浏览器扩展（npm）
cd apps/browser-extension
npm test
npm run build

# 监控端 API（npm + tsx）
cd apps/api
npm test
npm run test:integration        # 需要 Docker PostgreSQL（见 infra/local）
npm run typecheck
npm run db:migrate

# 发布校验器（Python）
python3 -m unittest discover -s tools/release-verifier -p 'test_*.py'
python3 tools/release-verifier/verify_agent.py \
  --artifact apps/endpoint-agent/src-tauri/target/debug/workinsight-agent

# 端到端（需 API 运行在 127.0.0.1:8080）
cd tests/e2e && npm test
```

## 平台规则

- macOS 采集：`NSWorkspace` 前台应用，经 `run_on_main_thread` 主事件循环调用；
  窗口标题仅在策略允许且用户授予辅助功能权限时获取。
- Windows 采集：`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` 消息循环 + `GetWindowTextW` +
  `GetWindowThreadProcessId` + `GetLastInputInfo`；app_id 使用稳定 exe 路径，禁止 pid 身份。
- 任何平台代码不得被跨平台复制实现；共享部分只放契约/类型。

## 发布状态（不可互相推导）

```text
local_review → local_tests → local_build_mac → local_build_win → local_package
→ runtime_verified → signed_package → remote_release → update_verified
→ pilot_deployed → user_installed
```
