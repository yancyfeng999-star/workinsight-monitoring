# WorkInsight Integration, AI, and Release-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current v0.1.1 component prototype into a locally verified monitor-side MVP whose endpoint upload, API/DB, Worker, Web Console, and optional DeepSeek analysis contracts are connected and honestly evidenced.

**Architecture:** Keep collection, filtering, encrypted queuing, and upload on the macOS/Windows endpoint Agent. Keep classification, aggregation, reporting, and every model Provider on the monitor side. Standardize the Web Console on authenticated `/v1/admin/*` contracts, make Worker jobs persist auditable results, and keep build/runtime/release evidence as separate gates.

**Tech Stack:** Rust/Tauri 2 endpoint Agent, Chrome/Edge MV3 extension, Fastify 5 + PostgreSQL 16 API, TypeScript Worker, Next.js 15 + React 19 Web Console, Node test runner/Vitest, optional DeepSeek-compatible HTTP API.

**Spec:** `docs/product/product-contract.md`, `docs/architecture/system-context.md`, `docs/architecture/event-contract.md`, `AGENTS.md`

## Global Constraints

- Work only inside `/Users/yancyfeng/Desktop/Mac Dpxx项目/自研软件/电脑监控软件`.
- Preserve unrelated user work. Before every task run `git status --short`; never reset, overwrite, stage, or commit unrelated changes.
- Do not run `cargo tauri build`; do not generate, copy, install, launch, or replace `.app`, `.dmg`, or `.pkg` files. Do not touch `/Applications/WorkInsight Agent.app`.
- Rust formatting, Clippy, unit tests, and workspace tests are allowed because they do not create or install a Mac App bundle.
- Do not push, create tags, create a GitHub Release, change repository visibility, or bump the version unless the user explicitly authorizes that action in the active task.
- Endpoint code must not contain classification, scoring, Insight logic, Prompt text, model SDKs, model Provider clients, or model keys.
- Do not collect screenshots, screen recordings, keystrokes, clipboard contents, page bodies, DOM, form data, cookies, message/email bodies, or full URL paths/queries/fragments.
- Incognito/private browsing events must be rejected before queueing and rejected again by the API.
- If an enrolled Agent cannot obtain its 32-byte queue key, collection must fail closed. It must never fall back to plaintext storage.
- DeepSeek keys and Provider configuration may exist only in the monitor-side Worker environment or monitor-side secret storage. Never store or log secret bytes.
- `local_tests`, `local_build_*`, `runtime_verified_*`, `remote_release`, `update_verified`, and `user_installed` are independent states. One state must not be inferred from another.
- Fixed calendar timestamps must not make tests expire. Tests exercising the seven-day history window must derive valid event times from the test clock.
- Use TDD for behavior changes: add a failing test, confirm the intended failure, make the smallest implementation, then run the focused and component suites.
- Each task ends with a focused commit only if the active user instruction authorizes commits. Otherwise leave a clean, reviewable working-tree diff and record the suggested commit message.

---

## Baseline and Current Verdict

- Baseline branch: `main`
- Baseline commit: `b2e27de97faebf646ea5089af97709157f45400b`
- Source version: `0.1.1`
- Remote: `https://github.com/yancyfeng999-star/workinsight-monitoring`
- Current verdict: **Phase 1 component prototype; full monitor-side integration and release gates fail.**
- Fresh 2026-08-18 checks:
  - Rust workspace format/tests: pass; no Tauri App build was run.
  - Worker: 42/42 pass; typecheck pass.
  - Browser extension: 63/63 pass.
  - Web Console: 1/1 pass; typecheck pass. This test count does not cover real pages or API wiring.
  - Endpoint setup UI: 3/3 pass; typecheck pass. These tests copy static HTML and do not execute `src/main.ts`.
  - API: typecheck pass; 19/22 tests pass. Three activity tests fail because fixed `2026-08-10` events now exceed the seven-day history limit.
  - Release verifier: 5/5 pass.
- Repository evidence currently overstates completion: `docs/evidence/delivery-status.json` says `local_tests: pass` while the current API suite is red.
- The previous independent report in `docs/reviews/2026-08-12-integration-ux-audit.md` targets branch `fix/wave0-1` at `5021f94`; it is historical evidence, not the current-main verdict.

## Confirmed Current Defects

1. Web Console calls `/v1/admin/dashboard`, `/teams`, `/devices`, `/enrollment`, `/policies`, `/audit`, `/subjects/:id`, `/insight`, and `/system/health`; the API implements only `/v1/admin/login`, `/logout`, `/me`, `/audit-logs`, and POST `/subjects` under that prefix.
2. Login writes a script-readable `wi_token` cookie, while the API sets `wi_session` and `requireAdmin()` accepts only an Authorization header. Client-side pages send neither a usable Bearer header nor an API-recognized cookie.
3. Enrollment uses `pool.query("BEGIN")`; subsequent statements are not guaranteed to use the same PostgreSQL connection. The existing test is sequential, not concurrent.
4. API and E2E event tests use fixed August 10 timestamps and fail after the seven-day ingestion window elapses.
5. Worker classification/aggregation/team summaries exist, but no model Provider, Prompt boundary, Insight job, or Insight persistence exists.
6. The AI page explicitly says model analysis is not configured and calls an API route that does not exist.
7. `permissions_ok` is hard-coded to `true` in endpoint health reporting.
8. The endpoint Agent falls back to `LocalStore::open()` plaintext mode when the queue key is unavailable.
9. Setup UI tests build their own HTML strings and never import or execute production `main.ts` behavior.
10. Web policy copy includes a screenshot policy example, and `SubjectDetail` includes a `screenshots` field, both contradicting the product boundary.
11. Windows native build/runtime, real Chrome/Edge extension loading, signed packages, notarization, app updates, pilot deployment, and user installation remain unverified.
12. No GitHub Actions workflow or GitHub Release currently exists.
13. `docs/architecture/event-contract.md` shows `privacy` as an object, while the JSON Schema, fixtures, API validator, and Rust contract use the string literal `"normal"`; the published contract is inconsistent with executable code.

