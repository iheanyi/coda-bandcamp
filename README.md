# Coda

Coda is a fast, focused desktop player for a Bandcamp collection. It connects to
Bandcamp's official Subsonic beta and adds the persistent queue the website is
missing.

## What works

- Secure Subsonic connection to `https://bandcamp.com/api/subsonic`
- Album library sync, search, normalized genre filters, and sorting
- Collection browsing by artist, multi-track album/EP, or one-track single
- In-app artist pages with release counts and whole-artist play/queue actions
- Release artwork and titles open track lists from the library, queue, or player
- Bulk **Add results to queue** for the current collection search
- Album track lists and real streaming
- Floating, non-reflowing queue drawer with reorder, remove, clear, and shuffle
  actions
- Device-local Favorites plus Bandcamp-synced playlist creation, renaming,
  editing, and deletion
- **Add to playlist** from release tracks, Favorites, playlists, and the player
- Crash-safe restoration for queue order, current track, playhead, volume,
  repeat mode, and queue visibility
- Immersive **Now Playing** view with large artwork, full controls, metadata
  navigation, and an Up Next preview
- Context-aware **Surprise me** action that picks and plays one random track
- Whole-library shuffle with bounded background album loading
- Public Bandcamp Discover browsing with tags, cached pagination, playable
  previews, and direct Bandcamp links
- Bandcamp Radio with a latest-show feature, browsable archive, chapter-aware
  playback, show tracklists, direct Bandcamp links, and queue actions
- Keyboard playback controls
- Native system tray/status-menu controls for Show, Play/Pause, Previous, Next,
  Shuffle Entire Library, and Quit
- System credential storage (Windows Credential Manager, macOS Keychain, or
  Linux Secret Service)
- Artwork retry and missing-cover recovery from album track metadata
- Native AirPlay route picker on supported Apple WebKit hosts
- Last.fm desktop authorization, Now Playing updates, and standards-compliant
  scrobbling without collecting a Last.fm password

## Development

Prerequisites: Node.js 20+, Rust stable, and the platform prerequisites listed
in the Tauri documentation.

```sh
npm install
npm run dev
```

`npm run dev` opens the native Tauri window and keeps both layers live: React
and CSS update through Vite hot reload, while Rust changes trigger an automatic
native rebuild and relaunch. The first Rust debug compile takes longer; later
frontend edits appear almost immediately and never require reinstalling Coda.
Queue changes become durable after a short debounce and the playhead
checkpoints every five seconds, so native rebuild/relaunch cycles restore the
saved session paused instead of starting from an empty queue.

Run all checks:

