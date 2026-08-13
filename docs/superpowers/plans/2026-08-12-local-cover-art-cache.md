# Coda Local Cover Artwork Cache

## Summary

Build an application-owned, restart-safe cache for authenticated Subsonic
`getCoverArt` bytes. Artwork is served through an index-gated `coda-cover`
native protocol, never through arbitrary filesystem paths or persisted
credential-bearing URLs.

The cache ships enabled after verification, covers artwork IDs obtained from
validated authenticated responses or validated persisted Coda state, and
excludes Discover, Radio, and Bandcamp Daily.

## Architecture and Interfaces

- Register one asynchronous `coda-cover` protocol for the main and mini-player
  webviews. Generate platform-correct sources synchronously with Tauri's
  `convertFileSrc`, enabling cached `<img>` elements on the first render after
  restart.
- Use the logical route
  `/v1/600/<encoded-cover-id>?v=<bounded-revision>&s=<session-scope>`.
  Accept only `GET` and `HEAD`, the fixed version and size, valid IDs, bounded
  revision tokens, an exact renderer-session scope, and the `main` or
  `mini-player` webview.
- On every request that reaches the protocol, native code verifies connection
  generation, authorization, invalidation state, index membership, file
  metadata, and a serving lease before reading a cached file. A warm disk hit
  never opens the credential store or waits on the network. Cache misses and
  stale revalidation load current credentials before authenticated network
  work. Successful responses are immutable within their renderer-session URL
  so virtualized remounts can use WebView caching without another native read.
- Add only `coda-cover:` and its Windows localhost form to `img-src`. Do not
  enable the asset protocol, add filesystem permissions, or broaden other CSP
  directives.
- Replace `fetchCoverUrl(): Promise<string>` with a synchronous renderer source
  helper, a random per-app-session scope, and a revision subscription. Native
  emits the bounded `coda://cover-art-updated` event only when validated content
  changes.
- Replace the native system-media artwork URL with a tagged input:
  - `{ kind: "cover", coverArtId }` reads or fetches validated bytes through
    the native cache.
  - `{ kind: "remote", url }` retains the existing Bandcamp and bcbits
    allowlist for anonymous artwork.
- Permit the exact local cover source in mini-player snapshot validation.
  Browser Media Session uses the local source; Windows native media receives
  the cover identifier instead of a local URL.
- Remove `get_cover_url`. Add narrow commands for single-entry invalidation and
  non-sensitive diagnostics. Update the static command and module inventories.

## Native Cache Implementation

### Storage and Index

- Store files under `app_cache_dir/cover-art-v1`; operating-system eviction is
  expected and recoverable.
- Keep a versioned atomic JSON index capped at 4 MiB and 5,000 entries. Each
  entry contains only a domain-separated SHA-256 key for
  `v1/getCoverArt/600/<id>`, content revision, media type, extension, byte
  length, dimensions, validation time, and last-access time.
- Store immutable files as `<key>-<content-revision>.<ext>`. Never store raw
  IDs, account identifiers, URLs, headers, tokens, salts, or credentials.
- Bound committed payload bytes to 256 MiB. Index and temporary-file headroom
  are excluded; one operation may require at most one additional 5 MiB
  temporary file.
- Publish in order: atomic image write, atomic index replacement, then old-file
  cleanup. Reuse Coda's cross-platform atomic helper.

### Validation and Fetching

- Fetch only
  `https://bandcamp.com/api/subsonic/rest/getCoverArt.view?size=600` with current
  Subsonic token and salt authentication, the existing timeouts, and a
  dedicated client. Foreground WebView requests start immediately; background
  revalidation continues through the shared request coordinator.
- Follow up to ten redirects through HTTPS Bandcamp and `bcbits.com` hosts.
  Reject credential-bearing, non-default-port, non-HTTPS, and unrelated
  targets. Never expose request URLs to the renderer or persist them.
- Require a success status and JPEG, PNG, or WebP MIME. Enforce a 5 MiB declared
  and streamed limit; a missing length is allowed, while a present length must
  equal the received byte count.
- Require MIME and signature agreement, parse valid container dimensions, and
  reject width or height above 4,096 pixels or total dimensions above
  16,777,216 pixels. WebView decoding remains the final compatibility check;
  decode failure invalidates and retries once.
- Deduplicate same-key work. Failed work leaves no in-flight entry and remains
  retryable.

### Authorization and Lifecycle

- Maintain an in-memory, connection-generation-scoped set of cover IDs,
  registered only while native code validates authenticated library, album,
  favorite, playlist, player-session, or durable-cache data.
- Protocol requests and fetches require authorization in that set. Index
  membership alone is insufficient.
- Capture connection generation and expected credentials for every fetch or
  revalidation. Recheck them under the publication lock immediately before
  committing.
- Do not add a renderer or native authenticated-session epoch for cached reads.
  A validated cover ID, current connection generation, authorization-set
  membership, clean invalidation state, and a valid indexed file are the full
  warm-read authority. A cover ID alone never authorizes disk or network work.
- On Disconnect or username change: advance generation, revoke protocol access,
  cancel queued work, clear authorization, then clear or fail-closed invalidate
  the cache. Include artwork cleanup in the existing cleanup warning.
- Store the fail-closed marker in application data so operating-system eviction
  of the cache directory cannot re-enable access. Retry cleanup before later
  access or writes.

### Freshness, LRU, and Scheduling

- Entries are fresh for 30 days. Serve intact stale bytes immediately and
  enqueue one low-priority revalidation.
