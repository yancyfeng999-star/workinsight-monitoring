# WorkInsight 开源文档与许可设计

## 目标

把 WorkInsight 从“公开可见的源码仓库”补齐为一个可被外部开发者理解、构建、贡献和安全报告的 Apache-2.0 开源项目，同时保持当前“不未经授权构建或安装 Mac App”的项目边界。

## 已确认决策

1. **代码许可**：仓库代码采用 Apache License 2.0。该许可允许商业使用、修改、再分发，并提供专利授权与无担保条款。
2. **许可证文本**：根目录 `LICENSE` 使用 Apache 2.0 官方原文；不猜测个人或公司版权主体，不新增未经确认的版权声明。
3. **Rust 元数据**：workspace 的 `license` 字段使用 SPDX 标识 `Apache-2.0`，所有继承 workspace 许可的 crate 自动保持一致。
4. **品牌边界**：Apache-2.0 不授予 WorkInsight 名称、Logo 或商标权；README 与许可说明单独写明这一点。
5. **文档语言**：README 与贡献/安全入口以中文为主，保留关键英文术语和命令，便于公开协作。
6. **构建边界**：文档只指导源码检查、测试、类型检查和浏览器扩展/网页开发；默认不运行 `cargo tauri build`，不生成、复制、安装或启动 `.app`、`.dmg`、`.pkg`。

## 文档交付物

- `README.md`：项目定位、隐私数据边界、架构、当前验证状态、开发入口、更新方式、许可证和限制。
- `CONTRIBUTING.md`：分支、提交、测试、代码审查、贡献许可和禁止提交内容。
- `SECURITY.md`：漏洞报告入口、敏感数据处理、响应预期和不应公开的内容。
- `CODE_OF_CONDUCT.md`：协作行为标准与执行方式。
- `docs/development/getting-started.md`：按组件拆分的本地准备、非 App 验证命令和故障排查。
- `docs/licensing.md`：Apache-2.0 适用范围、第三方依赖、品牌/商标边界和再分发说明。
- `LICENSE`：Apache License 2.0 官方原文。

## 不在本次范围内

- 不修改监控采集、上传、分析、API 或 UI 运行时代码。
- 不添加自动更新、签名、公证、发布包或安装脚本。
- 不声称 Windows 真机、macOS 签名/公证、远端发布、模型 Provider 或用户安装已经验证。
- 不删除现有被 `.gitignore` 忽略的构建目录；本次只补文档与许可元数据。

## 验收标准

- GitHub 可以识别仓库为 Apache-2.0，根目录存在完整 `LICENSE`。
- `Cargo.toml` 的 workspace 许可为 `Apache-2.0`，不存在残留的 `proprietary` workspace 许可声明。
- README 能在不阅读源码的情况下说明项目用途、边界、当前状态、如何验证和如何贡献。
- 新增文档之间的命令、路径、许可描述一致，且没有 `TBD`、`TODO` 或未解释的占位符。
- `git diff --check` 通过；文档改动不会触发 App 构建。