```sh
npm test
npm run test:coverage
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Build native installers:

```sh
npm run desktop:build
```

Tauri produces the platform-native formats supported by the current host:
NSIS/MSI on Windows, DMG/app on macOS, and deb/AppImage/rpm on Linux.
The `Cross-platform` GitHub Actions workflow runs the frontend suite, Rust tests,
Clippy, and a native Tauri build on Windows, macOS, and Ubuntu. Local Windows
success does not replace those host-native CI builds.

### Last.fm build credentials

Coda uses Last.fm's desktop authentication protocol. The issued API key and
shared application secret are compiled into the desktop binary; they are app
identifiers, not a user's Last.fm password or session. Keep them out of source
history by setting these environment variables before building:

```text
CODA_LASTFM_API_KEY
CODA_LASTFM_SHARED_SECRET
```

On Windows, store them for the current user with
`[Environment]::SetEnvironmentVariable(..., "User")`, then start a new terminal
before running `npm run dev` or a release build. Release CI should provide the
same names through encrypted repository secrets.

## Connecting Bandcamp

Bandcamp added Subsonic support in July 2026. Choose **Connect** in Coda, then
**Sign in and generate credentials**. Coda opens the exact Bandcamp Fan Settings
page in your default browser. Sign in there, scroll to Subsonic, generate
credentials, and return to Coda with the generated username and password.

Coda never asks for your normal Bandcamp password. It supports only Bandcamp's
HTTPS Subsonic endpoint and will never send the generated app credentials to
another host.

## Connecting Last.fm

Open **Settings**, choose **Connect Last.fm**, and approve Coda on Last.fm's
official authorization page. Return to Coda and choose **Finish connection**.
Coda never receives your Last.fm password. The resulting account session key is
stored in the operating system credential vault.

When playback starts, Coda sends a Now Playing update. A track is scrobbled
after real listening reaches half its duration or four minutes, whichever comes
first, following Last.fm's desktop-client guidance. Tracks of 30 seconds or less
are not scrobbled, and seeking does not manufacture listening time.

For Bandcamp Radio, Coda reports each eligible chapter as the song selected by
the broadcast (`chosenByUser=false`) and applies the same genuine-listening
threshold. When a broadcast reaches its natural end after enough actual
listening, Coda also scrobbles the Bandcamp Radio show itself. This gives both
the featured artist and the curated show an accurate Last.fm entry.

## Discover

Discover uses Bandcamp's anonymous public Discover feed. It is deliberately
separate from the authenticated Subsonic client: no saved username, password,
token, cookie, or library data is included in a Discover request.

TanStack Query owns only this paginated server state. It deduplicates requests,
keeps recently viewed filters warm for five minutes, and releases inactive data
after 30 minutes. Playback state, the queue, and the authenticated collection
remain local React/native state so changing a filter cannot reset listening.

Discover preview URLs are anonymous but transient and cannot be reacquired by
track ID through Subsonic. Coda omits Discover previews from restored sessions
instead of persisting stale media URLs; purchased library tracks remain fully
restorable.

Coda normalizes collection genre labels case-insensitively, ranks the most common
ones as quick filters, and keeps every remaining genre available under **More
genres**. Discover exposes Bandcamp's broader genre set through the same compact
pattern, while its free-form tag search still accepts subgenres and locations.

To reload artwork, choose **Artwork** beside **Sync**. Coda invalidates temporary
cover links, retries visible images, and checks missing album art against the
release's track metadata in bounded batches.

## Favorites and playlists

Bandcamp's Subsonic beta does not currently return a valid `getStarred2`
response, so Coda labels Favorites as device-local instead of implying that
hearts sync to Bandcamp. The local store is versioned and bounded; it contains
stable IDs, display metadata, and sanitized tracklists for saved releases.
Signed artwork and stream URLs are never persisted. Coda resolves fresh artwork
from the stored cover ID and opens saved releases immediately from local
metadata, then revalidates the tracklist against Bandcamp in the background.
Playback requests a fresh authenticated stream only when a track is played.

Playlists continue to use Bandcamp's authenticated Subsonic playlist endpoints.
Playlist server state is cached and deduplicated with TanStack Query. Opening
the Queue, switching collection views, or navigating back from a playlist does
not refetch unchanged data or disturb playback. Credentials never enter the
query cache: authenticated requests remain in the Rust backend and read
credentials from the operating-system vault.

## Bandcamp Radio

Radio uses Bandcamp's anonymous public show feed and direct episode streams.
Shows are cached briefly in memory with TanStack Query, while the audio itself
is never downloaded or cached by Coda. No Subsonic or Last.fm credentials are
attached to Radio requests.

Bandcamp does not currently document Radio in its supported developer API, so
this integration is deliberately isolated behind typed, size-bounded native
commands. If Bandcamp changes the public feed shape, Radio can fail closed
without affecting the authenticated collection. Coda preserves a Radio show's
bounded identifier, display metadata, queue position, and playhead, then
reacquires a fresh anonymous stream when a session is restored. Signed episode
and artwork URLs are never written to disk. Only bounded listened-time and
hashed chapter dedupe markers are restored; chapter payloads are reacquired.

When a show includes chapter metadata, Coda resolves the current song from the
audio playhead and surfaces it in the compact player, Queue, window title, and
Now Playing view. The show remains one honest queue item. Its tracklist is a
seekable chapter timeline instead of a collection of fake standalone songs;
linked chapter titles open verified Bandcamp HTTPS pages in the default browser
so a listener can save or buy the release. Eligible chapters are scrobbled
individually as radio-selected songs, while the show itself is scrobbled only
after natural completion and enough real listening. Restored sessions start paused at
the saved chapter and timestamp.

## Desktop behavior

Use Coda's native title bar to move the window, including across monitors. Each
platform owns its window controls and conventions: Windows provides
maximize/restore on title-bar double-click, its system menu, and Snap Layouts;
macOS provides native traffic lights and system-configured title-bar behavior;
Linux follows the active desktop environment and window manager. Coda remembers
its last normal position, size, and maximized state instead of re-centering on
every launch. If that monitor is later disconnected, Coda safely returns to the
primary display.
Closing the main window keeps playback alive and hides Coda in the system tray
(Windows/Linux) or status area (macOS). Left-click the icon to restore Coda, or
use its native menu for playback controls. Choose **Quit Coda** from that menu
when you want to exit completely.

The shuffle action follows the current screen: an artist, album, search result
set, genre, Recent, singles, albums, or the full collection. Artist pages also
provide a one-click **Shuffle** action beside **Play all** and **Add all**. Coda
loads only that scope with six bounded workers, randomizes its playable tracks,
replaces the queue, and begins playback. **Shuffle Entire Library** in the tray
remains explicitly global.

Click the artwork in the compact player to open **Now Playing**. The full view
uses the same audio element and playback state while adding large artwork,
elapsed/remaining time, transport and output controls, metadata links, and a
bounded Up Next preview. Supporting WebViews use a shared-element transition so
the compact cover expands into the detail artwork; other hosts receive a
transform-and-opacity fallback, and reduced-motion preferences bypass the
animation. **Minimize** reverses the spatial transition, restores the compact
player, and returns to the exact album, artist, Discover, or collection context
underneath it.

Major navigation also uses restrained View Transitions when the host supports
them. Sidebar destinations crossfade while artist, album, playlist, and Radio
show detail pages use short directional transitions that reverse on Back.
Search, filtering, sorting, queue operations, and playback remain immediate so
motion never slows routine interactions. Reduced-motion preferences bypass
these transitions.

Player state is a versioned, bounded snapshot in Coda's platform-native
application-data directory. Structural changes save after a short debounce;
the playhead and Last.fm progress use a lightweight five-second checkpoint so
large queues are not rewritten continuously. Relaunch restores paused and
fetches fresh Bandcamp media/artwork URLs. Very large queues render in batches
while remaining complete in memory and on disk.

On macOS, Coda shows an AirPlay button when the system WebKit media element
reports a native playback-target picker. The picker and routing are owned by the
operating system. The control stays hidden on Windows and Linux, where that
WebKit API is unavailable.

## Test posture

`npm run test:coverage` writes an HTML report to `coverage/index.html`. Coverage
includes the React screens as well as shared helpers, so the reported number is
an honest application baseline rather than a helper-only percentage. Rust
security, URL, parser, credential-backend, and multi-monitor contracts run under
`cargo test`; line coverage for Rust requires an optional `cargo-llvm-cov`
installation and is not currently reported.

## Independent software

Coda is an independent client and is not affiliated with or endorsed by
Bandcamp or Last.fm.