## Planned File Map

### Modify

- `apps/api/src/index.ts`: register monitor-console routes.
- `apps/api/src/auth/admin-session.ts`: standardize cookie/Bearer session extraction and cookie clearing.
- `apps/api/src/routes/admin.ts`: login/logout/me behavior without a script-readable token.
- `apps/api/src/routes/enrollment.ts`: dedicated-client atomic enrollment transaction.
- `apps/api/tests/activity.integration.test.ts`: deterministic recent timestamps.
- `apps/api/tests/auth.integration.test.ts`: concurrent enrollment and cookie-session coverage.
- `apps/endpoint-agent/src-tauri/src/lib.rs`: fail-closed encrypted queue and real permission health input.
- `apps/endpoint-agent/src-tauri/src/queue_bootstrap.rs`: the only enrolled-product queue opener.
- `apps/endpoint-agent/src-ui/src/main.ts`: delegate setup behavior to a testable controller.
- `apps/endpoint-agent/src-ui/tests/setup.test.ts`: execute the production setup controller.
- `apps/web-console/src/lib/api.ts`: one browser-safe API client and typed errors.
- `apps/web-console/src/lib/api.test.ts`: request, 401, and error-body behavior.
- `apps/web-console/src/app/*/page.tsx`: use the shared client and match real response contracts.
- `apps/worker/src/index.ts`: run Insight jobs after aggregation.
- `tests/e2e/agent-api-roundtrip.test.ts`: deterministic recent timestamps.
- `docs/evidence/delivery-status.json`: update only after the corresponding evidence exists.
- `docs/reviews/2026-08-12-findings.json`: do not rewrite history; use it only to map old findings to the new review.

### Create

- `apps/api/src/routes/admin-console.ts`: Web Console read/write endpoints with organization scoping and RBAC.
- `apps/api/src/routes/admin-console.types.ts`: exact JSON response types shared by route tests.
- `apps/api/tests/admin-console.integration.test.ts`: login-to-console API coverage.
- `apps/endpoint-agent/src-tauri/src/permissions.rs`: platform-specific permission probe.
- `apps/endpoint-agent/src-ui/src/setup-controller.ts`: production form binding and enrollment state transitions.
- `apps/worker/src/ai/provider.ts`: Provider-neutral monitor-side interface.
- `apps/worker/src/ai/deepseek.ts`: DeepSeek HTTP adapter with timeout/retry/redaction.
- `apps/worker/src/ai/schema.ts`: validated Insight output schema.
- `apps/worker/src/jobs/insight.ts`: aggregate-only Insight job.
- `apps/worker/tests/insight.test.ts`: fake-Provider tests; no external model call.
- `database/migrations/004_insights.sql`: Insight jobs/results and evidence fields.
- `tests/e2e/monitor-console-roundtrip.test.ts`: API/Worker/Web-proxy data roundtrip.
- `.github/workflows/quality.yml`: source/test/typecheck gates only; no Tauri packaging.
- `docs/reviews/2026-08-18-grok-remediation-review.md`: current-baseline closure report.

---

### Task 1: Make API and E2E Time Tests Deterministic

**Files:**
- Modify: `apps/api/tests/activity.integration.test.ts:21-149`
- Modify: `tests/e2e/agent-api-roundtrip.test.ts:10-120`

**Interfaces:**
- Produces: `recentRange(offsetMinutes: number, durationMinutes?: number): { started: string; ended: string }`
- Preserves: production `HISTORY_LIMIT_MS = 7 days` behavior.

- [ ] **Step 1: Add a shared test-local recent-time helper in each test package**

```ts
function recentRange(offsetMinutes: number, durationMinutes = 5) {
  const startedMs = Date.now() - offsetMinutes * 60_000;
  return {
    started: new Date(startedMs).toISOString(),
    ended: new Date(startedMs + durationMinutes * 60_000).toISOString(),
  };
}
```

- [ ] **Step 2: Replace fixed accepted-event timestamps**

Use offsets between 15 and 120 minutes. Keep the explicit future-event test dynamic and keep one explicit event older than `7 days + 1 minute` to prove that production rejection remains intact.

- [ ] **Step 3: Run the API suite**

Run: `cd apps/api && npm test`

Expected: 22 tests pass, including accepted upload, idempotent replay, conflict, and old/future rejection.

- [ ] **Step 4: Run the E2E suite only when its PostgreSQL/API prerequisites are running**

Run: `cd tests/e2e && npm test`

Expected: every event timestamp is within the ingestion window; failures must then represent a real API/DB problem rather than the calendar date.

