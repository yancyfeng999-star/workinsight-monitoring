# macOS Collector Smoke（Task 4）

> 日期：2026-08-10 · 平台：macOS 26.6（本机）· 构建：debug（含合成身份）

## 范围

- 使用 Tauri App 本身（`workinsight-agent` debug 二进制）验证 Engine 真实采集链路。
- 合成身份：`org_debug` / `subject_debug`；设备身份来自本地 `device_id` 文件。
- 只记录合成应用名（Finder/Xcode/cmux），无个人窗口标题。

## 执行

```bash
cargo build
./target/debug/workinsight-agent &
# 8 次前台切换（Finder ↔ Xcode），共约 40 秒，然后优雅退出
sqlite3 ~/Library/Application\ Support/com.workinsight.agent/queue.db \
  "SELECT sequence_no FROM events ORDER BY sequence_no;"
```

## 结果

| 检查项 | 结果 |
| --- | --- |
| 进程后台运行、无主窗口 | 通过 |
| 事件进入本地 SQLite 队列 | 通过（9 个事件） |
| sequence 从 1 连续递增 | 通过（1,2,3,...,9） |
| 事件身份完整（org/device/subject/agent） | 通过 |
| 无禁止字段（category/score/insight/url_path=null） | 通过 |
| 前台应用切换产生独立区间 | 通过（cmux、Finder、Xcode 各自成段） |
| NSWorkspace 主线程调用 | 通过（`run_on_main_thread` + channel） |

## 证据状态

- `local_tests`：Rust 40 项（含 7 项 engine 集成测试）通过，clippy 0 警告。
- `runtime_verified_mac`：**部分**——采集链路已真机验证；10 分钟/8 小时门禁、
  锁屏/睡眠、登录自启动留待 Task 5/8 完成后统一执行。
- 未验证：Windows、enrollment 真实流程、上传。
