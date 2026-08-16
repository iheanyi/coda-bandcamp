# Coda Contributor Guide

This file applies to the entire repository. Coda is a native, cross-platform
Bandcamp library player built with Tauri 2, React 19, and TypeScript. Changes
should preserve its core character: fast startup, native desktop behavior,
predictable playback, and a small security surface.

## Product contracts

Treat these behaviors as product requirements, not implementation details:

- Coda connects through Bandcamp's official Subsonic endpoint:
  `https://bandcamp.com/api/subsonic`.
- The connection form accepts Bandcamp-issued Subsonic credentials, never a
  user's normal Bandcamp password.
- The current track remains in the queue as **Now Playing** when the rest of the
  queue is cleared. Users must always be able to pause or resume it.
- Player sessions restore paused with queue order, current track, playhead,
  repeat, volume, queue visibility, and at-most-once Last.fm progress intact.
  Never persist signed media/artwork URLs or credentials.
- Clicking compact-player artwork opens the full Now Playing page. Album text
  still opens album detail, and Back restores the exact underlying context.
- **Shuffle all** is contextual. It shuffles the artist, album, search results,
  genre, Recent, Singles, Albums, or Collection currently being viewed.
  **Surprise Me** uses that same visible scope to choose either one weighted
  track or one multi-track release without hydrating the whole scope; a chosen
  release queues its complete tracklist in album order. The tray action
  explicitly named **Shuffle Entire Library** remains global.
- Album artwork and album titles open an album detail page. Artist names open an
  artist page. Track titles start playback.
- Albums are full pages, not modals, so navigation and history remain coherent.
- Now Playing uses the platform View Transitions API to morph the compact
  player artwork into the detail view, with a compositor-only CSS fallback.
  Preserve reduced-motion bypasses, unique transition names, and reverse focus
  restoration when changing this navigation.
- Use `transitionCodaView` for major destinations and detail-page drill-ins
  only. Keep search, filters, sorting, queue mutations, and playback immediate.
  Forward and back motion must be directional, use only snapshot
  transform/opacity, and preserve the anchored sidebar and player.
- The queue is a floating, non-reflowing Show/Hide drawer with observable state
  and accessible labels. Its single entry point is the dedicated player control
  at bottom right; do not duplicate it in primary navigation.
- Authenticated album and track Favorites use Bandcamp's Subsonic `getStarred`,
  `star`, and `unstar` endpoints. `getStarred` is authoritative for albums, but
  Bandcamp can omit or delay individual track stars in that global response;
  reconcile known tracks through live `getAlbum` responses as albums hydrate
  and on explicit Refresh.
  Persist a bounded, stripped local track-star reconciliation index so accepted
  Bandcamp writes survive refresh and restart, but never describe that cache as
  device-local favorite truth or claim complete cross-device enumeration. Do
  not imply that Subsonic stars appear in Bandcamp's website UI or wishlist.
  The tested stars were visible to Subsonic clients only. Do not substitute the
  invalid `getStarred2` response or unreliable
  `getAlbumList2?type=starred` filter. Visibly roll back rejected writes, and
  remove a track only after `getAlbum` explicitly confirms its star is absent.
  Radio Favorites remain device-local because Radio is anonymous and outside
  Subsonic. Persist only bounded safe display metadata, never signed artwork or
  stream URLs. Playlists continue to sync to Bandcamp.
- Discover is anonymous and isolated from authenticated library credentials.
- Bandcamp Radio is anonymous and isolated too. Its public feed is not a
  supported developer-API contract, so validate it defensively and fail without
  affecting the authenticated library.
- A Radio show remains one queue item. Chapter metadata supplies current-song
  display, a seekable timeline, and verified Bandcamp links; do not inflate
  chapters into fake global queue tracks.
- Eligible Radio chapters scrobble as radio-selected songs with
  `chosenByUser=false` after genuine listened time reaches the Last.fm
  threshold. The complete show also scrobbles, but only from natural completion
  after enough actual listening; seeking must not manufacture either event.
- Radio session restore stores only the validated show ID, bounded metadata,
  and playhead. Reacquire the anonymous signed stream and chapter data on
  restore; never persist Radio stream or artwork URLs.