- [ ] **Step 5: Record the candidate change**

Suggested commit: `test: make ingestion windows deterministic`

---

### Task 2: Make Enrollment Single-Use Atomic Under Concurrency

**Files:**
- Modify: `apps/api/src/routes/enrollment.ts:16-76`
- Modify: `apps/api/tests/auth.integration.test.ts:109-128`

**Interfaces:**
- Consumes: `pg.Pool`.
- Produces: exactly one HTTP 201 for a valid enrollment code; all simultaneous losers return HTTP 409; exactly one credential and device are created.

- [ ] **Step 1: Add a 50-request concurrency test**

Create one code, then call the same request body through `Promise.all()` 50 times. Assert:

```ts
assert.equal(statuses.filter((s) => s === 201).length, 1);
assert.equal(statuses.filter((s) => s === 409).length, 49);
assert.equal(credentialCount, 1);
assert.equal(deviceCount, 1);
```

- [ ] **Step 2: Run the focused test and confirm it fails or is nondeterministic**

Run: `cd apps/api && npx tsx --test --test-name-pattern="concurrent enrollment" tests/auth.integration.test.ts`

- [ ] **Step 3: Use one checked-out PostgreSQL client for the complete transaction**

Required structure:

```ts
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const result = await client.query("SELECT ... FOR UPDATE", [codeHash]);
  // validate, update code, insert credential, insert device
  await client.query("COMMIT");
  return reply.code(201).send(response);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
}
```

For invalid, used, or expired codes, roll back once before returning. Do not call `pool.query()` between `BEGIN` and `COMMIT`.

- [ ] **Step 4: Run focused and complete API tests**

Run: `cd apps/api && npm test && npm run typecheck`

Expected: all tests and typecheck pass.

- [ ] **Step 5: Record the candidate change**

Suggested commit: `fix: make enrollment code use atomic`

---

### Task 3: Repair the Web-to-API Authentication Contract

**Files:**
- Modify: `apps/api/src/auth/admin-session.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/tests/auth.integration.test.ts`
- Modify: `apps/web-console/src/app/login/page.tsx`
- Modify: `apps/web-console/src/lib/api.ts`
- Modify: `apps/web-console/src/lib/api.test.ts`

**Interfaces:**
- Cookie name: `wi_session` only.
- Cookie properties: `HttpOnly; SameSite=Strict; Path=/`; add `Secure` only when `COOKIE_SECURE=true` or the production deployment is actually HTTPS.
- Authorization: accept `Authorization: Bearer <token>` for API clients and `wi_session=<token>` for the same-origin Web Console.
- Login response: `{ user: { admin_user_id, username, role, org_id } }`; do not return the raw session token in JSON.

- [ ] **Step 1: Add failing authentication integration tests**

Cover all four cases:

1. Login response contains no `token` property.
2. `Set-Cookie` contains `wi_session`, `HttpOnly`, and `SameSite=Strict`.
3. Sending that cookie to `/v1/admin/me` returns 200.
4. Logout invalidates the server-side session and clears the cookie with `Max-Age=0`.

- [ ] **Step 2: Add one session-token extractor**

Export this contract from `admin-session.ts`:

```ts
export function readSessionToken(req: FastifyRequest): string | null;
```

It checks Bearer first, then parses the `Cookie` header for the exact `wi_session` name. It must not accept partial names such as `old_wi_session`.

- [ ] **Step 3: Make `requireAdmin()` and logout use the extractor**

Keep role checks unchanged. `setSessionCookie()` and a new `clearSessionCookie()` must use the same name and security attributes.

- [ ] **Step 4: Remove the browser-readable token**

Delete this behavior from the login page:

```ts
document.cookie = `wi_token=${token}; ...`;
```

After a successful login, navigate to `/`; the HttpOnly `wi_session` cookie from the proxied API response is sufficient.

- [ ] **Step 5: Convert `api.ts` into a browser-safe shared client**

Remove `next/headers`. Requests must use `/api${path}`, `credentials: "same-origin"`, `cache: "no-store"`, and JSON headers. On 401, throw `ApiError(401, "登录已过期")`; page-level code redirects to `/login` once.

- [ ] **Step 6: Run API and Web checks**

Run:

```bash
cd apps/api && npm test && npm run typecheck
cd apps/web-console && npm test && npm run typecheck
```

Expected: all checks pass; no source file references `wi_token`.

- [ ] **Step 7: Record the candidate change**

Suggested commit: `fix: connect console authentication to api sessions`

---

### Task 4: Implement the Exact Admin Console API

**Files:**
- Create: `apps/api/src/routes/admin-console.types.ts`
- Create: `apps/api/src/routes/admin-console.ts`
- Create: `apps/api/tests/admin-console.integration.test.ts`
- Modify: `apps/api/src/index.ts:8-44`

**Interfaces:**
- `GET /v1/admin/dashboard` -> `DashboardStats`
- `GET /v1/admin/teams` -> `TeamSummary[]`
- `GET /v1/admin/subjects/:subjectId` -> `SubjectDetail`
- `GET /v1/admin/devices` -> `Device[]`
- `GET /v1/admin/enrollment` -> `EnrollmentCode[]`
- `POST /v1/admin/enrollment` body `{ subjectId: string, ttlHours: number }` -> `{ code: string, expiresAt: string }`
- `GET /v1/admin/policies` -> `Policy[]`
- `POST /v1/admin/policies` body `{ content: string, rolloutPercent: number }` -> `Policy`
- `GET /v1/admin/audit?actor=&action=&from=&to=` -> `AuditEntry[]`
- `GET /v1/admin/insight` -> `InsightResponse`
- `GET /v1/admin/system/health` -> `SystemHealth`

