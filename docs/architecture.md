# Coda architecture

Coda is a feature-oriented modular monolith. React owns interactive application state, while the Tauri core owns credentials, network access, persistence, and desktop integration. Pure TypeScript and Rust functions hold deterministic domain logic; React effects, Tauri commands, HTTP clients, keyring access, and operating-system adapters form the imperative shell.

Classic MVC is not the governing pattern. React already supplies one-way rendering, so adding controller classes would duplicate its state model. MVVM terminology is useful only for small renderer controller hooks, such as a future `useLibraryController` or `usePlaybackController`; those hooks should coordinate a feature rather than become a second application-wide state container.

## Native composition

`src-tauri/src/lib.rs` is the composition root. It owns application startup, plugin order, lifecycle wiring, shared process infrastructure, and the explicit Tauri command registration list. Feature behavior belongs in the modules below.

| Module | Responsibility |
| --- | --- |
| `models` | Bounded IPC and persisted domain models shared by native features |
| `subsonic` | Bandcamp credentials, Subsonic authentication, envelope decoding, and response validation |
| `bandcamp_http` | Allowlisted Bandcamp HTTP client, throttling, retry policy, and bounded JSON reads |
| `library` | Connection lifecycle, library synchronization, album fetching, and progress events |
| `library_cache` | Stripped library snapshot persistence |
| `album_cache` | Restart-safe redb album metadata cache and stale-write generation guards |
| `playlists` | Playlist commands and signed stream/cover URL commands |
| `player_state` | Player snapshot/checkpoint validation, persistence, diagnostics, and commands |
| `lastfm` | Last.fm desktop authorization, keyring session storage, request validation, now-playing, and scrobbling |
| `discover` | Anonymous Discover input validation, response parsing, and command |
| `radio` | Anonymous Radio catalog/show validation, parsing, and commands |
| `media_session` | Native media-session state, commands, artwork validation, and bounded artwork cache |
| `system_media` | Platform-specific system-media adapter |
| `desktop` | Main/mini-player window behavior and monitor-safe placement |
| `storage` | Shared clock and atomic-file-write primitives |
| `url_policy` | Typed Bandcamp page/media URL allowlist |
| `validation` | Small shared domain validators |
| `app_identity` | Stable application and Subsonic client identities |

Native tests mirror those feature boundaries under `src-tauri/src/tests/`. Tests may use common bounded fixtures from `tests/mod.rs`, but feature-specific helpers and assertions stay in the corresponding test module.

## Dependency rules

- The renderer treats every Tauri result as boundary data. Credentials and signing never move into React or browser storage.
- Authenticated library features depend on the Subsonic and Bandcamp transport boundaries. The transport layer never depends on a library feature.
- Discover and Radio remain anonymous and must not import authenticated credentials or Subsonic session state.
- Persisted models must never gain signed media URLs or credentials. Cache and player-state validation remains deny-by-default.
- Album cache locking, database initialization, connection generations, and per-album refresh generations form one concurrency protocol and must move together if ownership changes.
- Player snapshots and lightweight checkpoints share one persistence lock and validation boundary.
- Platform-specific code keeps a matching no-op or unavailable implementation on unsupported targets.
- `lib.rs` remains the auditable command-registration and plugin-order seam; moving a command must not change its wire name or argument contract.

## Renderer direction

TanStack Query remains the owner of remote album, Bandcamp album Favorites,
playlist, Discover, and Radio state. React/local state remains the owner of
navigation, the queue, playback, device-local Radio favorites, and the bounded
track-star reconciliation index required because Bandcamp persists song stars
but can delay or omit them from `getStarred`. The index stores only IDs and safe
display metadata; a live `getAlbum` response is the verification source and
signed URLs are never persisted. These Subsonic stars are separate from the
Bandcamp website UI and must not be presented as wishlist state. New renderer
decomposition should follow behavior rather than visual fragments:

1. Extract a library controller hook around connection, cached startup, synchronization, and Query updates.
2. Model queue/current-track invariants in a playback reducer and controller hook while keeping the high-frequency playback clock isolated.
3. Extract scrobbling and desktop-control hooks behind the existing Tauri bridge.
4. Split large views after those behavior seams exist; do not introduce a global store or routing framework solely for architectural symmetry.

## Last.fm client boundary

A third-party Last.fm crate may replace Coda's request/signing implementation only when it can preserve the existing wire contract and accept an appropriately hardened asynchronous HTTP client. At minimum that includes desktop token/session authentication, now-playing, `albumArtist`, `mbid`, `duration`, `trackNumber`, Radio's `chosenByUser=false`, HTTPS-only requests, disabled redirects, bounded timeouts, bounded response bodies, and sanitized errors.

The reviewed [`rustfm-scrobble` 1.1.1](https://github.com/dmfutcher/rustfm-scrobble) does not meet that boundary: its latest repository commit is from 2021, its API is synchronous over `ureq` 1, its track request model only exposes artist/title/album/timestamp, and it does not accept a caller-owned HTTP client. Adopting it would add a second HTTP stack while removing metadata and network protections, so Coda retains the focused native Last.fm transport. This can be revisited if the crate gains the missing fields and transport injection.