- Last.fm uses its desktop authorization flow. Coda never collects a Last.fm
  password, stores the per-user session key only in the system keyring, and
  scrobbles only after actual listened time reaches the Last.fm threshold.
- Closing the main window hides Coda to the system tray. The tray's Quit action
  is the explicit exit path.
- Native title bars and window-manager behavior are intentional. Do not replace
  them with custom HTML window chrome.

The Subsonic response does not provide a reliable release-type field. Until the
API offers one, Coda classifies one-track releases as Singles and multi-track
releases as Albums/EPs. Do not infer a more specific type from names or artwork.

## Repository map

- `src/App.tsx` — main renderer, library/player state, navigation, and queue UI.
- `src/DiscoverView.tsx` — lazy-loaded anonymous Discover feed using TanStack
  Query.
- `src/RadioView.tsx` — lazy-loaded Bandcamp Radio latest show and archive.
- `src/SavedLibraryView.tsx` — lazy-loaded Favorites, playlists, playlist
  details, and Add-to-playlist dialog using TanStack Query.
- `src/radioPlayback.ts` — bounded Radio chapter ordering and playhead lookup.
- `src/radioScrobbling.ts` — pure listened-time accounting, chapter/show
  eligibility, and bounded Radio scrobble deduplication.
- `src/lib.ts` — typed renderer-to-Tauri bridge, URL validation, hydration, and
  bounded runtime/local-storage caches.
- `src/types.ts` — shared TypeScript domain types.
- `src/queue.ts` — pure queue operations.
- `src/playerState.ts` — versioned player-session validation, sanitization, and
  lightweight checkpoint contracts.
- `src/NowPlayingView.tsx` — immersive player surface using the shared audio and
  player state.
- `src/libraryBrowse.ts` — artist grouping and release classification.
- `src/genres.ts` — genre normalization and catalog behavior.
- `src/media.ts` — feature-detected platform media helpers, including AirPlay.
- `src/styles.css` — design tokens, layouts, interaction states, and responsive
  behavior.
- `src/*.test.ts` and `src/*.test.tsx` — colocated frontend tests.
- `test/setup.ts` — jsdom matchers and browser/media shims.
- `src-tauri/src/lib.rs` — native commands, HTTP clients, validation, keyring,
  tray/window lifecycle, and Rust tests.
- `src-tauri/tauri.conf.json` — window, build, bundle, and CSP configuration.
- `src-tauri/capabilities/default.json` — renderer capability allowlist.
- `.github/workflows/cross-platform.yml` — Windows, macOS, and Linux CI/build
  coverage.

Keep new domain logic in focused pure modules when practical. `App.tsx` is
already large; do not make it the default home for independently testable
sorting, grouping, queue, or classification logic. At the same time, avoid an
unrelated architectural rewrite when making a scoped change.

## Development workflow

Prerequisites are Node.js `^20.19.0` or `>=22.12.0`, stable Rust, and the
platform prerequisites for Tauri.

```sh
npm install
npm run dev
```

`npm run dev` launches the complete Tauri app, including Vite HMR for renderer
changes and Rust rebuilds for native changes. Use `npm run web:dev` only for
renderer work that does not require native commands; browser-only testing is not
a substitute for checking the desktop app.

Development builds include the unified TanStack Devtools with Router and Query
inspectors. Open it from the middle-right hover target or with `Control+~`.
Use the Router inspector to verify route matches, search state, loaders, and
navigation timing. Use the Query inspector to verify cache keys, freshness,
deduplication, invalidation, retries, and retained data. Inspect the real Tauri
app when debugging product behavior. Devtools observations support diagnosis;
they do not replace regression tests or desktop automation evidence. The Vite
plugin strips Devtools from production builds, and the mini-player does not
mount them.

On Windows, PowerShell execution policy may block `npm.ps1`. Invoke `npm.cmd`
instead, and quote executable or repository paths that contain spaces.

Before editing:

1. Run `git status --short` and preserve unrelated or pre-existing changes.
2. Inspect the implementation and its nearest tests.
3. Search with `rg` or `rg --files`; do not scan generated output.
4. Prefer small, reviewable patches over mass formatting or drive-by cleanup.

Do not stage, commit, push, publish, or create a release unless the task
explicitly asks for it.

