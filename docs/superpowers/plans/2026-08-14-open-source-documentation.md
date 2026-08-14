# WorkInsight Open-Source Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a complete Apache-2.0 license and public-project documentation set without building or installing the Mac App.

**Architecture:** Keep runtime code unchanged. Put legal/project-wide rules in root files, developer workflow in contributor documentation, security reporting in `SECURITY.md`, and detailed development/licensing explanations under `docs/`.

**Tech Stack:** Markdown, Apache License 2.0, Cargo workspace metadata, GitHub repository metadata.

## Global Constraints

- The repository code is licensed under Apache-2.0 (`SPDX-License-Identifier: Apache-2.0`).
- README and docs must distinguish tested source components from unverified release/runtime evidence.
- Do not run `cargo tauri build`; do not generate, install, copy, or launch `.app`, `.dmg`, or `.pkg` files.
- Do not modify endpoint collection, upload, analysis, API, worker, browser-extension, or web-console runtime behavior.
- Preserve the existing privacy boundary: no screenshots, keystrokes, clipboard, page body, form, chat/email content, cookies, or full URLs by default.

---

### Task 1: License metadata and canonical license text

**Files:**
- Create: `LICENSE`
- Modify: `apps/endpoint-agent/src-tauri/Cargo.toml:1-26`

**Interfaces:**
- Produces the repository-wide Apache-2.0 declaration and the SPDX value consumed by Cargo and GitHub.

- [ ] **Step 1: Add the official Apache-2.0 text**

  Add the unmodified Apache License 2.0 text to `LICENSE`, without inventing a copyright holder.

- [ ] **Step 2: Update Cargo workspace metadata**

  Change `[workspace.package] license` from `proprietary` to `Apache-2.0`; leave crate inheritance intact.

- [ ] **Step 3: Check license consistency**

  Run:

  ```bash
  rg -n 'license\s*=|proprietary|Apache-2\.0' apps/endpoint-agent/src-tauri --glob 'Cargo.toml'
  ```

  Expected: the workspace declares `Apache-2.0`, member crates inherit it, and no `proprietary` declaration remains in the Rust workspace.

### Task 2: Public project README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Links contributors and users to `CONTRIBUTING.md`, `SECURITY.md`, `docs/development/getting-started.md`, `docs/licensing.md`, and the existing architecture/evidence documents.

- [ ] **Step 1: Rewrite the project overview**

  Explain WorkInsight as a cross-platform endpoint activity and browser-domain analysis system. State that the endpoint collects and protects events while monitor-side services perform classification, aggregation, rules, and optional model analysis.

- [ ] **Step 2: Document data boundaries and non-goals**

  Keep the explicit no-screenshot, no-keystroke, no-clipboard, no-page-body, no-form, no-chat/email-content, no-cookie, no-private-browsing, and no-full-URL defaults.

- [ ] **Step 3: Document evidence honestly**

  Separate source-level/component-test status from unverified Windows runtime, signing/notarization, remote release, model-provider, pilot, and installation evidence.

- [ ] **Step 4: Document safe development commands**

  Include test/typecheck commands and state that `cargo tauri build` and App installation are release-authorized operations, not normal contributor commands.

- [ ] **Step 5: Add license, contribution, security, and update links**

  Explain Git remote updates (`git pull`/`git push`) separately from an app auto-updater, which is not part of the current verified delivery.

### Task 3: Contributor, security, conduct, development, and licensing docs

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `docs/development/getting-started.md`
- Create: `docs/licensing.md`

**Interfaces:**
- `CONTRIBUTING.md` defines the contribution contract and points to the safe validation commands.
- `SECURITY.md` defines private vulnerability-reporting behavior without exposing a fake email address.
- `CODE_OF_CONDUCT.md` defines expected community behavior and maintainer enforcement.
- `docs/development/getting-started.md` provides component-specific setup and no-App validation.
- `docs/licensing.md` explains Apache-2.0, third-party licenses, and the WorkInsight trademark boundary.

- [ ] **Step 1: Write contribution rules**

  Require focused changes, tests for behavior changes, no secrets or personal monitoring data, and explicit approval before packaging/installing an App.

- [ ] **Step 2: Write the security policy**

  Direct sensitive reports to GitHub Security Advisories or the repository maintainer account; prohibit public disclosure of credentials, personal activity records, and exploitable details before coordination.

- [ ] **Step 3: Write the code of conduct**

  Define respectful, inclusive collaboration, prohibited harassment, and a private maintainer escalation path through GitHub.

- [ ] **Step 4: Write the development guide**

  Cover Node.js, Rust, Python, optional PostgreSQL, component tests/typechecks, environment files, and the distinction between tests and App packaging.

- [ ] **Step 5: Write the licensing guide**

  State that source code is Apache-2.0, third-party dependencies retain their own licenses, Apache-2.0 does not grant trademark rights, and the repository makes no warranty.

### Task 4: Documentation and repository validation

**Files:**
- Test: all files created or modified in Tasks 1–3

**Interfaces:**
- Produces a clean, internally consistent public repository ready for commit and push.

- [ ] **Step 1: Check Markdown and whitespace**

  Run `git diff --check` and scan changed Markdown for `TBD`, `TODO`, fake contact addresses, and broken relative paths.

- [ ] **Step 2: Check legal metadata**

  Confirm `LICENSE` contains Apache License 2.0, Cargo reports `Apache-2.0`, and README links to the license and policy documents.

- [ ] **Step 3: Check build boundary**

  Confirm no command executed during this work contains `cargo tauri build`, package/install commands, or App launch commands; verify no new `.app`/`.dmg`/`.pkg` appears in the project.

- [ ] **Step 4: Commit and push**

  Stage only the approved documentation, license, and Cargo metadata changes, commit with `docs: complete Apache-2.0 open-source documentation`, and push `main` after the checks pass.