Use the camelCase property names already consumed by `apps/web-console/src/lib/api.ts`. Never return a `screenshots` field.

- [ ] **Step 1: Define response types once**

Move the current Web interfaces into a source-neutral contract or duplicate them exactly in `admin-console.types.ts` until a shared package is justified. Required shapes include:

```ts
export interface Device {
  id: string;
  os: string;
  agentVersion: string;
  lastHealth: "ok" | "degraded" | "offline";
  queueDepth: number;
  permissionsOk: boolean;
  lastSeen: string | null;
  stale: boolean;
}

export interface DashboardStats {
  coverageRate: number;
  onlineDevices: number;
  avgDelaySec: number;
  categoryBreakdown: Array<{ category: string; count: number; total: number }>;
  recentAlerts: Array<{ id: string; message: string; severity: "info" | "warning" | "critical"; ts: string }>;
}

export interface TeamSummary {
  id: string;
  name: string;
  memberCount: number;
  coverageRate: number;
  trend: "up" | "down" | "flat";
}

export interface SubjectDetail {
  id: string;
  name: string;
  team: string | null;
  timeline: Array<{ ts: string; event: string }>;
  dailyAggregates: Array<{ date: string; activeMin: number; apps: number }>;
  gaps: Array<{ start: string; end: string; reason: string }>;
  auditLog: Array<{ actor: string; action: string; ts: string }>;
}

export interface InsightResponse {
  mode: "rules_only" | "ai";
  reason: string | null;
  coverageGaps: Array<{ team: string; missingDays: number }>;
  dataQuality: Array<{ metric: string; value: string; status: "ok" | "warning" | "error" }>;
  reports: InsightOutput[];
}

export interface SystemHealth {
  api: { status: "ok" | "degraded"; latencyMs: number };
  worker: { status: "ok" | "stale" | "error"; lastRun: string | null };
  database: { connected: boolean; latencyMs: number };
  queues: Array<{ name: string; depth: number }>;
}
```

`EnrollmentCode`, `Policy`, `AuditEntry`, and `InsightOutput` must use the exact property names already listed in the endpoint table and Task 8. Export the same definitions from one shared contract module or mirror them with compile-time contract tests; do not allow API and Web copies to drift silently.

- [ ] **Step 2: Write failing route tests before handlers**

Seed two organizations. For every endpoint, assert that an `org_a` admin cannot see `org_b` rows. Assert the exact response keys, not only HTTP status. Assert 401 without a session and 403 for disallowed roles.

- [ ] **Step 3: Implement dashboard and teams from stored facts**

Dashboard and team endpoints must query `devices`, `agent_health_samples`, `daily_aggregates`, `teams`, `team_memberships`, and `team_summaries`. Do not fabricate sample numbers. Empty databases return zero/empty arrays.

- [ ] **Step 4: Implement subject detail with access auditing**

Return timeline, daily aggregates, gaps, and audit records for the requested subject within `admin.org_id`. Insert `view_subject_activity` into `audit_logs` only after authorization and scope checks succeed.

- [ ] **Step 5: Implement devices from the latest health sample**

Use one latest-health row per device. Define `stale = lastSeen is null or older than 10 minutes`; map stale devices to `offline`; map missing permissions or excessive queue depth to `degraded`.

- [ ] **Step 6: Keep enrollment single-use**

Remove `maxUses` from the contract. Require `subjectId` and verify it belongs to the admin organization. Validate `ttlHours` as an integer from 1 through 24. Store only the code hash; return plaintext only once.

- [ ] **Step 7: Validate policy content**

Parse `content` as JSON, reject unknown/forbidden collection keys, reject screenshot/recording/keylogging fields, validate `rolloutPercent` as an integer from 0 through 100, sign the stored policy, and write an audit entry.

- [ ] **Step 8: Implement audit, base Insight, and system health**

- Audit filters use bound SQL parameters and remain organization-scoped.
- Before Task 8 model integration, Insight returns `{ mode: "rules_only", coverageGaps, dataQuality, reports: [] }`.
- System health queries PostgreSQL latency, latest Worker watermark, activity backlog, and latest health receipt. It must not hard-code `worker.status = "ok"`.

- [ ] **Step 9: Register routes and run integration tests**

Run: `cd apps/api && npm test && npm run typecheck`

Expected: every Web-requested route exists and all RBAC/org-isolation tests pass.

- [ ] **Step 10: Record the candidate change**

Suggested commit: `feat: add authenticated monitor console api`

---

### Task 5: Connect Every Web Page and Remove Misleading UX

**Files:**
- Modify: `apps/web-console/src/lib/api.ts`
- Modify: `apps/web-console/src/app/page.tsx`
- Modify: `apps/web-console/src/app/teams/page.tsx`
- Modify: `apps/web-console/src/app/subjects/[id]/page.tsx`
- Modify: `apps/web-console/src/app/devices/page.tsx`
- Modify: `apps/web-console/src/app/enrollment/page.tsx`
- Modify: `apps/web-console/src/app/policies/page.tsx`
- Modify: `apps/web-console/src/app/audit/page.tsx`
- Modify: `apps/web-console/src/app/insight/page.tsx`
- Modify: `apps/web-console/src/app/system/page.tsx`
- Modify: `apps/web-console/src/lib/api.test.ts`

