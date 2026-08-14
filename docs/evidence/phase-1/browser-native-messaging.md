# 浏览器 Native Messaging 端到端（Task 6）

> 日期：2026-08-11 · 平台：macOS 26.6 · 构建：debug

## 验证范围

Chrome/Edge MV3 扩展 → Native Host（`com.workinsight.agent.bridge`）→ same-user Unix
Domain Socket（0600）→ Agent Engine → 加密 SQLite 队列 的真实数据路径。

## 执行

```bash
# 1. 构建 bridge 并复制进已安装 .app（临时扩展 ID 安装 Host manifest）
cargo build -p browser-bridge
bash apps/browser-extension/scripts/install-host-macos.sh \
  --extension-id mndlbhlbpeoikiccjfeicdgbhmlahgad

# 2. 启动 Agent（debug 合成身份），验证 IPC socket
./target/debug/workinsight-agent
ls ~/Library/Application\ Support/com.workinsight.agent/agent-bridge.sock   # 0600

# 3. 模拟扩展：bridge 二进制经 stdin 发送 Native Messaging 帧
#    activate(tab=10, example.org) -> {"type":"ok"}
```

## 结果

| 检查项 | 结果 |
| --- | --- |
| IPC socket 监听（0600，仅当前用户） | 通过 |
| bridge 收到消息后转发 Agent，Agent 回复 ok | 通过 |
| Chrome 前台时 domain 合入区间（site2.example.com 出现在 focus segment） | 通过 |
| 同一时间轴不重复计 Chrome app 与 domain（单段合入） | 通过 |
| 私密模式在 bridge 层拒绝（"private mode rejected"） | 通过 |
| domain-only（无 path/query，tldts 规范化 co.uk/com.cn/IDN） | 测试 12 项通过 |
| 后台 tab 不计时（仅 focused window active tab） | 代码契约 + 测试通过 |
| Host manifest 无占位符，绝对路径，uninstall 对称脚本 | 通过 |

## 证据状态

- `local_tests`：Rust 58 项、扩展 19 项、API 22 项全通过；clippy 0 警告。
- `runtime_verified_mac`：扩展→Host→IPC→Engine→队列 真实链路通过（合成域名）。
- 未验证：真实 Chrome 加载 unpacked 扩展（需浏览器 GUI 操作）、Edge 单独验证、
  正式扩展 ID（分发时锁定）、Windows Named Pipe。