- If bytes are unchanged, update freshness without changing the source
  revision. If changed, publish a new immutable file and emit the update event.
  Failed revalidation retains the previous bytes.
- Count a successful protocol or native system-media read as access. Keep exact
  ordering in memory and atomically flush access times every 30 seconds, after
  128 touches, and during explicit Quit. Lost batches may affect eviction order
  only.
- Resolve equal access times by stable key order. Reserve capacity under the
  cache lock before publication and evict unleased least-recently-used entries
  until both limits pass. If nothing is evictable, serve validated network
  bytes without persisting them.
- Start foreground artwork requests immediately when the WebView asks for them,
  without a native FIFO concurrency or rate gate. Allow at most one background
  revalidation, and keep background work on the shared Bandcamp request
  coordinator.

## Renderer Behavior

- `CoverArt`, Favorites, playlists, queue, player, Now Playing, and mini-player
  construct the local source synchronously whenever they have an authorized
  cover ID.
- Request every mounted local source eagerly. The existing TanStack Virtual
  viewport and overscan window bound collection-card mounting, so adding the
  browser's lazy-image gate would only delay just-in-time native cache reads.
- Remember at most 512 recently painted sources, keyed by source plus revision,
  so virtualized remounts request eager synchronous decoding. Do not retain
  detached image elements: WebKit may still discard their decoded pixels, and
  retaining 600px images can consume hundreds of MiB without preventing a
  repaint.
- While a valid source is loading or retrying, show only the album's base color
  behind the image. Render initials and artist text only after the source is
  absent or the single native retry fails, avoiding both a blank hole and a
  misleading full fallback card during decoding.
- Let the WebView cache a successful local source as immutable within the
  current random session scope. Rotate that scope on restart, Disconnect,
  account replacement, and explicit renderer cache clearing so prior-session
  sources are no longer addressable by normal application state.
- On image failure, invalidate exactly that native entry and retry once with a
  new cache-busting revision. A second failure shows the existing fallback
  without looping.
- The Artwork action continues recovering missing cover IDs, clears renderer
  failure state, and retries entries that failed. It does not revalidate every
  fresh cached entry.
- Disconnect clears renderer revision and failure state and rotates the session
  scope immediately after native revocation succeeds. Account replacement does
  the same before showing replacement-account data.
- Anonymous direct artwork URLs retain their current behavior and never enter
  this cache.

## Test and Acceptance Plan

- Pure native tests: key derivation, index bounds and serialization, freshness,
  deterministic LRU, reservations, leases, revision changes, authorization,
  generation races, and credential or URL absence.
- HTTP tests through an injected private transport: exact endpoint and
  parameters, bounded allowlisted redirect chains and rejection of untrusted
  redirect targets, redacted errors, supported MIME and signatures, dimensions,
  exact 5 MiB boundary, missing or mismatched length, chunk overflow,
  truncation, retries, and failed in-flight eviction.
- Filesystem tests on Linux, Windows, and macOS: atomic replacement, corrupt or
  oversized index, orphan and missing files, abandoned temporary files,
  symlinks, traversal, mismatched IDs, cleanup failure, and fail-closed
  recovery. Essential cache tests stay independent of Tauri's mock runtime.
- Protocol tests: allowed methods, route parsing, both webviews, CSP sources,
  revision and session-scope handling, immutable successful responses,
  non-cacheable errors, warm disk hits that never enter authenticated fetching,
  misses that enter authenticated fetching exactly once, revocation after
  Disconnect, and inability to read arbitrary files.
- Renderer tests: cold-start source exists on first commit, same-session remount
  remains eager, Back does not flash fallback, stale update changes revision,
  failed update retains old bytes, single-entry retry does not loop,
  mini-player accepts only the dedicated local source, and native media receives
  a cover ID.
- Race tests: fetch completion after Disconnect or account replacement, cleanup
  failure, reconnect cleanup, concurrent writes crossing capacity, and eviction
  while serving.
- Verification: `npm run test:coverage`, `npm run build`, Rust formatting,
  tests, clippy, `git diff --check`, and the cross-platform build matrix.
- Native QA: warm a 2,000-release library; restart offline without Disconnect;
  verify cached fresh and stale artwork; exercise forward and back navigation,
  mini-player, browser and native media metadata, failed revalidation,
  reconnection replacement, corrupted-cache recovery, account replacement, and
  Disconnect revocation.

## Locked Assumptions

- Limits are 5,000 entries, 256 MiB payload, 5 MiB per image, 30-day freshness,
  and fixed 600px Subsonic artwork.
- The feature ships enabled with no rollout switch or permanent legacy URL
  path.
- No eager whole-library artwork download is added.
- Current Bandcamp Terms and official Subsonic support must be rechecked before
  implementation; any new client or caching restriction pauses the work.

## Out of Scope

- Audio, Discover, Radio, and Bandcamp Daily byte caching.
- Persisting signed artwork or media URLs.
- Image transcoding, thumbnail generation, or quality changes.
- A user-facing cache-size preference.

## References

- [Tauri custom protocols](https://v2.tauri.app/develop/calling-rust/)
- [Tauri JavaScript API](https://v2.tauri.app/reference/javascript/api/namespacecore/)
- [Bandcamp Subsonic announcement](https://blog.bandcamp.com/2026/07/16/discover-improvements-and-subsonic-implementation/)
- [Bandcamp Terms](https://bandcamp.com/terms_of_use)
