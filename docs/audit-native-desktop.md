# Native desktop audit — September 5, 2026

## Scope

Reviewed `src-tauri/src/lib.rs`, `desktop.rs`, `macos_window.rs`,
`media_session.rs`, `system_media.rs`, their nearest tests, Tauri window/CSP
configuration, and the renderer system-media bridge. Storage and network findings
are recorded separately in `audit-rust-storage.md` and `audit-rust-network.md`.
This is a source and host-runtime audit, not Windows/Linux device certification.

## Simplification implemented

The macOS title installer had a pass-through string helper, a constant-returning
binding-key helper, and a two-state visibility adapter whose only production call
always passed `true`. They created test seams without testing AppKit behavior.
The installer now passes the existing native title directly to the label, binds
the literal `title` property, and hides the original label after installing its
replacement. This also avoids a native-string → Rust-string → native-string
round trip at installation; no measurable startup-speed claim is made.

Removed two tests that exercised only those artificial seams. Retained the
preference-to-action test for title-bar double click. Also removed one media test
that searched source strings for `async fn` and `spawn_blocking`: it could pass
while blocking work ran before the offload. The shared command inventory still
guards async signatures; actual bounds/URL-validation tests remain. Native title
and media behavior require host-runtime checks, not source-text assertions.

## Remaining findings

| Priority | Finding                                                                              | Evidence and implication                                                                                                                                                                                                                                                                                                                       | Next step                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P2       | Windows metadata clear checks its generation before taking the session mutex.        | `media_session.rs`, `update_system_media_metadata`, empty-input branch: a clear can pass the check, wait for the mutex, then clear newer metadata if a newer operation acquires the mutex first. Normal updates recheck under the mutex in `with_system_media_session`. This is a source-level race finding, not a reproduced Windows symptom. | Add a deterministic contention test and recheck after acquiring the session lock; verify the real Windows media surface.                    |
| P2       | Tray Quit performs cover-index and window-state disk writes synchronously.           | `lib.rs` Quit handler calls `flush_cover_art_accesses`; `cover_cache/store.rs::flush_accesses` holds the runtime mutex while writing the index. A slow filesystem can stall the tray/menu thread.                                                                                                                                              | Profile shutdown with a populated cache; move flushing into an explicit awaited shutdown sequence if material, preserving save-before-exit. |
| P3       | Concurrent native metadata updates can duplicate remote artwork fetches/conversions. | `media_session.rs::resolve_system_media_artwork` has a cache lookup followed by fetch and conversion, without an in-flight map. The renderer normally limits updates, and the cache is bounded to 32 entries.                                                                                                                                  | Measure duplicate requests during rapid changes on Windows before adding another synchronization structure.                                 |

## Contracts checked and preserved

- Window-state plugin registration precedes setup, and launch unminimizes, shows,
  and focuses the main window. Offscreen recovery uses saturating monitor overlap
  calculations; the mini-player is separately positioned and excluded from saved
  main-window state.
- Close hides windows to the tray; the explicit tray Quit path saves state before
  exit. Native decorations and the hidden-window throttling policy remain intact.
- Windows media operations run on the blocking pool. The renderer bridge skips
  those IPC calls on other platforms, where Rust provides no-op adapters.
- System artwork validates host, content type, magic bytes and size. Timeline and
  metadata inputs remain bounded. No new IPC commands, CSP sources, or capabilities
  were added.

Final verification is recorded in `audit-2026-09-05.md`.
