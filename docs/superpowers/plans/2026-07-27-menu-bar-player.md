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

### Task 6: Native generated-artwork fallback

**Files:**
- Create: `src/systemArtwork.ts`
- Create: `src/systemArtwork.test.ts`
- Modify: `src/MiniPlayerBridge.tsx`
- Modify: `src/MiniPlayerBridge.test.tsx`
- Modify: `src/lib.ts`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/system_media.rs`

**Interfaces:**
- Produces: `createSystemArtworkDataUrl(track)` returning a bounded PNG data URL
  rendered from title, artist, and palette.
- Consumes: the generated PNG as
  `SystemMediaSessionInput.track.fallbackArtworkDataUrl`.
- Preserves: real `MPMediaItemArtwork` bytes under a stable cover, album, or URL
  identity for immediate reuse during native session updates.

- [ ] **Step 1: Write failing renderer tests**

Assert that the artwork generator draws the Coda palette cover and that
`MiniPlayerBridge` includes its result in the system-media command.

- [ ] **Step 2: Verify the renderer tests fail**

Run `npm test -- src/systemArtwork.test.ts src/MiniPlayerBridge.test.tsx` and
confirm the new fallback expectations fail before implementation.

- [ ] **Step 3: Implement the renderer fallback**

Render one 600 by 600 canvas per track identity, encode it as PNG, keep the
result only in memory, and include it in the typed native-session payload.

- [ ] **Step 4: Verify the renderer tests pass**

Run `npm test -- src/systemArtwork.test.ts src/MiniPlayerBridge.test.tsx`.

- [ ] **Step 5: Write failing native validation and cache tests**

Assert that malformed or oversized PNG data URLs are rejected and that real
artwork cached under a stable cover identity is available before an async
refresh.

- [ ] **Step 6: Verify the native tests fail**

Run `cargo test --manifest-path src-tauri/Cargo.toml system_media`.

- [ ] **Step 7: Implement bounded native decoding and stable artwork reuse**

Decode only bounded `data:image/png;base64,` values, use them for the initial
`MPMediaItemArtwork`, and replace them with fetched real art. Reuse the last
real art immediately on play, pause, and metadata-only updates.

- [ ] **Step 8: Run full verification and package the app**

Run frontend tests and build, Rust format/tests/clippy, `git diff --check`, and
`npm run tauri -- build --bundles app`. Launch the exact packaged worktree app
for a native playback smoke test before publishing.

### Task 7: WebKit-only system media experiment

**Files:**
- Modify: `src/media.ts`
- Modify: `src/media.test.ts`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/MiniPlayerBridge.tsx`
- Modify: `src/MiniPlayerBridge.test.tsx`
- Modify: `src/lib.ts`
- Delete: `src-tauri/src/system_media.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Interfaces:**
- Produces: one WebKit `MediaSession` with title, artist, album, artwork,
  playback state, position, and previous/next track handlers.
- Preserves: `MiniPlayerBridge` as the state and command bridge for Coda's
  compact menu-bar window.
- Removes: renderer-to-Rust system-media commands and the macOS
  `MPNowPlayingInfoCenter`/`MPRemoteCommandCenter` publisher.

- [ ] **Step 1: Write failing Web Media Session tests**

Extend `src/media.test.ts` so `syncMediaSessionPlayback` must publish bounded
position state and generated artwork, while
`installMediaSessionTrackHandlers` must register previous/next and clear
seek-forward/seek-backward actions.

- [ ] **Step 2: Run the focused tests and verify failure**

Run `npm test -- src/media.test.ts src/App.test.tsx
src/MiniPlayerBridge.test.tsx`. Confirm position state and unconditional WebKit
publication assertions fail before changing implementation.

- [ ] **Step 3: Make WebKit the renderer's sole media publisher**

Always install Web Media Session handlers. Publish real artwork or
`createSystemArtworkDataUrl(currentTrack)` as the fallback, and send the current
duration, position, and playback rate through `setPositionState` when they are
valid.

- [ ] **Step 4: Remove native publication plumbing**

Remove `supportsNativeSystemMedia`, `updateSystemMediaSession`,
`SystemMediaSessionInput`, the native-sync effect in `MiniPlayerBridge`, the
registered Tauri commands, `system_media.rs`, and dependencies used only by that
module. Do not remove the mini-player event bridge or the HTML audio element.

- [ ] **Step 5: Run automated verification**

Run `npm test`, `npm run build`, Rust formatting, Rust tests, Rust clippy, and
`git diff --check`.

- [ ] **Step 6: Package and validate the experiment**

Quit every running Coda process, run `npm run tauri -- build --bundles app`,
launch the exact worktree bundle, begin local playback, and inspect macOS media
controls. Require exactly one Coda row with artwork, artist/album metadata,
play/pause, previous, and next track controls.

- [ ] **Step 7: Ship or roll back based on native evidence**

If every requirement in Step 6 passes, commit and push the WebKit-only
implementation. If WebKit still renders seek intervals, duplicates the session,
or drops working commands, restore the implementation changes while retaining
the documented result and keep the native publisher.
