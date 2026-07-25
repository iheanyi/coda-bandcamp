# Coda

Coda is a fast, focused desktop player for a Bandcamp collection. It connects to
Bandcamp's official Subsonic beta and adds the persistent queue the website is
missing.

## What works

- Secure Subsonic connection to `https://bandcamp.com/api/subsonic`
- Album library sync, search, normalized genre filters, and sorting
- Bulk **Add results to queue** for the current collection search
- Album track lists and real streaming
- Persistent on-screen queue with reorder, remove, clear, and shuffle actions
- Whole-library shuffle with bounded background album loading
- Public Bandcamp Discover browsing with tags, cached pagination, playable
  previews, and direct Bandcamp links
- Keyboard playback controls
- Native system tray/status-menu controls for Show, Play/Pause, Previous, Next,
  Shuffle Entire Library, and Quit
- System credential storage (Windows Credential Manager, macOS Keychain, or
  Linux Secret Service)
- Artwork retry and missing-cover recovery from album track metadata
- Native AirPlay route picker on supported Apple WebKit hosts

## Development

Prerequisites: Node.js 20+, Rust stable, and the platform prerequisites listed
in the Tauri documentation.

```sh
npm install
npm run desktop:dev
```

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

## Connecting Bandcamp

Bandcamp added Subsonic support in July 2026. Choose **Connect** in Coda, then
**Sign in and generate credentials**. Coda opens the exact Bandcamp Fan Settings
page in your default browser. Sign in there, scroll to Subsonic, generate
credentials, and return to Coda with the generated username and password.

Coda never asks for your normal Bandcamp password. It supports only Bandcamp's
HTTPS Subsonic endpoint and will never send the generated app credentials to
another host.

## Discover

Discover uses Bandcamp's anonymous public Discover feed. It is deliberately
separate from the authenticated Subsonic client: no saved username, password,
token, cookie, or library data is included in a Discover request.

TanStack Query owns only this paginated server state. It deduplicates requests,
keeps recently viewed filters warm for five minutes, and releases inactive data
after 30 minutes. Playback state, the queue, and the authenticated collection
remain local React/native state so changing a filter cannot reset listening.

Coda normalizes collection genre labels case-insensitively, ranks the most common
ones as quick filters, and keeps every remaining genre available under **More
genres**. Discover exposes Bandcamp's broader genre set through the same compact
pattern, while its free-form tag search still accepts subgenres and locations.

To reload artwork, choose **Artwork** beside **Sync**. Coda invalidates temporary
cover links, retries visible images, and checks missing album art against the
release's track metadata in bounded batches.

## Desktop behavior

Drag anywhere on Coda's custom top bar except the window-control buttons to move
the window, including across monitors. Coda remembers its last normal position,
size, and maximized state instead of re-centering on every launch. If that
monitor is later disconnected, Coda safely returns to the primary display.
Closing the main window keeps playback alive and hides Coda in the system tray
(Windows/Linux) or status area (macOS). Left-click the icon to restore Coda, or
use its native menu for playback controls. Choose **Quit Coda** from that menu
when you want to exit completely.

Choose **Shuffle all** in the collection header—or **Shuffle Entire Library**
from the tray—to load the collection with six bounded workers, randomize every
playable track, replace the queue, and begin playback.

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
Bandcamp.