## Agent coordination

Use subagents by default when a task contains independent work that can run in
parallel. Good delegation targets include:

- inspecting separate frontend and Rust implementations;
- researching an API contract while another agent audits the local call path;
- implementing changes in files that do not overlap;
- writing focused tests while the primary implementation proceeds elsewhere;
- running independent accessibility, performance, security, or platform
  reviews.

Do not create a subagent merely to restate the task or handle a tiny sequential
step. Avoid parallel edits to the same file or tightly coupled state path unless
one agent is explicitly read-only. Security-sensitive decisions, destructive
actions, credential handling, and final integration remain the primary agent's
responsibility.

When delegating:

1. Give each agent a concrete, bounded outcome, relevant file ownership, and
   explicit verification expectations.
2. Tell agents to preserve the dirty worktree, avoid unrelated cleanup, and not
   stage, commit, or push.
3. Prefer non-overlapping workstreams and communicate shared contracts before
   implementation begins.
4. Continue useful primary-agent work while subagents run instead of waiting
   idly.
5. Review every returned diff and claim. The primary agent owns integration,
   conflict resolution, full verification, and the final user-facing summary.

Subagents may further delegate only when the new work is independently bounded
and does not create edit conflicts. Keep the agent tree shallow; coordination
overhead should not exceed the work being parallelized.

## Code-writing standards

- Start from the smallest complete change that satisfies the product contract.
  Do not add speculative abstractions, compatibility layers, or dependencies.
- Use domain-specific names that describe behavior and units. Prefer
  `positionSeconds`, `radioShowId`, or `currentTrack` over generic names such as
  `data`, `value`, or `item` when the meaning is not already obvious.
- Keep functions focused and favor early returns over deep nesting. Extract
  independently testable parsing, validation, sorting, and state-transition
  logic into pure modules.
- Keep TypeScript strict. Avoid `any`, unsafe non-null assertions, broad casts,
  and unvalidated `unknown` values. Model states explicitly with existing
  domain types or narrow unions.
- Treat renderer/native boundaries as untrusted. Validate and bound every input
  in Rust, return typed outputs, and keep renderer wrappers narrow.
- Handle failures at the layer that can add useful context. User-visible errors
  should be actionable without exposing credentials, tokens, raw server
  responses, or internal paths.
- Comments should explain intent, invariants, platform constraints, or
  non-obvious tradeoffs. Do not narrate straightforward code or preserve dead
  implementations in comments.
- Reuse existing helpers, tokens, components, and conventions before creating a
  second pattern. If duplication is genuinely local and clearer than an
  abstraction, keep it local.
- Keep state updates immutable and deterministic. Avoid hidden mutation,
  module-level mutable state, timing-dependent behavior, and effects that can be
  derived during render.
- Effects must own their cleanup. Guard asynchronous work against stale results,
  remove listeners and timers, and make Strict Mode remounts safe.
- Keep hot paths allocation-conscious, especially playback updates, queue
  rendering, chapter lookup, artwork loading, and bulk hydration. Do not perform
  repeated sorting or full-list scans during frequent media events when a
  memoized or incremental result is available.
- Prefer compositor-friendly `transform` and `opacity` for motion. Never animate
  layout merely for decoration, and always preserve reduced-motion behavior.
- Add or update the nearest regression test with the implementation. Tests
  should assert observable behavior and security invariants rather than private
  component structure.
- Run formatting and `git diff --check` before handoff. Do not mass-format
  untouched files or hide unrelated failures.

## Frontend and React conventions

- Use React state for playback, queue, navigation, authenticated library data,
  and other local application state.
- Keep Vite Fast Refresh boundaries runtime-component-only. A module that
  exports a React component or Provider must not also export hooks, contexts,
  query keys, or other non-component runtime values; move those to a focused
  `.ts` sibling and use type-only re-exports when an API type must stay nearby.
  Give the sibling a distinct basename rather than pairing `Thing.ts` with
  `Thing.tsx`, because TypeScript resolution can shadow the component module on
  case-insensitive filesystems.
- TanStack Query owns album metadata, Bandcamp album Favorites, Discover,
  Radio, and playlist server state. The bounded Bandcamp track-star
  reconciliation index, device-local Radio Favorites, player, and queue remain
  React/local application state; authenticated credentials never enter the
  query cache.
