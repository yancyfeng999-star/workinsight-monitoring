# Windows Runtime 证据状态（Task 8）

> 日期：2026-08-11 · 本机：macOS 26.6（无 Windows Runner）

## 状态

- **Windows 采集代码已完成**：`SetWinEventHook` 消息循环路径、稳定 exe 路径 app_id
  （`QueryFullProcessImageNameW`，禁止 pid 身份）、`GetLastInputInfo` idle、
  当前用户 Logon Trigger（Task Scheduler，LeastPrivilege，延迟 10s，失败重启 3 次）。
- **Windows 原生验证 = blocked**：本机无 Windows 11 Runner。`local_build_win`、
  `runtime_verified_win` 保持 `unverified`。Mac 编译 stub 通过**不构成** Windows 证据。
- 计划明示：没有真实 Windows 环境时不得替代为 Mac 结果。

## 已完成（平台无关部分）

- `collector-windows/tests/state_machine.rs`：fixture 驱动状态机测试 2 项（任意平台可跑）。
- app_id 稳定路径契约测试（禁止 pid:{pid}）。

## 待 Windows Runner 执行

```powershell
cd apps/endpoint-agent/src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo tauri build --debug
```

随后：登录 smoke（3 次注销登录、托盘、单实例、10 次切换、锁屏/睡眠）、8 小时门禁、
ActivityWatch 对照。

## Mac 8 小时门禁

- 执行中：`tools/ci/measure-8h.py` 每 5 分钟采样 RSS/CPU/队列，样本写入
  `/tmp/aw-8h-samples.jsonl`（8 小时，约 96 个样本）。
- 结果待 8 小时后汇总（见 `docs/evidence/phase-1/mac-8h-gate.md`）。