**Interfaces:**
- Consumes: Task 3 session cookie and Task 4 exact route responses.
- Produces: all pages render live API data, explicit loading/empty/error/unauthorized states, and no prohibited monitoring copy.

- [ ] **Step 1: Add API client tests**

Mock `fetch` and assert URL prefix, same-origin credentials, JSON parsing, text error preservation, and 401 classification.

- [ ] **Step 2: Replace direct page-level `fetch()` calls**

Every page imports `apiFetch`/`apiPost`; no page assembles `/api/v1/...` manually. This centralizes errors and prevents another contract drift.

- [ ] **Step 3: Remove false product claims and dead controls**

- Remove `screenshots` from `SubjectDetail` and all rendering.
- Replace the policy placeholder containing `screenshotInterval` with allowed keys such as `collection_enabled`, `window_title_enabled`, `idle_after_seconds`, `blocked_apps`, and `blocked_domains`.
- Remove enrollment `maxUses`; add a required subject selector.
- Remove the Teams “查看详情” button in this MVP. The table itself is the supported team-summary view; a future team-detail route requires a separate contract and test.

- [ ] **Step 4: Make errors actionable**

401 displays “登录已过期” and redirects once. 403 displays “当前账号无此权限”. Network failure displays a retry button. Empty data explains the required upstream action, such as “请先注册设备” rather than only “暂无数据”.

- [ ] **Step 5: Add page contract tests**

At minimum cover Dashboard, Devices, Enrollment, Policies, Insight, and the global 401 path with mocked API responses. Tests must import production page/components.

- [ ] **Step 6: Run Web checks**

Run: `cd apps/web-console && npm test && npm run typecheck`

Expected: tests and typecheck pass; `rg -n 'screenshot|wi_token|fetch\("/api' apps/web-console/src` returns no prohibited schema/cookie/direct-request leftovers.

- [ ] **Step 7: Record the candidate change**

Suggested commit: `feat: connect monitor console to live api`

---

### Task 6: Fail Closed on Endpoint Encryption and Report Real Permissions

**Files:**
- Create: `apps/endpoint-agent/src-tauri/src/queue_bootstrap.rs`
- Create: `apps/endpoint-agent/src-tauri/src/permissions.rs`
- Modify: `apps/endpoint-agent/src-tauri/src/lib.rs:280-565`
- Create: `apps/endpoint-agent/src-tauri/tests/queue_bootstrap.rs`
- Add unit tests inside `apps/endpoint-agent/src-tauri/src/permissions.rs` for policy/trust mapping.

**Interfaces:**
- Produces: `permissions::collection_permissions_ok(window_title_enabled: bool) -> bool`.
- Produces: `queue_bootstrap::open_product_queue(path: &Path, queue_key: Option<&[u8]>) -> Result<LocalStore, StartupError>`.
- `StartupError` has at least `MissingQueueKey` and `Store(StoreError)` variants and must not contain secret bytes in `Display` output.
- Enforced invariant: enrolled product collection never opens `queue.db` in plain mode.

- [ ] **Step 1: Add a failing source/integration test for missing queue keys**

Given an enrolled config and a missing/invalid queue key, `open_product_queue()` must return `StartupError::MissingQueueKey` and the database path must not exist. Given a 32-byte key, it must create an encrypted queue whose payload cannot be found as plaintext in the SQLite file.

- [ ] **Step 2: Remove the product fallback**

Move product queue opening into `queue_bootstrap.rs`. Replace the `warn!("... falling back to plain store")` branch with `StartupError::MissingQueueKey`. Keep `LocalStore::open()` only for explicit local-store tests/thin-slice tooling outside the enrolled product path.

- [ ] **Step 3: Implement the permission probe**

- macOS: if window-title collection is disabled, return true; if enabled, query Accessibility trust without prompting.
- Windows: return true for the current metadata-only collector unless a future policy requires an additional permission.
- Other compile targets: return false rather than claiming success.

Keep the platform call behind a small function so tests can validate health mapping without changing system permissions.

- [ ] **Step 4: Pass the real result into health reporting**

Delete `permissions_ok: true`. Health must reflect current policy and current OS permission state.

- [ ] **Step 5: Run allowed Rust checks only**

Run:

