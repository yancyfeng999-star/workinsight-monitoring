# 贡献指南

感谢你关注 WorkInsight。提交 Issue、文档、测试或代码前，请先阅读 [`README.md`](README.md)、[`AGENTS.md`](AGENTS.md) 和 [`docs/licensing.md`](docs/licensing.md)。

## 贡献范围

欢迎以下类型的贡献：

- 修复可复现的契约、策略、数据边界和界面问题；
- 增加不包含真实个人活动数据的单元测试、集成测试和测试夹具；
- 改进架构、开发、运维、安全和许可证文档；
- 改进 macOS、Windows、浏览器扩展、API、Worker 或 Web Console 的可验证性。

以下内容不会被接受：

- 截图、录屏、键盘、剪贴板、网页正文、表单、Cookie 或聊天/邮件正文采集；
- 绕过 TCC、UAC、浏览器权限、用户同意或策略签名；
- 把完整 URL、模型密钥、Prompt、Provider 凭据或个人活动记录提交到仓库；
- 将未验证的运行、签名、公证、发布或安装状态写成已完成；
- 未经当前任务明确授权构建、安装或启动 Mac App。

## 开发流程

1. 从最新的 `main` 创建短生命周期分支，例如 `agent/fix-event-contract`。
2. 先写清问题、影响范围和验证方式；行为变化应同时补测试或解释为什么不适用。
3. 保持提交聚焦，不混入生成目录、锁屏/活动数据、`.env` 或无关格式化。
4. 按 [`docs/development/getting-started.md`](docs/development/getting-started.md) 执行相关检查。
5. 推送分支并创建 Pull Request，描述变更、风险、验证结果和未验证项。

## 本地检查

默认允许格式检查、静态检查、单元测试、类型检查和浏览器扩展资源构建。默认禁止 `cargo tauri build`、`.app`/`.dmg`/`.pkg` 打包、复制到 `/Applications` 或启动安装；如确有发布任务，必须在当前任务中获得明确授权。

最小检查集：

```bash
cd apps/endpoint-agent/src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked

cd apps/api && npm ci && npm test && npm run typecheck
cd apps/worker && npm ci && npm test && npm run typecheck
cd apps/browser-extension && npm ci && npm test && npm run build
cd apps/web-console && npm ci && npm test && npm run typecheck

python3 -m unittest discover -s tools/release-verifier -p 'test_*.py'
```

如果依赖、数据库、平台权限或真机不可用，请在 Pull Request 中明确记录，而不是删除检查或修改证据文件掩盖失败。

## 提交与审查

- 提交信息使用简短、可读的动词开头，例如 `fix: reject private-mode events` 或 `docs: clarify release evidence`。
- Pull Request 应只包含一个可审查目标；大型变更请拆分为契约、实现、测试和文档的独立步骤。
- 审查重点包括隐私边界、权限边界、错误处理、日志敏感度、跨平台差异和证据真实性。
- 维护者可以要求补充测试、威胁模型、迁移说明或回滚方案。

## 贡献许可

本项目以 Apache License 2.0 发布。提交贡献即表示你有权提交该内容，并同意在 Apache-2.0 条款下授权项目使用、修改和再分发该贡献；你仍保留适用法律下的权利。第三方代码必须保留其原始许可证和归属信息。

## 行为准则

参与项目时请遵守 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。安全问题请走 [`SECURITY.md`](SECURITY.md) 的私密报告流程，不要直接在公开 Issue 中发布利用细节。
