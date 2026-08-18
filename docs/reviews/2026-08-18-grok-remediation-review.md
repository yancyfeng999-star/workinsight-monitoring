# WorkInsight current-baseline closure report

## Review metadata

- Date: 2026-08-18
- Branch: `feat/2026-08-18-grok-integration-ai-release-readiness`
- Evidence commit: `3e5e0e6952d1d39a1a955250916b2bd6cee3dd28` (Tasks 1–10 complete)
- This document: docs commit on the same branch; it does **not** rewrite `docs/reviews/2026-08-12-integration-ux-audit.md` or `docs/reviews/2026-08-12-findings.json`
- Plan executed: `docs/superpowers/plans/2026-08-18-grok-integration-ai-release-readiness.md` (left untracked unless separately staged)
- Source version: `0.1.1` (unchanged)
- Platform: macOS (darwin). No Windows 11 runner. No real Chrome/Edge GUI session. No authorized DeepSeek sandbox key. No Git push. No GitHub Actions run.
- Reviewer: Grok Build (Task 11)

## Verdict

**Monitor-side local MVP is evidenced. Platform, package, Release, and user-install gates remain unverified.**

The 2026-08-12 report on `fix/wave0-1` @ `5021f94` remains historical. It must not be treated as the current-main verdict. Tasks 1–10 on this branch closed the empty Worker/Web/AI directories, the Web/API auth and route gaps, calendar-expiring ingestion tests, fail-open plaintext queue, and the missing source-only CI workflow. They did not produce a Mac App, a Windows runtime, a real browser distribution, a signed package, a GitHub Release, or a live model call.

## Delivery status (conservative)

Source of truth: [`docs/evidence/delivery-status.json`](../evidence/delivery-status.json). One gate is not inferred from another. A successful `git push` would prove source availability only; **there was no push**, so `remote_release` stays `unverified`.

| Key | Value | Why |
| --- | --- | --- |
| `local_review` | `pass` | This report exists and maps every old/new finding to current evidence |
| `local_tests` | `pass` | Named current suites re-ran green on 2026-08-18 (see Tests) |
| `local_build_mac` | `partial` | Workspace compile/tests exist; **no** `cargo tauri build`, no `.app` |
| `local_build_win` | `unverified` | No Windows runner |
| `local_build_monitor` | `partial` | API/Worker/Web typecheck; no packaged monitor/TLS compose |
| `local_package_mac` | `unverified` | No `.app`/`.dmg`/`.pkg` this plan |
| `local_package_win` | `unverified` | No Windows package |
| `local_package_browser` | `pass` | Task 10 `npm run build` produced extension `dist/` (not store distribution) |
| `runtime_verified_mac` | `partial` | Historical debug collector smoke only; this plan did not relaunch the Agent |
| `runtime_verified_win` | `unverified` | No Windows runner |
| `runtime_verified_monitor` | `pass` | Task 9 E2E 3/3 on local postgres:5433, API 8080, Web 3001 |
| `deepseek_sandbox_verified` | `unverified` | No authorized real Provider call |
| `local_update_verified` | `unverified` | No updater run |
| `signed_package_mac` | `unverified` | No signing |
| `notarized_package_mac` | `unverified` | No notarization |
| `signed_package_win` | `unverified` | No Windows signing |
| `signed_package` | `unverified` | No signed artifact |
| `production_update_verified` | `unverified` | No production update |
| `browser_distribution_verified` | `unverified` | No real Chrome/Edge install |
| `remote_release` | `unverified` | No push, tag, or GitHub Release |
| `update_verified` | `unverified` | No update channel test |
| `pilot_deployed` | `unverified` | No pilot |
| `user_installed` | `unverified` | No user install |

There is **no** `ci_passed` key. Workflow file exists; GitHub has not executed it. Evidence class: `local_equivalent` only.

Downgrade vs the previous JSON: `local_build_mac` `pass` → `partial` (this plan forbids Tauri packaging; workspace tests must not be promoted to an App build). Promotion: `runtime_verified_monitor` `partial` → `pass` after Task 9.

