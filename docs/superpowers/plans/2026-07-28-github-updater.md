# GitHub-hosted Tauri Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development for behavior changes. Preserve the dirty worktree and do not stage, commit, push, tag, or publish.

**Goal:** Ship a signed Tauri updater that checks GitHub Releases on native startup, prompts before installation, supports a manual check, and builds draft multi-platform releases with Last.fm enabled.

**Architecture:** A focused renderer module wraps Tauri's updater and process plugins behind a typed interface. A small React update manager owns automatic/manual checks, user-visible progress, dismissal, installation, and restart while leaving browser builds inert. Tauri Action builds signed update artifacts and `latest.json` into a draft GitHub Release from validated semantic-version tags.

**Tech Stack:** Tauri 2, React 19, TypeScript, Vitest, GitHub Actions, `@tauri-apps/plugin-updater`, `@tauri-apps/plugin-process`.

## Global Constraints

- GitHub Releases is the only update host: `https://github.com/iheanyi/coda-bandcamp/releases/latest/download/latest.json`.
- Tauri updater signatures are mandatory; commit only the public key.
- Keep the encrypted private key outside the repository and in GitHub's `release` environment.
- The automatic check runs once per native app session and never blocks startup, library loading, or playback.
- Download and installation begin only after an explicit user action.
- Browser builds do not contact GitHub or load native updater APIs.
- Automatic-check failures stay silent; manual-check and install failures are actionable.
- Preserve current-player and queue state across restart through the existing persistence path.
- Do not add Apple or Windows distribution signing in this change.
- Do not stage, commit, push, tag, publish, or create a release.

---

### Task 1: Typed updater boundary

**Files:**
- Create: `src/updater.ts`
- Create: `src/updater.test.ts`

**Produces:**
- `checkForAppUpdate(): Promise<AppUpdate | undefined>`
- `AppUpdate` metadata and `downloadAndInstall(onProgress)` behavior
- `restartAfterUpdate(): Promise<void>`

- [ ] Write tests proving browser mode returns without importing native plugins.
- [ ] Run the focused test and confirm it fails because the module is absent.
- [ ] Implement lazy desktop-only plugin loading and bounded progress normalization.
- [ ] Run the focused test and confirm it passes.

### Task 2: Update manager and accessible UI

**Files:**
- Create: `src/AppUpdater.tsx`
- Create: `src/AppUpdater.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/styles.css`

**Produces:**
- One automatic native check per QueryClient session.
- An accessible update prompt with version, bounded notes, Later, Update now, progress, and Restart Coda.
- A manual control in Connection Settings with checking, current, available, and failure states.

- [ ] Write failing component tests for available, no-update, dismissal, download progress, restart, manual failure, and browser behavior.
- [ ] Run the focused tests and confirm each fails for missing behavior.
- [ ] Implement the minimal component and App integration.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Native updater configuration

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/tauri.conf.json`

**Produces:**
- Updater and process plugins initialized only for supported desktop targets.
- Minimum updater/process permissions.
- GitHub endpoint, committed updater public key, passive per-user Windows updates, and updater artifacts.

- [ ] Add the official updater/process dependencies.
- [ ] Initialize both plugins with existing platform guards.
- [ ] Add only `updater:default` and the restart permission required by the process plugin.
- [ ] Configure `createUpdaterArtifacts: true`, endpoint, public key, and passive Windows install mode.
- [ ] Run Cargo formatting, focused frontend tests, and `cargo check`.

### Task 4: Release version validation and GitHub workflow

**Files:**
- Create: `tools/check-release-version.mjs`
- Create: `tools/check-release-version.test.mjs`
- Create: `.github/workflows/release.yml`
- Modify: `.github/workflows/cross-platform.yml`

**Produces:**
- Executable validation that a `vX.Y.Z` tag matches every Coda manifest and lockfile version.
- A tag-only, protected-environment matrix that builds Linux x64, Windows x64, macOS arm64, and macOS x64.
- A draft release containing installers, updater bundles, signatures, generated notes, and `latest.json`.

- [ ] Write failing Node tests for matching, malformed, and mismatched versions.
- [ ] Implement the validator and run the Node tests.
- [ ] Add `cargo fmt --check` to existing CI.
- [ ] Add the release workflow with pinned reviewed actions, minimal permissions, concurrency, Linux dependencies, build-time Last.fm values, updater signing values, and ad-hoc macOS signing.
- [ ] Validate the workflow syntax and run the version validator locally.

### Task 5: Authorized credential setup

**External state:**
- Last.fm API application for Coda.
- Local encrypted updater private key and public key.
- GitHub `release` environment and Actions secrets.

- [ ] Create the Last.fm API application using the authenticated browser session.
- [ ] Generate an encrypted updater keypair under `/Users/iheanyi/.tauri/` without logging secret material.
- [ ] Store the private-key password in macOS Keychain and preserve the encrypted private-key file for backup.
- [ ] Configure the GitHub `release` environment for version tags and approval.
- [ ] Set `CODA_LASTFM_API_KEY`, `CODA_LASTFM_SHARED_SECRET`, `TAURI_SIGNING_PRIVATE_KEY`, and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- [ ] Confirm secret names and environment configuration without reading secret values back.

### Task 6: Verification

- [ ] Run focused updater and release-validator tests.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- [ ] Run `cargo test --manifest-path src-tauri/Cargo.toml`.
- [ ] Run `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.
- [ ] Run `git diff --check` and inspect the complete diff for credentials, private URLs, capabilities, and unrelated changes.
- [ ] Exercise the native no-update/failure path without publishing a release when local runtime permits.
