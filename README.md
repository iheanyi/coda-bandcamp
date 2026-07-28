# Coda

[![Cross-platform](https://github.com/iheanyi/coda-bandcamp/actions/workflows/cross-platform.yml/badge.svg)](https://github.com/iheanyi/coda-bandcamp/actions/workflows/cross-platform.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A fast, cross-platform desktop player for your Bandcamp collection.

Coda adds the listening experience Bandcamp's website is missing: a persistent
queue, session restore, library navigation, playlists, favorites, Radio,
Discover, and Last.fm scrobbling in a focused native app.

![Coda browsing a Bandcamp collection, artists, Now Playing, and Bandcamp Radio](docs/assets/coda-demo.gif)

> [!IMPORTANT]
> Coda is pre-release software. There are no packaged releases yet, so it must
> currently be built from source. Bandcamp's Subsonic service is also in beta.

## Highlights

- Browse your collection by release, artist, album, single, genre, or recency.
- Queue, reorder, shuffle, search, and resume playback across app restarts.
- Keep device-local favorites and manage Bandcamp-synced playlists.
- Explore Bandcamp Discover and complete Bandcamp Radio show archives.
- See chapter-aware Radio metadata and seek through broadcast tracklists.
- Scrobble library tracks and eligible Radio chapters with Last.fm.
- Control playback from the system tray and use AirPlay on supported macOS
  WebKit hosts.
- Store Bandcamp and Last.fm account credentials in the operating system vault.

## Build from source

### Prerequisites

- [Node.js 22 or later](https://nodejs.org/)
- [Rust stable](https://rustup.rs/)
- The [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for
  your operating system

```sh
git clone https://github.com/iheanyi/coda-bandcamp.git
cd coda-bandcamp
npm ci
npm run dev
```

`npm run dev` opens the desktop app with frontend hot reload and automatic Rust
rebuilds. To create a native installer for the current platform:

```sh
npm run desktop:build
```

Tauri produces Windows installers on Windows, macOS bundles on macOS, and Linux
packages on Linux.

## Connect Bandcamp

1. Open **Settings** in Coda and choose **Connect**.
2. Open [Bandcamp Fan Settings](https://bandcamp.com/settings?pane=fan).
3. Generate a separate Subsonic username and password.
4. Enter those generated credentials in Coda.

Coda never asks for your normal Bandcamp password. It only connects to
Bandcamp's official HTTPS Subsonic endpoint, and it stores the generated
credentials in Windows Credential Manager, macOS Keychain, or Linux Secret
Service.

## Last.fm

Last.fm support uses its desktop authorization flow and never collects a
Last.fm password. Local builds enable the integration when these environment
variables are present at build time:

```text
CODA_LASTFM_API_KEY
CODA_LASTFM_SHARED_SECRET
```

For the current PowerShell session:

```powershell
$env:CODA_LASTFM_API_KEY = "your-api-key"
$env:CODA_LASTFM_SHARED_SECRET = "your-shared-secret"
npm run dev
```

The Last.fm session key created after authorization is stored in the operating
system credential vault.

## Technology

Coda uses [Tauri 2](https://v2.tauri.app/) and Rust for native integration,
credential handling, persistence, and the network security boundary. The
interface is React 19 and TypeScript, built with Vite. TanStack Query manages
remote server state, while TanStack Virtual keeps large libraries responsive.

The renderer never receives stored account passwords. Signed media URLs are
short-lived and are not written to the persistent player snapshot. See
[SECURITY.md](SECURITY.md) for the complete security model.

## Quality checks

```sh
npm test
npm run test:coverage
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

CI runs the frontend suite, production renderer build, Rust tests, Clippy, and
native Tauri builds on Windows, macOS, and Ubuntu.

## Contributing

Issues and pull requests are welcome. Before changing behavior, read
[AGENTS.md](AGENTS.md) for the architecture, security boundaries, platform
expectations, and repository conventions.

Please include tests for behavior changes and run the relevant quality checks
above before opening a pull request. Report vulnerabilities privately according
to [SECURITY.md](SECURITY.md), not in a public issue.

## License

Coda is available under the [MIT License](LICENSE).

Coda is an independent project and is not affiliated with or endorsed by
Bandcamp or Last.fm.
