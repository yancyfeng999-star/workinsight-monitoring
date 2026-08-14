# WorkInsight 独立审核报告

## 审核信息

- Branch: `fix/wave0-1`
- Commit: `5021f94d34d103e0fd780d326558eb57cfc9c1e8`
- Platform: macOS (darwin) — 无 Windows Runner
- Date: 2026-08-12
- Reviewer: OpenCode Agent (独立审核)
- Worktree status: 2 untracked files (实施计划 + 审核计划)

## 总结

- **Verdict: FAIL**
- 可真实宣称的阶段: Phase 1 组件级原型（非完整链路）
- 是否允许进入下一 Wave: **否**
- P0: 7 | P1: 5 | P2: 3 | P3: 1

## Gate 结果

| Gate | 结果 | 核心证据 | 阻断 |
| --- | --- | --- | --- |
| A 仓库/证据 | **FAIL** | delivery-status 虚报 pass；__pycache__ 入库 | B-012, B-016 |
| B 契约 | **PASS** | Schema/签名/跨语言验证通过 | — |
| C Runtime | **FAIL** | MemorySecretStore 产品路径；secret_token=None；无上传循环 | B-002, B-004 |
| D 平台 | **BLOCKED** | macOS=partial；Windows=blocked（无 Runner） | — |
| E Browser | **PASS** | IPC 协议一致；隐私过滤通过 | — |
| F API/DB/RBAC | **PARTIAL** | Enrollment 事务存在；并发未验证；Scope 矩阵缺失 | B-010 |
| G Worker | **FAIL** | src/jobs/ 为空目录 | B-013 |
| H Web/UX | **FAIL** | src/ 为空目录 | B-013 |
| I AI | **FAIL** | 无 DeepSeek 实现 | B-013 |
| J 可靠性 | **BLOCKED** | 无 8h/7h 证据 | — |
| K 交付 | **FAIL** | 无包、无签名、无运行时安装证据 | — |

## Findings

### [P0] B-001: Release Engine 不加载 enrollment 身份

- ID: B-001
- 组件: endpoint-agent/src-tauri/src/lib.rs
- 发现版本: 5021f94
- 证据路径/行号: `lib.rs:166-176`
- 复现命令: 阅读 `collector_loop` 函数
- 实际结果: `#[cfg(debug_assertions)]` 块内使用 `DeviceIdentity::load_or_create` 创建合成身份 `org_debug/subject_debug`；release 构建无此路径，Engine.identity 保持 None，所有 Observation 被 `handle()` 第63行丢弃
- 期望结果: release 构建从 SecretStore/Config 加载真实 enrollment 身份
- 用户/数据影响: release 版本不采集任何数据
- 为什么现有测试没发现: 测试使用 `engine.enroll()` 直接注入身份，绕过启动流程
- 修复验收条件: release 构建启动后从 config.json + SecretStore 加载身份，`is_enrolled() == true`
- 需要回归的 Gate: C1, C2
- 状态: Open

### [P0] B-002: Runtime 不调用 Uploader

- ID: B-002
- 组件: endpoint-agent/src-tauri/src/lib.rs
- 发现版本: 5021f94
- 证据路径/行号: `lib.rs:144-236` (collector_loop)；`lib.rs:292-297` (secret_token)
- 复现命令: 搜索 `collector_loop` 中对 `Uploader` 的引用
- 实际结果: `collector_loop` 中无 `Uploader` 调用；`secret_token()` 函数硬编码返回 `None`；事件只写入本地 SQLite，永不上传
- 期望结果: flush 周期调用 Uploader.upload_pending()，使用 SecretStore 中的 token
- 用户/数据影响: 数据静默积压在本地，监控端永远收不到事件
- 为什么现有测试没发现: Uploader crate 有独立单元测试，但未集成到主循环
- 修复验收条件: collector_loop 每个 flush 周期调用 upload_pending，token 从 SecretStore 读取
- 需要回归的 Gate: C4, F1
- 状态: Open

### [P0] B-003: 产品路径使用 plain LocalStore