```bash
cd apps/endpoint-agent/src-tauri
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

Expected: all checks pass. Do not run `cargo tauri build`.

- [ ] **Step 6: Record the candidate change**

Suggested commit: `fix: fail closed on endpoint queue encryption`

---

### Task 7: Test the Real Endpoint Setup UI

**Files:**
- Create: `apps/endpoint-agent/src-ui/src/setup-controller.ts`
- Modify: `apps/endpoint-agent/src-ui/src/main.ts`
- Rewrite: `apps/endpoint-agent/src-ui/tests/setup.test.ts`

**Interfaces:**
- Produces: `bindSetupForm(root: Document, invoke: InvokeFn): () => void`.
- `InvokeFn` receives command `enroll_device` and `{ apiUrl, code, deviceLabel }`.

- [ ] **Step 1: Write tests that import the production controller**

Cover successful enrollment, rejected enrollment, disabled submit while pending, required URL/code validation, and cleanup of the submit listener.

- [ ] **Step 2: Run tests and confirm the missing export failure**

Run: `cd apps/endpoint-agent/src-ui && npm test`

- [ ] **Step 3: Extract only form behavior from `main.ts`**

`main.ts` keeps production Tauri `invoke` wiring; `setup-controller.ts` owns DOM lookup, validation, pending state, and status text. Do not duplicate HTML in tests.

- [ ] **Step 4: Run UI tests and typecheck**

Run: `cd apps/endpoint-agent/src-ui && npm test && npm run typecheck`

Expected: tests execute production controller logic. Do not run the Vite/Tauri App or install anything.

- [ ] **Step 5: Record the candidate change**

Suggested commit: `test: exercise real endpoint setup behavior`

---

### Task 8: Add Monitor-Side DeepSeek Insight Jobs

**Files:**
- Create: `database/migrations/004_insights.sql`
- Create: `apps/worker/src/ai/provider.ts`
- Create: `apps/worker/src/ai/deepseek.ts`
- Create: `apps/worker/src/ai/schema.ts`
- Create: `apps/worker/src/jobs/insight.ts`
- Create: `apps/worker/tests/insight.test.ts`
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/api/src/routes/admin-console.ts`
- Modify: `apps/web-console/src/app/insight/page.tsx`

**Interfaces:**
- Environment: `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `DEEPSEEK_TIMEOUT_MS`.
- Provider interface:

```ts
export interface InsightProvider {
  generate(input: InsightInput, signal: AbortSignal): Promise<InsightOutput>;
}
```

- `InsightInput` contains organization/team/date, coverage rate, active seconds, category totals, switch counts, and data-quality flags only.
- It must not contain raw event JSON, window titles, full domains for individuals, prompts supplied by endpoints, cookies, tokens, or Agent secrets.
- `InsightOutput` uses this exact contract:

```ts
export interface InsightMetric {
  name: string;
  value: number;
  unit: "seconds" | "count" | "ratio" | "percent";
  periodStart: string;
  periodEnd: string;
}

export interface InsightFinding {
  title: string;
  explanation: string;
  evidence: InsightMetric[];
  recommendation: string;
  confidence: number; // 0 through 1
}

