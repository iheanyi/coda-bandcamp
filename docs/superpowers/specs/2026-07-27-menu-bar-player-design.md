# Coda Menu-Bar Player Design

## Goal

Add a compact menu-bar player that remains available while Coda's main window
is minimized or hidden. It must feel like a native extension of Coda, preserve
the main player as the single playback owner, and add no receiver discovery,
credential, or media-proxy behavior.

## Interaction model

- Coda's existing tray icon remains available whenever the app is running.
- On macOS and Windows, a left-click on the tray icon toggles the compact
  player beneath or above the icon, depending on the taskbar/menu-bar edge.
- The existing right-click menu remains intact and gains a `Mini Player` item.
  This is also the supported Linux entry point because Tauri does not emit tray
  click events on Linux.
- Clicking outside the compact player dismisses it.
- `Escape` dismisses it.
- `Open Coda` restores and focuses the main window.
- The compact player offers previous, play/pause, next, seek, mute, and volume
  controls. Disabled transport controls mirror the main player.
- The compact player does not start a second audio element or fetch a second
  stream.

## Visual design

The compact player is a 368 by 240 pixel undecorated utility window with an
inset canvas and a raised charcoal surface. It reuses Coda's existing
neutral palette, coral accent, typography, fine translucent dividers, rounded
artwork, progress rail, and Lucide icon language.

The hierarchy is:

1. A quiet utility header with the Coda name, `Open Coda`, and dismiss actions.
2. A now-playing row with 72 pixel artwork, a single-line track title, artist,
   and album.
3. Centered transport controls with a light primary play/pause button.
4. A seek rail with tabular elapsed and duration labels.
5. A low-emphasis volume row.

When nothing is queued, the player shows a restrained Coda mark, `Nothing
queued`, supporting copy, and an `Open Coda` action. It does not invent
placeholder track content.

Hover and focus states use the same contrast and coral focus treatment as the
main player. Motion is limited to opacity and transform and is removed under
`prefers-reduced-motion`.

## Architecture

### Native window and tray

`src-tauri/tauri.conf.json` declares a hidden `mini-player` webview window that
loads the existing frontend entry point with `?view=mini-player`. The window is
undecorated, non-resizable, always on top, omitted from the taskbar, and denied
to the window-state persistence plugin.

`src-tauri/src/lib.rs` toggles this window from the tray. A pure positioning
helper centers it on the tray icon, places it inside the monitor work area, and
clamps it to a safe edge gutter. The helper chooses below a top menu bar and
above a bottom taskbar. When tray bounds are unavailable, it places the window
near the top-right of the main or primary monitor.

The existing main window keeps native decorations and its current
window-manager behavior.

### Renderer state bridge

The main renderer remains the only playback owner. A focused bridge component
subscribes to Coda's existing playback clock and emits a bounded
`MiniPlayerSnapshot` to the compact window. The snapshot contains display
metadata, current position, duration, playing state, volume, and transport
availability. Signed artwork URLs may cross this in-memory event boundary but
are never written to storage.

The compact window validates unknown event payloads before rendering them. Its
controls emit bounded `MiniPlayerCommand` events to the main renderer, where
they call the same callbacks used by the full player. A request-state event
eliminates stale or empty content when the compact window first opens.

### Frontend entry point

`src/main.tsx` selects `MiniPlayerWindow` only when the query string identifies
the compact window. The regular `App` and its TanStack Query provider remain
unchanged for the main webview. The compact window does not initialize library
queries or its own audio element.

### Native artwork fallback

The main renderer produces an in-memory 600 by 600 PNG when a track becomes
current. It uses the same palette base, coral rule, title initials, and artist
label as Coda's generated album covers. The bounded PNG data URL crosses only
the native command boundary and is never persisted.

macOS publishes this generated cover through `MPMediaItemArtwork` while real
cover art is unavailable. Real artwork remains the first choice and replaces
the generated cover as soon as it resolves. A bounded, stable-keyed in-memory
cache retains the current real cover across play, pause, and metadata refreshes
so routine updates never clear artwork or flash the application icon.

## Error handling

- Event import, listener registration, and emission failures are treated as
  optional native-integration failures; the main in-window player remains
  functional.
- Invalid compact-player snapshots are discarded.
- Invalid seek and volume commands are ignored.
- Missing or failed artwork falls back to a palette-based Coda cover.
- Malformed or oversized generated artwork is rejected at the native boundary.
- Native show, hide, focus, and positioning calls fail closed without exiting
  the app.

## Accessibility

- Every icon-only control has an accessible name and title where helpful.
- Toggle state is announced through play/pause and mute/unmute labels.
- Progress and volume use native range inputs with hidden labels.
- Track metadata changes are exposed through an `aria-live="polite"` region.
- Focus remains visible, and `Escape` dismisses the utility window.
- Disabled controls use native `disabled` semantics.

## Verification

- Frontend unit tests cover snapshot validation, observable compact-player
  rendering, command dispatch, disabled transport, and the empty state.
- Rust unit tests cover top and bottom tray placement plus horizontal and
  vertical monitor clamping.
- Final verification runs `npm test`, `npm run build`, Rust formatting, Rust
  tests, Rust clippy, `git diff --check`, and a native `npm run dev` smoke test.
- The smoke test verifies window creation, tray toggling, focus dismissal, and
  command synchronization without contacting Bandcamp or testing live AirPlay.