- ID: B-003
- 组件: endpoint-agent/src-tauri/crates/local-store/src/queue.rs
- 发现版本: 5021f94
- 证据路径/行号: `queue.rs:49-53` (`open()` 调用 `open_plain`)
- 复现命令: `grep -n "LocalStore::open" apps/endpoint-agent/src-tauri/src/lib.rs`
- 实际结果: `collector_loop` 第159行调用 `LocalStore::open()`，该函数默认 `Mode::Plain`，事件 JSON 明文存储在 SQLite
- 期望结果: 产品路径调用 `open_encrypted()`，使用 SecretStore 中的 queue key
- 用户/数据影响: 本地数据库泄露可直接读取所有活动事件
- 为什么现有测试没发现: 加密测试存在 (`encrypted_queue.rs`)，但产品代码未使用
- 修复验收条件: 产品启动时从 SecretStore 获取 key，调用 `open_encrypted()`
- 需要回归的 Gate: C3
- 状态: Open

### [P0] B-004: MemorySecretStore 与 secret_token=None

- ID: B-004
- 组件: endpoint-agent/src-tauri/src/lib.rs
- 发现版本: 5021f94
- 证据路径/行号: `lib.rs:59-61, 74-76` (MemorySecretStore)；`lib.rs:292-297` (secret_token)
- 复现命令: 搜索 `MemorySecretStore::new()` 和 `fn secret_token`
- 实际结果: `setup` 中硬编码使用 `MemorySecretStore::new()`，进程重启后所有 secret 丢失；`secret_token()` 直接返回 `None`
- 期望结果: 使用 `PlatformSecretStore`（Keychain/DPAPI），secret_token 从 store 读取
- 用户/数据影响: 重启后 device_token 和 queue key 丢失，无法上传也无法解密队列
- 为什么现有测试没发现: PlatformSecretStore 实现存在但未接入
- 修复验收条件: release 构建使用 PlatformSecretStore，重启后 token 恢复
- 需要回归的 Gate: C2
- 状态: Open

### [P0] B-005: Tauri windows 为空，首次 UI 不可达

- ID: B-005
- 组件: endpoint-agent/src-tauri/tauri.conf.json
- 发现版本: 5021f94
- 证据路径/行号: `tauri.conf.json:13` (`"windows": []`)
- 复现命令: 阅读 tauri.conf.json
- 实际结果: `windows` 数组为空，Tauri 启动后无窗口；首次用户无法看到 enrollment UI
- 期望结果: 首次启动创建 enrollment/setup 窗口
- 用户/数据影响: 用户无法完成注册流程
- 为什么现有测试没发现: 测试直接调用 API，不经过 Tauri 窗口
- 修复验收条件: 首次启动时显示 enrollment 窗口
- 需要回归的 Gate: C1, H4
- 状态: Open

### [P0] B-006: Extension 与 Host 协议不一致（部分修复）

- ID: B-006
- 组件: browser-extension + browser-bridge
- 发现版本: 5021f94
- 证据路径/行号: browser-native-messaging.md 证据
- 复现命令: 运行 extension 测试 + bridge 测试
- 实际结果: 测试通过（19 项扩展测试 + IPC 协议测试），但仅验证了 debug 模拟扩展→Host 路径，未验证真实 Chrome 加载
- 期望结果: 真实 Chrome unpacked 扩展→Native Host→Agent IPC 完整链路
- 用户/数据影响: 浏览器活动可能无法采集
- 为什么现有测试没发现: 使用 stdin 模拟而非真实扩展
- 修复验收条件: 真实 Chrome 加载扩展后发送消息到达 Agent
- 需要回归的 Gate: E1, E3
- 状态: Open（部分修复，组件级通过）

### [P0] B-007: Windows transport/autostart/collector 未接主路径

- ID: B-007
- 组件: collector-windows, autostart-supervisor
- 发现版本: 5021f94
- 证据路径/行号: windows-runtime.md
- 复现命令: 无 Windows Runner
- 实际结果: 代码存在但无真机验证；Mac 编译 stub 通过不构成 Windows 证据
- 期望结果: Windows Runner 上 build + runtime 全链路
- 用户/数据影响: Windows 端完全不可用
- 为什么现有测试没发现: 状态机测试是 fixture 驱动，不运行真实 API
- 修复验收条件: Windows Runner 上通过 build + 首次配置 + 采集 + 上传
- 需要回归的 Gate: D2
- 状态: Blocked（需要 Windows Runner）

### [P1] B-010: enrollment 事务和并发 single-use 不可靠

