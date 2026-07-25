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
- Tauri capabilities grant only the three custom-titlebar window actions.
- Every identifier crossing the renderer/native boundary is length-checked and
  rejects control characters.
- Discover is an isolated anonymous client. Its endpoint, page size, sort
  allowlist, cursor/tag bounds, timeout, and 8 MB response ceiling are enforced
  in Rust. Saved Subsonic credentials are never loaded for these requests.
- Discover output is reduced to typed fields. Release links must be HTTPS
  `bandcamp.com` subdomains, while artwork and preview streams must be HTTPS
  `bcbits.com` subdomains before they can reach the renderer.
- Window-state persistence stores only geometry and maximized state. It never
  contains credentials, playback URLs, queue contents, or library metadata.
- AirPlay uses WebKit's operating-system playback-target picker only when that
  native capability is present. Coda does not discover receivers itself, proxy
  audio through a third party, or expose saved Bandcamp credentials to the
  picker.

The signed Subsonic media URL is passed to the local WebView audio element. Like
all desktop media players, code executing inside the trusted application process
can inspect active media requests. Coda prevents remote code execution in that
renderer through its CSP and never loads remote HTML or scripts.

## Reporting a vulnerability

Please report security issues privately to the maintainers and avoid including
real Bandcamp credentials, request URLs, or library metadata in a public issue.