## Tests (this session unless noted)

| Suite | Command | Result | Environment |
| --- | --- | --- | --- |
| API | `cd apps/api && npm test && npm run typecheck` | 43 pass, tsc ok | Node, Postgres `127.0.0.1:5433` |
| Worker | `cd apps/worker && npm test && npm run typecheck` | 64 pass, tsc ok | Fake Provider / injected fetch; no live model |
| Web Console | `cd apps/web-console && npm test && npm run typecheck` | 21 pass, tsc ok | vitest/jsdom |
| Endpoint UI | `cd apps/endpoint-agent/src-ui && npm test && npm run typecheck` | 5 pass, tsc ok | vitest/jsdom |
| Browser extension | `cd apps/browser-extension && npm test` | 63 pass | node test; simulated host |
| Rust workspace | `cd apps/endpoint-agent/src-tauri && cargo fmt --all -- --check && cargo test --workspace --locked` | fmt ok; **80 pass** | macOS debug; **no** `cargo tauri build` |
| Clippy | Task 6: `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 warnings | Rust source unchanged since `57471e5` |
| Release verifier | `python3 -m unittest discover -s tools/release-verifier -p 'test_*.py'` | 5 ok | local Python |
| Monitor E2E | Task 9: `cd tests/e2e && npm test` | 3/3 pass (twice) | local postgres:5433, API 8080, Web 3001; synthetic events; fake Provider |
| GitHub Actions | `.github/workflows/quality.yml` | **not run** | `local_equivalent` only |

E2E, Clippy, and the extension `npm run build` were not re-executed in Task 11. They are cited from Tasks 9–10 on this branch.

## Old findings (B-001 … B-016, P3-001)

Statuses: `closed` | `partial` | `open` | `blocked`. Line numbers are current on `3e5e0e6`.

### B-001 — Release Engine 不加载 enrollment 身份 — **partial**

- Historical: release `collector_loop` had no enrollment load path; debug used `org_debug`/`subject_debug`.
- Current: `apps/endpoint-agent/src-tauri/src/lib.rs:296-376` loads `enrollment::load_config`. Missing config in release logs and **returns without collecting**. Debug still synthesizes identity (`:358-367`).
- Remaining: no release-build start, no restart proof that `is_enrolled()==true`.
- Verify: `rg -n 'loading enrollment identity from config|no enrollment config found' apps/endpoint-agent/src-tauri/src/lib.rs` and `cd apps/endpoint-agent/src-tauri && cargo test --workspace --locked --test engine_integration`.

### B-002 — Runtime 不调用 Uploader — **partial**

- Historical: no `Uploader` in the loop; `secret_token()` returned `None`.
- Current: `lib.rs:378-420` constructs `Uploader::with_token`; `:476-497` calls `upload_pending` on `UPLOAD_INTERVAL`. Debug token path is still `None` (`:392-397`), so **debug product upload is disabled**.
- Remaining: no packaged Agent→API upload; Task 9 used HTTP clients, not the Tauri Agent.
- Verify: `rg -n 'upload_pending' apps/endpoint-agent/src-tauri/src/lib.rs` and `cd apps/endpoint-agent/src-tauri && cargo test -p uploader --locked`.

### B-003 — 产品路径使用 plain LocalStore — **closed**

- Historical: `LocalStore::open()` → plaintext SQLite.
- Current: `queue_bootstrap.rs:43-54` is the only enrolled-product opener; missing/non-32-byte key → `StartupError::MissingQueueKey` and **no file created**. `LocalStore::open()` remains for crate tests and `agent-bin` thin-slice only.
- Verify: `cd apps/endpoint-agent/src-tauri && cargo test --workspace --locked --test queue_bootstrap`.

### B-004 — MemorySecretStore 与 secret_token=None — **partial**

- Historical: `MemorySecretStore` hardcoded for all builds.
- Current: `lib.rs:73-95` uses `PlatformSecretStore` on macOS/Windows **release**; debug still uses `MemorySecretStore`. Device token read is release-only (`:378-401`, `:571-591`).
- Remaining: no Keychain/DPAPI restart-restore runtime.
- Verify: `rg -n 'PlatformSecretStore|MemorySecretStore' apps/endpoint-agent/src-tauri/src/lib.rs`.

### B-005 — Tauri windows 为空 — **partial**

- Historical: `tauri.conf.json` `"windows": []`.
- Current: `apps/endpoint-agent/src-tauri/tauri.conf.json:13-23` defines a visible `setup` window; `lib.rs:105-110` hides it when already enrolled.
- Remaining: this plan did not launch the App, so first-run UI is source-only.
- Verify: `rg -n '"windows"' -A 12 apps/endpoint-agent/src-tauri/tauri.conf.json`.

### B-006 — Extension 与 Host 协议不一致 — **partial**

- Historical: component tests passed; no real Chrome.
- Current: extension suite **63 pass** (privacy drop, domain-only, native frames). Still simulated stdin/IPC. `browser_distribution_verified` stays `unverified`.
- Verify: `cd apps/browser-extension && npm test`.

### B-007 — Windows transport/autostart/collector — **blocked**

- Current: `lib.rs:699-706` can call `collector_windows::foreground::current()`. Autostart register exists in `commands.rs` under `target_os = "windows"`. **No Windows 11 runner.** `ipc_server` (`lib.rs:614-619`) uses `std::os::unix::net::UnixListener` unconditionally, so the product loop is not a proven Windows compile.
- Mac stubs are not Windows evidence (`docs/evidence/phase-1/windows-runtime.md`).
- Verify: cannot. Requires a Windows 11 runner.

### B-008 — 策略 key 每次 API 启动变化且 Agent 不 pin — **open**

- Not in the 2026-08-12 JSON; listed in the independent audit plan. Still true.
- Current: `apps/api/src/index.ts:27-33` calls `generatePolicyKeyPair()` whenever `opts.policyPrivateKeyPem` is absent. There is no persistent `POLICY_SIGNING_*` env. `lib.rs:424` keeps `_last_policy` unused; `policy-client` is not invoked from `collector_loop`.
- Verify: `rg -n 'generatePolicyKeyPair|_last_policy|policy_client' apps/api/src/index.ts apps/endpoint-agent/src-tauri/src/lib.rs`.

### B-009 — team scope / headers 审计 / org audit 绕过 — **partial**

- Console routes are org-scoped and tested: `apps/api/src/routes/admin-console.ts:80-89`, `:106-181`; `apps/api/tests/admin-console.integration.test.ts:343-388` (this session, pass).
- Remaining: `apps/api/src/routes/admin.ts:42-48` `GET /v1/admin/audit-logs` selects **all** `audit_logs` with no `org_id` filter. `GET /v1/subjects/:id/activity` and `/activity/headers` (`subjects.ts:17-45`) filter by org, not team membership.
- Verify: `cd apps/api && npx tsx --test --test-name-pattern="org_a admin cannot see" tests/admin-console.integration.test.ts` and `rg -n 'FROM audit_logs' apps/api/src/routes`.

### B-010 — enrollment 事务和并发 single-use — **closed**

- Current: `apps/api/src/routes/enrollment.ts:25-79` uses one `pool.connect()` client for `BEGIN` … `SELECT … FOR UPDATE` … `COMMIT`; no `pool.query()` inside the transaction. Concurrent test at `apps/api/tests/auth.integration.test.ts:134` (50 identical requests).
- Verify: `cd apps/api && npx tsx --test --test-name-pattern="concurrent enrollment" tests/auth.integration.test.ts` (this session: included in 43 pass).

### B-011 — health Schema 和健康事实未闭环 — **partial**

- Current: `lib.rs:526-611` opens the product queue, maps `permissions_ok` via `permissions::collection_permissions_ok` (`permissions.rs:6-8`), and reads macOS autostart status. Hard-coded `permissions_ok: true` is gone.
- Remaining: debug health token is `None` (`lib.rs:583-586`) so the HTTP report is skipped; `window_title_enabled` comes from `CollectionPolicy::default()` (`lib.rs:334-335`), not a fetched signed policy.
- Verify: `rg -n 'permissions_ok' apps/endpoint-agent/src-tauri/src/lib.rs apps/endpoint-agent/src-tauri/src/permissions.rs` and `cd apps/endpoint-agent/src-tauri && cargo test --workspace --locked permissions::`.

### B-012 — delivery-status 与证据冲突 — **closed**

- Historical: `local_review`/`runtime_verified_mac` overstated while P0s were open.
- Current: JSON rewritten against this report. `local_build_mac` downgraded to `partial`. `runtime_verified_monitor` promoted only after Task 9. No `ci_passed` invented.
- Verify: `python3 -c 'import json; print(json.load(open("docs/evidence/delivery-status.json")))'` and diff against the table above.

### B-013 — Worker/Web/AI 实际为空 — **closed**

- Current: `apps/worker/src/jobs/{classifier,aggregator,summarizer,insight}.ts`, `apps/worker/src/ai/{provider,deepseek,schema}.ts`, `apps/web-console/src/app/**/page.tsx` all exist and have tests. Insight is monitor-side only.
- Remaining sandbox gap is N-006, not “empty tree”.
- Verify: `ls apps/worker/src/jobs apps/worker/src/ai apps/web-console/src/app` and the Worker/Web suites above.

### B-014 — Release HTTPS 入口缺失 — **open**

- Not in the 2026-08-12 JSON; still missing.
- Current: `infra/` contains only `local/docker-compose.yml` (Postgres on 5433). API listen default is `127.0.0.1:8080` (`apps/api/src/index.ts:51-56`). No Caddy/TLS profile, no controlled-network HTTPS E2E.
- Verify: `ls infra && rg -n 'listen\\(|443|caddy' infra apps/api/src/index.ts`.

### B-015 — UI 测试复制 HTML，不测真实 main.ts — **closed**

- Current: `apps/endpoint-agent/src-ui/tests/setup.test.ts:1-2` imports `bindSetupForm` from production `setup-controller.ts`. Five cases pass (success, reject, pending, required, cleanup).
- Remaining: payload name `deviceLabel` vs Rust `label` is mapped in `main.ts` (Task 7 note); not a copied-HTML defect.
- Verify: `cd apps/endpoint-agent/src-ui && npm test`.

### B-016 — Git 跟踪 __pycache__ — **closed**

- Current: `.gitignore:12-13` ignores `**/__pycache__/` and `*.pyc`.
- Verify (this session): `git ls-files | rg '(^|/)__pycache__/|\.py[co]$'` → empty.

### P3-001 — 文档一致性 — **closed**

- Historical: README “Phase 1 修复中” vs inflated `delivery-status`.
- Current: README current-status table matches this JSON and points at this review. `docs/architecture/event-contract.md` now matches executable v1 `privacy`.
- Verify: read `README.md` “当前状态” and this file.

## New findings from this plan

These were the confirmed 2026-08-18 defects. IDs `N-001`…`N-008` are for this report only.

### N-001 — Web/API route mismatch — **closed**

- Was: console called `/v1/admin/dashboard|teams|devices|enrollment|policies|audit|insight|system/health` and `/subjects/:id`; API only had login/logout/me/audit-logs/POST subjects.
- Now: `registerAdminConsoleRoutes` in `apps/api/src/index.ts:45` and `admin-console.ts:106-181`. Every current page uses `apiFetch`/`apiPost` (`apps/web-console/src/app/**/page.tsx`).
- Verify: `cd apps/api && npm test` (console route tests) and `cd apps/web-console && npm test`.

### N-002 — session-cookie mismatch — **closed**

- Was: console wrote script-readable `wi_token`; API set `wi_session`; `requireAdmin` accepted Bearer only.
- Now: cookie name `wi_session` only (`admin-session.ts:62-71, 98-133`). Login JSON has no raw `token` (`admin.ts:23-25`). `readSessionToken` prefers Bearer then the exact cookie name. Logout clears `Max-Age=0`. Console `api.ts:54-59` uses `credentials: "same-origin"`.
- Remaining (not this finding): `Secure` requires `COOKIE_SECURE=true` or HTTPS (Task 3 note).
- Verify: `cd apps/api && npx tsx --test --test-name-pattern="HttpOnly wi_session|readSessionToken" tests/auth.integration.test.ts` and `rg -n 'wi_token' apps`.

### N-003 — time-expiring tests — **closed**

- Was: fixed `2026-08-10` events fell outside the 7-day history window.
- Now: `apps/api/tests/activity.integration.test.ts:21-27` and `tests/e2e/agent-api-roundtrip.test.ts` use `recentRange()`. Future rejection stays dynamic (`activity.integration.test.ts:148`). Explicit `>7d+1m` rejection remains.
- Remaining: some **non-ingestion** fixtures still use 2026-08-10 (validate unit tests, policy seed JSON). They do not exercise `HISTORY_LIMIT_MS`.
- Verify: `cd apps/api && npm test` (includes old-history + future cases).

### N-004 — fail-open plaintext queue — **closed**

- Was: enrolled Agent fell back to `LocalStore::open()` when the queue key was missing.
- Now: `queue_bootstrap.rs:43-54` + `tests/queue_bootstrap.rs`. Collector/health both call `open_product_queue` (`lib.rs:328-331, 536-541`).
- Verify: `cd apps/endpoint-agent/src-tauri && cargo test --workspace --locked --test queue_bootstrap`.

### N-005 — prohibited screenshot copy/schema — **closed**

- Was: Web policy placeholder used `screenshotInterval`; `SubjectDetail` had `screenshots`.
- Now: `SubjectDetail` has no such field (`apps/web-console/src/lib/api.ts:117-125`). Policy keys are allow-listed; `FORBIDDEN_POLICY_KEY` rejects screenshot/recording/keylog/clipboard/cookie/webcam/microphone/keystroke (`admin-console.ts:38-49`). Tests assert no `screenshots` key (`admin-console.integration.test.ts:228, 273`).
- Verify: `rg -n 'screenshot|wi_token|fetch\\(\"/api' apps/web-console/src` and `cd apps/api && npm test`.

### N-006 — absent model Provider — **partial**

- Was: no DeepSeek/Insight pipeline.
- Now: monitor-side `InsightProvider`, DeepSeek adapter, `insight_jobs`/`insight_reports` (`database/migrations/004_insights.sql`), Worker job after summarizer (`apps/worker/src/index.ts:29-33`). API `GET /v1/admin/insight` **reads rows only**. Missing `DEEPSEEK_API_KEY` → `rules_only`. Worker tests are fake Provider / injected fetch (**64 pass**).
- Remaining: **no authorized real sandbox call**. `deepseek_sandbox_verified` stays `unverified`. Worker CLI Insight defaults to yesterday UTC (Task 9 concern).
- Verify: `cd apps/worker && npm test` and confirm `DEEPSEEK_API_KEY` was unset for Task 9.

### N-007 — absent CI — **partial**

- Was: no GitHub Actions workflow.
- Now: `.github/workflows/quality.yml` (PR + `main` push, `contents: read`, no secrets, no Tauri package). `rust-agent` runs on `macos-latest` (`quality.yml:20-39`).
- Remaining: GitHub has not executed the workflow. Do not invent `ci_passed`.
- Verify: read `.github/workflows/quality.yml`; there is no Actions run URL.

### N-008 — published `privacy` schema mismatch — **closed**

- Was: `docs/architecture/event-contract.md` showed `privacy` as an object; executable v1 uses the string `"normal"`.
- Now: the published contract example is `"privacy": "normal"`. Constraint table states `"private"` is rejected and forbids silently introducing a structured object. Executable sources unchanged:
  - `packages/contracts/activity-event.schema.json:24` `{ "const": "normal" }`
  - `apps/api/src/validate.ts:36, 92`
  - `apps/endpoint-agent/src-tauri/crates/agent-core/src/contract.rs:36-40, 300-302`
  - fixtures `valid-*.json` / `invalid-private-event.json`
- A structured privacy object remains a **versioned schema migration**, not a v1 patch.
- Verify: `rg -n '"privacy"' docs/architecture/event-contract.md packages/contracts/activity-event.schema.json packages/contracts/fixtures`.

## Event-contract reconciliation

v1 accepted events carry:

```json
"privacy": "normal"
```

`"private"` is rejected before queueing and again by the API (`validate.ts:92` → `private_mode event rejected`). This report did **not** add `policy_version` / `redaction_flags` / `private_mode` fields to the published v1 example.

## Hygiene (this session)

```text
git status --short
# ?? docs/superpowers/plans/2026-08-18-grok-integration-ai-release-readiness.md
# (plus this docs commit once staged)

