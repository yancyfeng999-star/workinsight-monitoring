# Browser Extension thin slice

Chrome/Edge Manifest V3 extension that reports the *active tab* of the focused
window to the local WorkInsight agent over Native Messaging.

## Behavior contract

- Only the active tab of the focused normal window counts; background tabs never accumulate time.
- `registrable_domain` only — no protocol/path/query/fragment are transmitted.
- Private/incognito tabs are never turned into events (hard drop).
- Domain blocklist (password managers, banks, personal mail, localhost, ...) is dropped locally.
- Title truncated to 256 chars.

## Load for development (unpacked)

1. `chrome://extensions` → Developer mode → Load unpacked → select this directory.
2. Install the native host (see `apps/endpoint-agent` browser-bridge host registration).
3. Copy the extension's ID into `native-host-manifest.json` `allowed_origins`.

## Native host protocol

Messages are JSON objects with `type` field (`activate` / `deactivate` /
`heartbeat`), matching `browser-bridge` crate `BrowserMessage` in the agent.

## Tests

```text
（Phase 2: Playwright/service-worker unit tests）
```