- ID: B-010
- 组件: api/src/routes/enrollment.ts
- 发现版本: 5021f94
- 证据路径/行号: `enrollment.ts:38-58`
- 复现命令: 50 并发同 code 请求
- 实际结果: 使用 `pool.query("BEGIN")` 而非专用 client，可能存在并发竞态
- 期望结果: 50 并发同 code 只产生一个成功，其余 409
- 用户/数据影响: 同一 code 可能被多次使用
- 为什么现有测试没发现: 集成测试只测单请求
- 修复验收条件: 并发测试通过
- 需要回归的 Gate: F1
- 状态: Open

### [P1] B-011: health Schema 和健康事实未闭环

- ID: B-011
- 组件: health crate + lib.rs
- 发现版本: 5021f94
- 证据路径/行号: `lib.rs:238-290` (report_health)
- 复现命令: 检查 health 上报路径
- 实际结果: health sample 函数存在，但 `secret_token()` 返回 None，实际上报被跳过；`permissions_ok` 和 `autostart_enabled` 硬编码为 true
- 期望结果: 真实检测权限和自启动状态
- 用户/数据影响: 健康数据不准确
- 为什么现有测试没发现: health crate 测试不覆盖集成路径
- 修复验收条件: health 上报使用真实 token，权限/自启动状态真实检测
- 需要回归的 Gate: B2, C4
- 状态: Open

### [P1] B-012: delivery-status 与证据冲突

- ID: B-012
- 组件: docs/evidence/delivery-status.json
- 发现版本: 5021f94
- 证据路径/行号: delivery-status.json
- 复现命令: 对比 delivery-status 与实际证据
- 实际结果: `local_review: pass`、`runtime_verified_mac: pass`，但存在 7 个 P0 Finding
- 期望结果: local_review 应为 fail；runtime_verified_mac 应为 partial 或 unverified
- 用户/数据影响: 状态虚报导致误判项目进度
- 为什么现有测试没发现: 无自动化一致性检查
- 修复验收条件: delivery-status 与实际证据一一对应
- 需要回归的 Gate: A3
- 状态: Open

### [P1] B-013: Worker/Web/AI 实际为空

- ID: B-013
- 组件: apps/worker, apps/web-console
- 发现版本: 5021f94
- 证据路径/行号: `worker/src/jobs/` 为空；`web-console/src/` 为空
- 复现命令: ls 目录
- 实际结果: Worker 和 Web Console 无任何实现代码
- 期望结果: Worker 有分类/聚合作业；Web Console 有页面和 API 集成
- 用户/数据影响: 监控端功能完全缺失
- 为什么现有测试没发现: 无代码可测
- 修复验收条件: Worker 和 Web Console 有基本功能实现
- 需要回归的 Gate: G, H
- 状态: Open

### [P2] B-015: UI 测试复制 HTML，不测真实 main.ts

- ID: B-015
- 组件: endpoint-agent/src-ui
- 发现版本: 5021f94
- 证据路径/行号: 待验证
- 复现命令: 检查 src-ui 测试
- 实际结果: 需要进一步检查
- 期望结果: 导入真实模块的交互测试
- 用户/数据影响: UI 行为可能与测试不一致
- 为什么现有测试没发现: —
- 修复验收条件: UI 测试导入真实组件
- 需要回归的 Gate: H3
- 状态: Open

### [P2] B-016: Git 跟踪 __pycache__

- ID: B-016
- 组件: tools/release-verifier
- 发现版本: 5021f94
- 证据路径/行号: `tools/release-verifier/__pycache__/test_verify_agent.cpython-314.pyc`
- 复现命令: `git ls-files | rg '__pycache__'`
- 实际结果: `.pyc` 文件被 git 跟踪
- 期望结果: .gitignore 排除 __pycache__
- 用户/数据影响: 仓库卫生问题
- 为什么现有测试没发现: —
- 修复验收条件: git rm + .gitignore 更新
- 需要回归的 Gate: A2
- 状态: Open

### [P3] 文档一致性

- ID: P3-001
- 组件: README.md
- 发现版本: 5021f94
- 证据路径/行号: README.md 第30行
- 复现命令: 阅读 README
- 实际结果: README 声称"Phase 1 修复中"，但 delivery-status 声称多项 pass
- 期望结果: README 与 delivery-status 一致
- 用户/数据影响: 误导
- 修复验收条件: 统一状态描述
- 状态: Open

## 新鲜验证

| 命令 | 结果 | 通过/总数 |
| --- | --- | --- |
| `cargo fmt --all -- --check` | PASS | — |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | PASS | 0 warnings |
| `cargo test --workspace --locked` | PASS | 110 tests |
| `npm test` (browser-extension) | PASS | 19/19 |
| `npm test` (api) | PASS | 22/22 |
| `python3 -m unittest discover` (release-verifier) | PASS | 5/5 |
| `cargo build --workspace --locked` | PASS | — |

