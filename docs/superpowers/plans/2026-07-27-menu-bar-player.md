# Coda Menu-Bar Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a native compact player behind Coda's existing tray icon without creating a second playback engine.

**Architecture:** A hidden Tauri utility webview renders a dedicated compact React root. The main renderer emits bounded playback snapshots and handles compact-player commands through Tauri events, while Rust owns tray toggling and monitor-safe positioning.

**Tech Stack:** Tauri 2.11, Rust 2021, React 19, TypeScript 5.7, Vitest, Testing Library, Lucide React, CSS.

## Global Constraints

- The main renderer remains the only owner of the audio element and playback queue.
- Never persist credentials, signed artwork URLs, or signed stream URLs.
- Keep the existing right-click tray controls and main window decorations.
- Linux must use a tray-menu fallback because Tauri does not emit tray click events there.
- Preserve reduced-motion behavior and visible keyboard focus.
- Add no dependency and broaden capabilities only to the new window's required hide operation.

---

### Task 1: Compact-player event contract

**Files:**
- Create: `src/miniPlayer.ts`
- Test: `src/miniPlayer.test.ts`

**Interfaces:**
- Produces: `MiniPlayerSnapshot`, `MiniPlayerCommand`, `createMiniPlayerSnapshot`, `parseMiniPlayerSnapshot`, and bounded command parsing.
- Consumes: `Track` from `src/types.ts`.

- [ ] **Step 1: Write failing validation tests**

Add literal fixtures covering valid state, text bounds, invalid numeric values,
and rejection of out-of-range seek/volume commands.

- [ ] **Step 2: Verify the test fails**

Run `npm test -- src/miniPlayer.test.ts` and confirm the missing module is the
failure.

- [ ] **Step 3: Implement the minimal typed contract**

Create bounded parsers and a snapshot builder that strips stream URLs and
copies only display metadata.

- [ ] **Step 4: Verify the test passes**

Run `npm test -- src/miniPlayer.test.ts`.

### Task 2: Compact React surface

**Files:**
- Create: `src/MiniPlayerWindow.tsx`
- Create: `src/MiniPlayerWindow.test.tsx`
- Modify: `src/main.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: validated `MiniPlayerSnapshot` and emits `MiniPlayerCommand`.
- Produces: `MiniPlayerView` for observable UI tests and `MiniPlayerWindow` for the native event adapter.

- [ ] **Step 1: Write failing surface tests**

Assert real labels, metadata, progress values, disabled transport, empty state,
and callback payloads for play/pause, seek, volume, and open-main.

- [ ] **Step 2: Verify the tests fail**

Run `npm test -- src/MiniPlayerWindow.test.tsx`.

- [ ] **Step 3: Implement the surface and native adapter**

Use semantic buttons, native range controls, Lucide icons, artwork fallback,
strict listener cleanup, `Escape` dismissal, and request-state on mount.

- [ ] **Step 4: Add the compact entry-point branch and styles**

Select the compact renderer from `?view=mini-player` before creating the main
query client. Add scoped compact-window styles using existing CSS variables.

- [ ] **Step 5: Verify the surface tests pass**

Run `npm test -- src/MiniPlayerWindow.test.tsx`.

### Task 3: Main-player state bridge

**Files:**
- Create: `src/MiniPlayerBridge.tsx`
- Create: `src/MiniPlayerBridge.test.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: current track, radio timeline, playback clock, playback flags, volume, and existing player callbacks.
- Produces: live `coda://mini-player-state` events and handles `coda://mini-player-command` and request-state events.

- [ ] **Step 1: Write a failing bridge test**

Use an in-memory event adapter to assert immediate state emission, one-second
clock updates, request-state refresh, command routing, and strict cleanup.

- [ ] **Step 2: Verify the bridge test fails**

Run `npm test -- src/MiniPlayerBridge.test.tsx`.

- [ ] **Step 3: Implement and mount the bridge**

Resolve current artwork through the existing bounded cover cache, isolate clock
subscriptions inside the bridge, and route commands to the same callbacks used
by the full player.

- [ ] **Step 4: Verify the bridge test passes**

Run `npm test -- src/MiniPlayerBridge.test.tsx`.

### Task 4: Native menu-bar window

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: Tauri `TrayIconEvent::Click` bounds and the configured `mini-player` window.
- Produces: tray toggle behavior, focus-loss dismissal, Linux menu fallback, and monitor-safe position.

- [ ] **Step 1: Write failing Rust placement tests**

Cover a top menu bar, bottom taskbar, right-edge clamp, left-edge clamp, and
small-monitor vertical clamp with literal expected coordinates.

- [ ] **Step 2: Verify the Rust tests fail**

Run `cargo test --manifest-path src-tauri/Cargo.toml mini_player`.

- [ ] **Step 3: Implement native positioning and toggling**

Denylist the utility window from persisted window state, preserve the context
menu, toggle on supported left-click events, hide on focus loss, and use the
menu fallback everywhere.

- [ ] **Step 4: Configure the least-privilege window**

Add the hidden compact webview and allow only the existing core defaults plus
window hide for `main` and `mini-player`.

- [ ] **Step 5: Verify Rust tests pass**

Run `cargo test --manifest-path src-tauri/Cargo.toml mini_player`.

### Task 5: Integrated verification and delivery

**Files:**
- Review all changed files.

- [ ] **Step 1: Run frontend verification**

Run `npm test` and `npm run build`.

- [ ] **Step 2: Run native verification**

Run `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`,
`cargo test --manifest-path src-tauri/Cargo.toml`, and
`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`.

- [ ] **Step 3: Run hygiene checks**

Run `git diff --check` and inspect `git status -sb` plus the complete diff.

- [ ] **Step 4: Smoke test the desktop app**

Run `npm run dev`; verify compact window creation, tray toggle, focus dismissal,
empty state, transport synchronization, seek, volume, and main-window restore.

- [ ] **Step 5: Commit and publish**

Stage only feature files, commit with a terse feature message, push
`codex/menu-bar-player`, and open a draft pull request if the repository's
GitHub authentication is available.