- Preserve lazy loading for Discover, Radio, and other code that is not needed
  for the initial library/player view.
- Use `useMemo`, `useCallback`, and `memo` where they prevent measured or
  structurally obvious work. Do not add memoization mechanically.
- Keep queue updates immutable and route reusable operations through the pure
  helpers in `src/queue.ts`.
- Keep Tauri event listeners safe under React Strict Mode: teardown must not
  race a pending asynchronous listener registration.
- Use semantic buttons, meaningful accessible names, `aria-pressed` for toggles,
  keyboard navigation, and visible focus states.
- Continue using Lucide icons and existing CSS variables/components unless a
  new dependency has a clear, documented benefit.
- Preserve the minimum supported window width of 760 px and verify responsive
  behavior around and below 900 px.

Controls must change real application state. Do not simulate pane navigation
with `scrollIntoView()` or focus alone. For two-way controls such as Show/Hide
Queue, test both transitions and the player-control/keyboard recovery path.

## Playback, queue, and library behavior

- Never discard the current playing track when clearing the queue.
- Avoid duplicate queue entries unless a user action explicitly calls for them.
- Save full player snapshots only for structural/settings changes. Use the
  lightweight checkpoint for playhead and scrobble progress; never serialize a
  whole-library queue every second.
- Restored queues may contain up to 25,000 tracks. Keep rendering bounded or
  progressive while preserving the complete in-memory and persisted queue.
- Reordering, removal, clearing, and shuffle operations require pure-helper
  coverage as well as a user-facing regression test when UI behavior changes.
- Contextual actions must derive their scope from the visible view, not silently
  fall back to the entire library.
- Bulk album/track hydration must remain bounded. The current concurrency limit
  is six; changing it requires evidence from profiling and network behavior.
- Batch progress updates during bulk work rather than rendering once per item.
- A failed signed-URL promise must be evicted so artwork and streams can recover
  on retry. Failed TanStack revalidation must retain the last usable album or
  playlist data.
- Artwork refresh must invalidate the relevant cache and retry the source; a
  broken image should not be cached permanently.
- Treat one-track release classification as a known API limitation, not a data
  quality bug.

Desktop builds persist a stripped library snapshot in the native app-data
directory for up to seven days and at most 5,000 albums; the web fallback uses
local storage under `coda.library.v1`. Tracks are deliberately omitted from
that snapshot. TanStack Query is the sole in-session album metadata cache and
redb is the sole restart-safe album metadata cache. Runtime Promise maps exist
only for signed cover and stream URLs (512 each); they deduplicate concurrent
requests and evict failures. Cache writes are idle/background work and must
never block playback. Disconnecting clears authenticated query and durable
cache data.

## Native, network, and security boundaries

Security-sensitive network and credential work belongs in Rust, not the
renderer.

- Store credentials only through the system keyring: Windows Credential
  Manager, macOS Keychain, or Linux Secret Service.
- Never persist credentials, normal Bandcamp session cookies, signed stream
  URLs, or sensitive library metadata in source, fixtures, logs, screenshots,
  issues, or public test output.
- Subsonic authentication uses a random salt and
  `MD5(password + salt)` token as required by that protocol. Do not put the raw
  password in a request URL.
- Subsonic playlist mutations use fixed literal endpoints and bounded POST form
  bodies. Validate names, comments, IDs, list counts, and removal indexes
  natively; destructive playlist deletion requires an explicit UI confirmation.
- Require HTTPS and allowlist Bandcamp/bcbits hosts. Validate every URL before
  opening it or returning it to the renderer.
- Do not broaden the Content Security Policy, remote opener scope, or Tauri
  capabilities to make a feature easier. Explain and test any necessary
  permission expansion.
- Discover inputs and responses must remain typed and bounded: validate tags and
  cursors, cap page/response sizes, enforce timeouts, and allowlist returned
  URLs.
- Radio responses must remain typed and bounded. Never persist its signed show
  streams. Persist only bounded listened-time and opaque chapter dedupe state
  for Last.fm; never persist chapter metadata in the player snapshot.