git diff --check
# clean

git ls-files | rg '(^|/)__pycache__/|\.py[co]$'
# empty

rg -n 'DEEPSEEK_API_KEY\s*=|Bearer [A-Za-z0-9_-]{20,}|password\s*=' . \
  --glob '!**/node_modules/**' --glob '!**/target/**'
```

Inspected matches; **no live secrets** in the report:

- Historical plan placeholder `DEEPSEEK_API_KEY=` with empty value
- Test-only password variables and a fake Bearer string used to assert redaction
- `create-admin.ts` reads `process.env.ADMIN_PASSWORD` (no literal)

Do not paste those values into tickets or logs.

## Not executed (this plan)

- `cargo tauri build`; no `.app` / `.dmg` / `.pkg`; no copy to `/Applications`
- Windows native build or runtime
- Real Chrome or Edge unpacked/store load
- Authorized DeepSeek HTTP call
- Signing, notarization, updater, GitHub Release
- `git push`, tags, version bump (`0.1.1` kept)
- GitHub Actions on this branch

## Remaining blockers (evidence-backed only)

1. **Windows** (B-007): no runner; Unix IPC in the product loop.
2. **Policy signing persistence / Agent pin** (B-008): new key every API process; Agent does not refresh/pin policy.
3. **HTTPS monitor entry** (B-014): localhost HTTP only.
4. **Real browser + packaged Agent runtime**: still unverified.
5. **DeepSeek sandbox**: adapter exists; live call not authorized.
6. **CI on GitHub**: workflow is local-equivalent only.
7. **Leftover unscoped `GET /v1/admin/audit-logs`** (B-009 remainder).

## Suggested next safe command

```bash
cd tests/e2e && E2E_DATABASE_URL=postgres://workinsight:workinsight_dev@127.0.0.1:5433/workinsight_test E2E_API_BASE=http://127.0.0.1:8080 E2E_WEB_BASE=http://127.0.0.1:3001 npm test
```

That re-checks the already-proven local monitor slice. It is not a Release, push, App build, or sandbox call.

## Held gates / release-readiness (Task 12)

Date: 2026-08-18. Branch: `feat/2026-08-18-grok-integration-ai-release-readiness`. Source version remains **`0.1.1`**. This section is a hold-the-line record: **not** a Release, package, sign, notarize, push, or version bump.

### Platform holds (unchanged)

| Gate | Held value | Reason |
| --- | --- | --- |
| `local_build_win` | `unverified` | No Windows 11 runner. macOS compilation of Windows stubs is not Windows evidence (`docs/evidence/phase-1/windows-runtime.md`). |
| `runtime_verified_win` | `unverified` | Same; B-007 remains blocked. |
| `browser_distribution_verified` | `unverified` | Extension unit/mock tests and `npm run build` ≠ real Chrome/Edge unpacked or store install with a final extension ID and Native Messaging manifest. |
| `local_package_mac` / `local_package_win` | `unverified` | This plan forbids App packaging. Do not run PowerShell/macOS packaging commands from older evidence files. |
| `signed_package*` / `notarized_package_mac` | `unverified` | No signing or notarization credentials exercised. |
| `remote_release` / `update_verified` / `pilot_deployed` / `user_installed` | `unverified` | No push, tag, GitHub Release, update channel, pilot, or user install. |
| `deepseek_sandbox_verified` | `unverified` | No authorized real Provider call. |

`delivery-status.json` was **not** promoted for Task 12. No over-claim found to downgrade further.

### Not executed under this hold

- `cargo tauri build`; no `.app` / `.dmg` / `.pkg`; no copy/install to `/Applications` or desktop
- Windows native build, PowerShell packaging, or Windows 11 runtime
- Real Chrome or Edge load (unpacked or store)
- Apple signing / notarization; Windows SignTool / MSIX
- Version bump (keep `0.1.1`); propose `0.1.2` only after the user explicitly asks for a bump and GitHub publication
- `git push`, tags, GitHub Release, update manifest publish

### Release-readiness checklist (remaining before any Release)

Do **not** treat this list as authorization. Every item needs explicit user approval when it requires packaging, credentials, remote publish, or machine changes.

1. **Version decision** — keep `0.1.1` until authorized; only then consider a bump (suggested future: `0.1.2` after all local gates the user requires).
2. **Changelog** — user-facing notes for the chosen version (`CHANGELOG.md`).
3. **Apple signing identity** — Developer ID Application (and related team/profile) available in a controlled signing environment.
4. **Notarization credentials** — Apple ID / App Store Connect API key or equivalent; notary submission path documented.
5. **Windows signing** — SignTool / MSIX certificate on a Windows 11 build host.
6. **Checksums** — SHA-256 (and documented algorithm) for every published artifact.
7. **Update manifest** — signed update metadata matching package signatures, channel, and rollback rules (`docs/operations/release-runbook.md`).
8. **Rollback asset** — previously known-good signed package retained and blocked-version rules defined (`docs/operations/rollback-runbook.md`).
9. **Installation / upgrade / uninstall tests** — authorized clean install → enroll → update → identity/queue retention → bad-signature reject → controlled downgrade → uninstall cleans only this product’s autostart/Native Host/local files (Mac and Windows separately).
10. **Explicit user approval** — separate authorizations for Mac package, Windows package, signing/notarization, push/Release, browser GUI session, DeepSeek sandbox, and pilot/user install.

### Final verification matrix (Task 12 snapshot)

| Gate | Minimum acceptance | Status this plan |
| --- | --- | --- |
| Repository | Clean scoped diff; no unrelated files | Required / docs hold recorded |
| Rust source | fmt + Clippy + workspace tests | Pass (cited Tasks 6/11) |
| Endpoint UI | production controller tests + typecheck | Pass |
| Extension | all tests; no full URL/private mode leakage | Pass (unit/mock; not real browser) |
| API | unit/integration/typecheck; concurrent enrollment | Pass |
| Worker | rule jobs + fake-Provider Insight tests/typecheck | Pass |
| Web | API-client and production page tests/typecheck | Pass |
| Monitor E2E | synthetic event through API/DB/Worker/Console | Pass |
| DeepSeek sandbox | authorized real Provider call | **Unverified** |
| macOS runtime | real background/permission/long-run evidence | **Partial** until authorized relaunch |
| Windows runtime | Windows 11 native runner | **Unverified** |
| Browser runtime | real Chrome and Edge | **Unverified** |
| Mac/Windows packages | build/sign/install/upgrade | **Forbidden** in this plan |
| GitHub Release/update/pilot | direct remote/user evidence | **Unverified** |

### Version rule

Source and product metadata stay at **`0.1.1`**. Do not invent `0.1.2` in manifests, tags, or Release assets until the user requests a version bump and GitHub publication after required local gates.