export interface InsightOutput {
  summary: string;
  findings: InsightFinding[];
  provider: "deepseek";
  model: string;
  generatedAt: string;
}
```

Reject unknown output properties, empty evidence arrays, confidence outside 0 through 1, and evidence periods outside the input snapshot period.

- [ ] **Step 1: Add Insight persistence**

Migration creates `insight_jobs` and `insight_reports` with organization scope, team/date uniqueness, status, attempts, provider/model, structured output, evidence snapshot hash, timestamps, and sanitized error code. Do not store API keys or full prompts.

- [ ] **Step 2: Write fake-Provider tests first**

Cover successful schema-valid output, invalid JSON/schema rejection, timeout, 429 retry, 5xx retry, non-retryable 4xx, redacted errors, and `rules_only` fallback.

- [ ] **Step 3: Implement the Provider-neutral job**

The job reads completed aggregates, creates an immutable evidence snapshot, calls the injected Provider, validates output, persists the report, and marks the job succeeded or failed. A failed model call must not delete or corrupt rule-based aggregates.

- [ ] **Step 4: Implement the DeepSeek adapter**

Use the configured base URL and model. Apply a 30-second default timeout, at most three attempts for 429/5xx with bounded backoff, no retry for authentication/validation 4xx, and no logging of Authorization headers, request prompts, or response bodies containing sensitive data.

- [ ] **Step 5: Keep the API read-only with respect to model calls**

`GET /v1/admin/insight` reads persisted reports and rule facts. It must never call DeepSeek inside an HTTP request. Return `mode: "ai"` when a current valid report exists; otherwise return `mode: "rules_only"` with an explicit reason.

- [ ] **Step 6: Render traceable Insight output**

The page shows generation time, Provider/model label, evidence period, findings, evidence metrics, recommendations, and fallback status. It must not label rule-only statistics as AI-generated.

- [ ] **Step 7: Run offline tests**

Run: `cd apps/worker && npm test && npm run typecheck`

Expected: all tests use a fake Provider; no real external API call occurs.

- [ ] **Step 8: Keep sandbox verification separate**

Only when the user supplies/authorizes a monitor-side sandbox key, run one synthetic aggregate request. Record only status, model name, latency, schema result, and redacted error code in a new evidence file. Without that run, keep `deepseek_sandbox_verified: unverified`.

- [ ] **Step 9: Record the candidate change**

Suggested commit: `feat: add monitor-side deepseek insight pipeline`

---

### Task 9: Prove the Monitor-Side Vertical Slice

**Files:**
- Modify: `tests/e2e/agent-api-roundtrip.test.ts`
- Create: `tests/e2e/monitor-console-roundtrip.test.ts`

**Interfaces:**
- Proves: enroll -> upload -> API validation -> PostgreSQL -> Worker classification/aggregation -> admin login -> dashboard/subject/Insight API.

- [ ] **Step 1: Start only monitor-side prerequisites**

Use three terminals and the project-local compose file. Do not build or start the endpoint App.

Terminal 1:

```bash
docker compose -f infra/local/docker-compose.yml up -d postgres
cd apps/api
TEST_DATABASE_URL=postgres://workinsight:workinsight_dev@127.0.0.1:5433/workinsight_test npm run db:test:create
DATABASE_URL=postgres://workinsight:workinsight_dev@127.0.0.1:5433/workinsight_test npm run db:migrate
DATABASE_URL=postgres://workinsight:workinsight_dev@127.0.0.1:5433/workinsight_test PORT=8080 npm run dev
```

Terminal 2:

```bash
cd apps/web-console
API_URL=http://127.0.0.1:8080 npm run dev
```

After synthetic uploads, run the Worker once:

```bash
cd apps/worker
DATABASE_URL=postgres://workinsight:workinsight_dev@127.0.0.1:5433/workinsight_test npm run dev -- --once
```

- [ ] **Step 2: Seed an isolated organization and admin**

Use unique IDs per test run. Never rely on a developer's existing organization, device, or activity rows.

- [ ] **Step 3: Upload recent synthetic events through the public API**

Enroll using a single-use code, upload app/browser metadata events, confirm ACKs, and replay one event to prove idempotency.

- [ ] **Step 4: Run Worker jobs once**

Run classifier, aggregator, summarizer, and fake-Provider Insight jobs. Query PostgreSQL to prove rows were created for the correct organization only.

- [ ] **Step 5: Log in through the Web-facing `/api` path**

Preserve the `wi_session` cookie, fetch Dashboard, Devices, Subject, and Insight routes, and assert values are derived from the seeded events rather than fixed sample data.

- [ ] **Step 6: Clean up only isolated test rows**

Delete by the unique organization ID in foreign-key-safe order. Never truncate shared tables.

- [ ] **Step 7: Run and record evidence**

Run:

```bash
cd tests/e2e
E2E_DATABASE_URL=postgres://workinsight:workinsight_dev@127.0.0.1:5433/workinsight_test \
E2E_API_BASE=http://127.0.0.1:8080 \
E2E_WEB_BASE=http://127.0.0.1:3000 \
npm test
```

Expected: the complete monitor-side slice passes with recent synthetic data. This establishes `runtime_verified_monitor: pass` only for the documented local environment; it does not prove Windows, real browsers, packaging, or production.

- [ ] **Step 8: Record the candidate change**

Suggested commit: `test: verify monitor-side vertical slice`

---

### Task 10: Add Public-Repository Quality Gates Without Packaging Apps

**Files:**
- Create: `.github/workflows/quality.yml`
- Modify: `README.md` only to document the workflow after it exists.

**Interfaces:**
- Triggers: pull request and push to `main`.
- Produces: independent jobs for Rust source tests, API with PostgreSQL service, Worker, Web, extension, endpoint UI, contract/release verifier.
- Forbidden: Tauri bundle build, signing, notarization, GitHub Release creation, deployment, or App installation.

- [ ] **Step 1: Define least-privilege workflow permissions**

Use `contents: read`. Pin major action versions. Do not expose repository secrets to pull requests.

- [ ] **Step 2: Add Rust source checks**

Run format, Clippy, and workspace tests from `apps/endpoint-agent/src-tauri`. Do not run `cargo tauri build`.

- [ ] **Step 3: Add Node component jobs**

Each component uses its own lockfile with `npm ci`, then its test and typecheck/build command. Browser extension and Web builds are allowed; Mac App packaging is not.

- [ ] **Step 4: Add PostgreSQL-backed API integration tests**

Use a PostgreSQL 16 service and a database name ending in `_test`. Run migrations before API integration tests. Ensure Task 1 removed calendar expiry.

- [ ] **Step 5: Run a local workflow-equivalent command set**

Execute the same commands locally without creating App bundles. If GitHub has not run the workflow yet, report `local_equivalent`, not `ci_passed`.

- [ ] **Step 6: Record the candidate change**

Suggested commit: `ci: add non-packaging quality gates`

---

### Task 11: Rebaseline the Audit and Delivery Evidence

**Files:**
- Create: `docs/reviews/2026-08-18-grok-remediation-review.md`
- Modify: `docs/evidence/delivery-status.json`
- Modify: `README.md` current-status table if the evidence changed.

**Interfaces:**
- Produces one current report tied to an exact branch and commit.
- Does not rewrite the historical 2026-08-12 report.

- [ ] **Step 1: Map every old finding to current evidence**

For B-001 through B-016 and P3-001, use `closed`, `partial`, `open`, or `blocked`, with current file/line evidence and the command that verifies the conclusion.

- [ ] **Step 2: Add the new findings from this plan**

Include Web/API route mismatch, session-cookie mismatch, time-expiring tests, fail-open plaintext queue, prohibited screenshot copy/schema, absent model Provider, absent CI, and the published `privacy` schema mismatch.

Reconcile `docs/architecture/event-contract.md` with the executable v1 contract: `privacy` is the string literal `"normal"` for accepted events, while `"private"` is rejected. If a structured privacy object is desired, that is a versioned schema migration and must not be silently introduced during this remediation.

- [ ] **Step 3: Update delivery status conservatively**

Rules:

- `local_tests: pass` only when all named current suites pass.
- `runtime_verified_monitor: pass` only after Task 9 succeeds.
- `deepseek_sandbox_verified: pass` only after an authorized real sandbox call.
- `runtime_verified_win`, `browser_distribution_verified`, packages, signing, notarization, Release, update, pilot, and user installation remain `unverified` without direct evidence.
- A successful Git push proves source availability only; it does not prove `remote_release`.

- [ ] **Step 4: Verify repository hygiene**

Run:

```bash
git status --short
git diff --check
git ls-files | rg '(^|/)__pycache__/|\.py[co]$' && exit 1 || true
rg -n 'DEEPSEEK_API_KEY\s*=|Bearer [A-Za-z0-9_-]{20,}|password\s*=' . --glob '!**/node_modules/**' --glob '!**/target/**'
```

Inspect any matches; never paste secret values into the report.

- [ ] **Step 5: Record the candidate change**

Suggested commit: `docs: rebaseline integration and delivery evidence`

---

### Task 12: Hold Platform and Release Gates Until Explicit Authorization

**Files:**
- Update evidence files only after the relevant authorized run.

**Interfaces:**
- Windows target: Windows 11 runner.
- Browser target: real Chrome and Edge with a final extension ID and Native Messaging manifest.
- Release target: versioned, signed, notarized, checksum-tracked assets and tested update path.

- [ ] **Step 1: Keep Windows honest**

If no Windows 11 runner is available, leave `local_build_win` and `runtime_verified_win` as `unverified`. macOS compilation of Windows stubs is not Windows evidence.

- [ ] **Step 2: Keep browser distribution honest**

Extension unit/mock tests do not prove a real unpacked/store-installed extension. Record real Chrome and Edge results separately only after a user-authorized runtime session.

- [ ] **Step 3: Do not package the Mac App under this plan**

The current instruction prohibits App builds and installations. Do not run the PowerShell/macOS packaging commands documented in older evidence files.

- [ ] **Step 4: Prepare a release-readiness report, not a Release**

List remaining requirements: version decision, changelog, Apple signing identity, notarization credentials, Windows signing, checksums, update manifest, rollback asset, installation/upgrade/uninstall tests, and explicit user approval.

- [ ] **Step 5: Version rule**

Keep source version `0.1.1` during remediation. Propose `0.1.2` only after all local gates pass and the user explicitly asks for a version bump and GitHub publication.

---

## Final Verification Matrix

Grok must report each row separately and include exact commands, environment, result, and limitations.

| Gate | Minimum acceptance | Current target |
| --- | --- | --- |
| Repository | Clean scoped diff; no unrelated files | Required |
| Rust source | fmt + Clippy + workspace tests | Pass |
| Endpoint UI | production controller tests + typecheck | Pass |
| Extension | all tests; no full URL/private mode leakage | Pass |
| API | unit/integration/typecheck; concurrent enrollment | Pass |
| Worker | rule jobs + fake-Provider Insight tests/typecheck | Pass |
| Web | API-client and production page tests/typecheck | Pass |
| Monitor E2E | synthetic event through API/DB/Worker/Console | Pass |
| DeepSeek sandbox | authorized real Provider call | Unverified unless run |
| macOS runtime | real background/permission/long-run evidence | Partial until authorized |
| Windows runtime | Windows 11 native runner | Unverified until available |
| Browser runtime | real Chrome and Edge | Unverified until authorized |
| Mac/Windows packages | build/sign/install/upgrade | Forbidden in this plan |
| GitHub Release/update/pilot | direct remote/user evidence | Unverified |

## Grok Completion Report Format

Return a final report with exactly these sections:

1. **Outcome:** what user-visible vertical slice now works.
2. **Baseline and final commit:** exact hashes and branch.
3. **Changed files:** grouped by Agent, API, Worker, Web, tests, CI, and docs.
4. **Tests:** command, pass/fail count, environment, and whether the result used mock/synthetic/real services.
5. **Old finding closure:** B-001 through B-016 and P3-001.
6. **New finding closure:** authentication, admin routes, time-expiring tests, encryption fail-closed, prohibited screenshot schema/copy, AI Provider, CI.
7. **Delivery states:** every key from `docs/evidence/delivery-status.json`, with no inferred promotion.
8. **Not executed:** Mac App build/install/launch, signing, notarization, Windows runtime, browser GUI, DeepSeek sandbox, GitHub Release, or push unless separately authorized.
9. **Risks and blockers:** only current, evidence-backed blockers.
10. **Suggested next command:** one safe command, not an unauthorized deployment action.

## Definition of Done for This Plan

- API tests no longer depend on the calendar date.
- Enrollment is atomic under 50 concurrent uses.
- Login, session cookie, logout, and RBAC work through the Web-facing path.
- Every current Web page calls an implemented API endpoint with an exact tested response.
- No Web copy, type, policy example, Agent payload, or API response suggests screenshot/content capture.
- Enrolled endpoint collection fails closed when encryption material is unavailable.
- Health no longer hard-codes permission success.
- Setup UI tests execute production controller code.
- Rule Worker and monitor-side DeepSeek pipeline are separate, tested, and auditable.
- A synthetic event reaches API/DB/Worker/Console in one reproducible monitor-side E2E test.
- CI checks source/tests without packaging an App.
- The current audit and delivery status match actual evidence.
- No App was built, installed, launched, replaced, or copied by executing this plan.
- Platform, package, Release, update, pilot, and user-install states remain unverified until directly proven.