**注意**: 所有测试通过只表示组件级正确，不表示完整链路可用。

## UX 结果

| 场景 | 结果 | 备注 |
| --- | --- | --- |
| Endpoint first-run | **FAIL** | 无窗口，无法完成 enrollment |
| Endpoint background | **PARTIAL** | debug 模式可后台运行 |
| Monitor overview | **FAIL** | Web Console 无实现 |
| Team/subject | **FAIL** | Web Console 无实现 |
| Device | **FAIL** | Web Console 无实现 |
| Policy/audit | **FAIL** | Web Console 无实现 |
| Insight | **FAIL** | 无 AI 实现 |
| Accessibility/responsive | **BLOCKED** | 无 UI 可测 |

## 前后端接入结果

| 链路 | 状态 | 备注 |
| --- | --- | --- |
| Agent → 本地队列 | **Connected** | SQLite 队列工作 |
| Agent → API 上传 | **Disconnected** | Uploader 未接入主循环 |
| Agent → Health 上报 | **Disconnected** | secret_token=None |
| Agent → Policy 拉取 | **Disconnected** | policy-client 未接入 |
| Browser → Agent IPC | **Connected** | 协议一致，测试通过 |
| API → DB | **Connected** | PostgreSQL 连接正常 |
| Worker → 聚合 | **Not implemented** | 空目录 |
| Web Console → API | **Not implemented** | 空目录 |
| DeepSeek → Insight | **Not implemented** | 无代码 |

## delivery-status 建议

| 字段 | 当前值 | 建议值 | 理由 |
| --- | --- | --- | --- |
| local_review | pass | **fail** | 存在 7 个 P0 |
| local_tests | pass | **pass** | 组件测试通过 |
| local_build_mac | pass | **partial** | workspace build 通过，Tauri app build 未验证 |
| local_build_win | unverified | **unverified** | 无 Windows Runner |
| local_build_monitor | unverified | **unverified** | Worker/Web 无代码 |
| local_package_mac | unverified | **unverified** | 无包产出 |
| runtime_verified_mac | pass | **partial** | 仅采集链路 debug smoke，非完整 runtime |
| runtime_verified_win | unverified | **blocked** | 无 Windows Runner |
| runtime_verified_monitor | unverified | **unverified** | 无实现 |
| deepseek_sandbox_verified | unverified | **unverified** | 无实现 |

## 未授权或外部 Blocker

| Blocker | 影响 | 替代方案 |
| --- | --- | --- |
| 无 Windows 11 Runner | Gate D2 完全 blocked | 提供 Windows CI 或真机 |
| 无 macOS 权限授权 | 采集 smoke 需要 Accessibility 权限 | 用户手动授权 |
| 无真实浏览器 GUI | 扩展端到端未验证 | 使用 Puppeteer 或手动测试 |
| 无 DeepSeek API Key | AI 功能无法验证 | 使用合成数据 sandbox |

## 下一步

每个 Open Finding 映射到实施计划 Task：

| Finding | 优先级 | 对应 Task |
| --- | --- | --- |
| B-001 (身份加载) | P0 | Task 5: SecretStore + 身份持久化 |
| B-002 (上传未接入) | P0 | Task 5: Uploader 接入主循环 |
| B-003 (明文存储) | P0 | Task 5: 加密队列产品路径 |
| B-004 (MemorySecretStore) | P0 | Task 5: PlatformSecretStore 接入 |
| B-005 (无窗口) | P0 | Task 3: Enrollment UI |
| B-006 (浏览器链路) | P0 | Task 6: 真实扩展验证 |
| B-007 (Windows) | P0 | Task 8: Windows 真机验证 |
| B-010 (并发) | P1 | Task 4: Enrollment 并发测试 |
| B-011 (Health) | P1 | Task 5: Health 真实状态 |
| B-012 (状态虚报) | P1 | 立即修正 delivery-status |
| B-013 (Worker/Web) | P1 | Task 9-11: Worker + Web Console |
| B-016 (pycache) | P2 | 立即修正 .gitignore |

**结论**: 当前基线为组件级原型，核心链路（enrollment → 采集 → 上传 → 监控端）未贯通。必须先修复所有 P0，才能声称 Phase 1 完成。