- Do not reverse-engineer or embed a user's normal Bandcamp web session. Library
  playback uses the official Subsonic API; Discover uses the anonymous public
  feed.
- AirPlay uses the operating system's feature-detected media picker. Do not add
  receiver discovery, credential interception, or media proxying.
- Treat Last.fm's API key/shared secret as recoverable desktop application
  credentials, not user secrets. Supply them to builds through
  `CODA_LASTFM_API_KEY` and `CODA_LASTFM_SHARED_SECRET`; never commit issued
  values. Keep user session keys in the OS keyring and all signing/network work
  in Rust.

When adding a Tauri command:

1. Implement and validate the Rust command.
2. Register it in `tauri::generate_handler!`.
3. Add a typed wrapper in `src/lib.ts`.
4. Add only the minimum capability permission required.
5. Cover validation, failure, and success behavior with tests.

Use `#[cfg(...)]` for platform-specific APIs. Code must compile where the
feature is unavailable and expose a graceful no-op or unavailable state.

## Desktop platform behavior

Coda uses real operating-system window decorations:

- Windows must retain the system menu, Snap layouts, dash minimize button,
  standard maximize/restore icon, title-bar dragging, and double-click maximize.
- macOS must retain native traffic lights and standard title-bar behavior.
- Linux must defer to the active window manager's conventions.

Do not absolutely center the window after first launch. Window state persists
position, size, maximized state, and visibility; restore it safely, including
when a saved monitor is disconnected. Startup and tray restore should
unminimize, show, and focus the window. Quit should save state before exiting.

Tray controls and window lifecycle require testing in the actual native app on
the host operating system. A DOM test cannot validate title-bar dragging,
multi-monitor placement, Snap, traffic lights, system menus, or tray behavior.
No single host can fully validate all three platforms, so preserve conditional
code and rely on the cross-platform CI matrix as an additional check.

## Verification

Run the smallest relevant test while iterating, then use the appropriate final
verification set.

Frontend changes:

```sh
npm test
npm run build
```

Significant frontend logic or performance changes:

```sh
npm run test:coverage
npm run build
```

Rust, networking, capability, tray, or window changes:

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Cross-layer changes should run all of the above and receive a native smoke test
with `npm run dev`. Exercise connection failure/retry, library loading, playback,
queue visibility and clearing, contextual shuffle, album/artist navigation,
artwork retry, tray restore, and window movement where relevant.

Coverage is a floor, not proof of correctness. The configured minimums are 40%
statements, 40% branches, 35% functions, and 45% lines. Add regression tests for
the behavior being changed even when the aggregate threshold already passes.
Unit tests should mock the Tauri bridge and must not contact a live Bandcamp
account or modify a user's library.

For distributable builds:

```sh
npm run desktop:build
```

Tauri produces platform-native artifacts on the current host. Do not claim a
Windows build validates macOS or Linux packaging. CI builds all three platforms.

## Performance review

Before adding a cache or abstraction, identify the repeated work it removes.
Preserve these established performance characteristics:

- Fast initial render from a stripped cached library snapshot.
- Lazy Discover code and paginated server-state caching.
- Promise deduplication for signed cover and stream URLs, with TanStack Query
  deduplication for album hydration.
- Bounded cache sizes and deterministic eviction.
- Bounded network concurrency.
- Batched progress updates during bulk operations.
- No source maps in production and an optimized, stripped Tauri release profile.

Measure startup, renderer responsiveness, network count, and memory retention
for performance-sensitive changes. A faster synthetic web render that delays
native readiness or playback is not a product win.

## Generated files and sensitive artifacts

Do not edit or commit:

- `node_modules/`
- `dist/`
- `coverage/`
- `src-tauri/target/`
- `src-tauri/gen/`
- `.playwright-cli/`
- `output/playwright/`
- `.env` or `.env.*` other than a deliberately sanitized `.env.example`
- installers, keyring exports, local caches, or captured authenticated traffic

Before handing off a change, review `git diff --check`, report exactly which
verification commands ran, note any platform behavior that could not be tested
locally, and call out security or capability changes explicitly.

## Agent skills

### Issue tracker

Issues and PRDs are tracked in GitHub Issues. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the default five-label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See `docs/agents/domain.md`.
