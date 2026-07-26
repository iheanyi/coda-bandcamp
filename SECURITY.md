# Security

## Security model

- The Bandcamp endpoint is compiled into the Rust backend and cannot be changed
  from the interface.
- Credentials are stored through the operating system credential store and are
  never written to application settings, logs, browser storage, or source maps.
- Subsonic token authentication sends an MD5 digest of the password plus a
  per-request random salt. The password itself is never placed in a URL.
- HTTP is disabled. Redirects are limited to `bandcamp.com` and Bandcamp's
  `bcbits.com` media domains.
- The renderer has a restrictive Content Security Policy, no remote frames, no
  forms, no object embedding, and production devtools are disabled.
- Tauri capabilities expose the minimum native surface used by the renderer.
  Remote opening is limited to verified Bandcamp HTTPS pages and Last.fm's
  exact authorization route; arbitrary external URLs are rejected in both
  TypeScript and the capability allowlist.
- Every identifier crossing the renderer/native boundary is length-checked and
  rejects control characters.
- Playlist creation/editing uses fixed Subsonic endpoints, bounded POST form
  fields, capped list sizes, and validated IDs/indexes. Credentials remain
  native/keyring-only and no mutation is issued without an explicit renderer
  action.
- Favorites are device-local because Bandcamp does not return a valid Subsonic
  Favorites envelope. Their versioned store is capped at 4 MiB and contains
  bounded IDs/display metadata plus stable cover IDs. Signed artwork/stream
  URLs, credentials, and embedded album tracks are stripped before persistence.
- Discover is an isolated anonymous client. Its endpoint, page size, sort
  allowlist, cursor/tag bounds, timeout, and 8 MB response ceiling are enforced
  in Rust. Saved Subsonic credentials are never loaded for these requests.
- Discover output is reduced to typed fields. Release links must be HTTPS
  `bandcamp.com` subdomains, while artwork and preview streams must be HTTPS
  `bcbits.com` subdomains before they can reach the renderer.
- Bandcamp Radio is another anonymous, credential-free client. Its fixed public
  endpoints, show identifiers, response sizes, text, chapter count, duration,
  artwork, item links, and audio hosts are validated in Rust before reaching
  the renderer.
- Window-state persistence stores only geometry and maximized state. It never
  contains credentials, playback URLs, queue contents, or library metadata.
- Player-session persistence is a separate versioned file in the operating
  system's per-user application-data directory. It is strictly validated,
  bounded to 25,000 tracks / 32 MiB, and written through a temporary-file
  replacement.
- Player snapshots contain only queue metadata and playback/scrobble progress.
  Every `streamUrl` and `artworkUrl` is stripped; credentials, Last.fm session
  keys, audio, cookies, and signed Bandcamp URLs are never written there.
- Transient Discover previews are excluded from restored sessions. Radio
  sessions persist only a validated numeric show identifier, bounded display
  metadata, queue position, and playhead; Coda anonymously reacquires fresh
  chapter, artwork, and signed stream data when the show is restored.
- AirPlay uses WebKit's operating-system playback-target picker only when that
  native capability is present. Coda does not discover receivers itself, proxy
  audio through a third party, or expose saved Bandcamp credentials to the
  picker.
- Last.fm requests use a separate HTTPS-only client with redirects disabled,
  strict metadata and response-size validation, and Last.fm's signed desktop
  API protocol. Coda never handles a Last.fm password.
- The Last.fm API key and shared application secret are build credentials and
  are necessarily recoverable from a distributed desktop binary. Local and CI
  builds receive them through environment variables so they do not enter source
  history. They are not treated as authentication for a user's account.
- A user's Last.fm session key is stored only in the operating system credential
  vault under a separate service name from Bandcamp credentials.

The signed Subsonic media URL is passed to the local WebView audio element. Like
all desktop media players, code executing inside the trusted application process
can inspect active media requests. Coda prevents remote code execution in that
renderer through its CSP and never loads remote HTML or scripts.

## Reporting a vulnerability

Please report security issues privately to the maintainers and avoid including
real Bandcamp credentials, request URLs, or library metadata in a public issue.
