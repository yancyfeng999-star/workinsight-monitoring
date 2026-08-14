# 发布运行手册（Release Runbook）

> 版本：v1.0 · 签名/公证/远端发布为独立门禁（Phase 4）

## 发布状态机（不可互相推导）

```text
local_review → local_tests → local_build_mac → local_build_win → local_package
→ runtime_verified → signed_package → remote_release → update_verified
→ pilot_deployed → user_installed
```

## 流程

### 1. 代码审查与本地验证

- 分支上完成 code review；`cargo clippy -- -D warnings`、`cargo test`、fmt 全绿。
- 数据安全测试通过（禁止字段扫描、Agent 无分析依赖扫描）。
- 记录 `local_review`、`local_tests`。

### 2. 平台构建

- macOS：在 macOS Runner 构建 arm64/x86_64；记录 `local_build_mac`。
- Windows：在 Windows Runner 构建 x64；记录 `local_build_win`。
- 两平台证据分别记录，不能互相替代。

### 3. 打包

- macOS：Phase 1 无签名 .app/.dmg 测试包（已确认决策 #15）；正式签名/公证 Phase 4。
- Windows：可安装 MSI/EXE（Phase 1 无签名本地包）；正式签名 Phase 4。
- 生成 SHA-256 校验和。
- 记录 `local_package`。

### 4. 真实运行验证

- 真实设备：注销再登录自动后台启动、单实例、崩溃恢复、权限拒绝降级、8h 资源占用。
- 记录 `runtime_verified`。

### 5. 签名与远端发布（Phase 4 门禁）

- 私钥只在受控签名环境使用；不做无签名更新。
- macOS Developer ID 签名 + 公证；Windows SignTool / MSIX 证书。
- 更新元数据与包签名、灰度、回滚、问题版本阻断。
- 记录 `signed_package`、`remote_release`、`update_verified`。

### 6. Pilot 部署

- Pilot 目标设备确认安装，完成权限流程；记录 `pilot_deployed`、`user_installed`。

## 发布检查单

- [ ] 版本号更新（semver）
- [ ] SBOM 与依赖扫描无新增高危
- [ ] 许可证清单更新
- [ ] 更新说明（changelog）
- [ ] 禁止字段端到端测试为零
- [ ] Agent 产物扫描无模型组件
- [ ] 灰度目标与回滚条件已配置
