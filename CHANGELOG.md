# 更新记录

## 0.1.2 — 2026-08-18

### Added

- 监控端 Admin Console 认证会话（`wi_session`）与 `/v1/admin/*` 读写 API。
- Worker 规则分类/聚合之后的监控端 DeepSeek Insight 作业（假 Provider 测试；无沙箱真调用）。
- 监控端垂直切片 E2E：注册 → 上传 → Worker → Web 登录读数。
- 源码质量门禁 `.github/workflows/quality.yml`（不含 Tauri 打包）。
- 端点加密队列 fail-closed 与真实权限健康上报。

### Changed

- 注册码在并发下单次使用；活动事件测试时间窗口改为相对时钟，不再因日历过期失败。
- Web Console 各页接入真实 API；去掉截图文案与 `wi_token`。
- 产品元数据统一到 `0.1.2`。

### Not verified in this release

- Windows 真机、macOS 签名/公证、安装包、用户安装。
- DeepSeek 真实 sandbox。
- 终端 App 自动更新；GitHub 源码合并不等于已安装 App 自动更新。

## 0.1.1 — 2026-08-14

### Added

- Apache-2.0 开源协议、贡献指南、安全政策、行为准则和开发入门文档。
- 许可证、第三方依赖和 WorkInsight 品牌边界说明。
- macOS / Windows Agent、浏览器扩展、API、Worker、Web Console 和契约样例的 `0.1.1` 版本元数据。

### Changed

- README 改为公开项目文档，区分源码、组件测试、真机运行、签名、公证、发布和安装证据。
- 保留默认不构建、安装或启动 Mac App 的项目边界。
- Rust workspace、Tauri 配置、浏览器扩展 manifest、npm lockfile 和当前测试/契约样例统一到 `0.1.1`。

### Not verified in this release

- Windows 真机运行、macOS 签名/公证、用户安装和生产更新通道。
- DeepSeek 或其他外部模型 Provider 的生产可用性。
- 终端 App 自动更新；GitHub 源码仓库的远程更新不等于已安装 App 自动更新。

## 0.1.0

初始公开版本。历史计划和证据文件中的 `0.1.0` 示例保留其原始上下文，不代表当前发布版本。
