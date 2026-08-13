# Local Cover Artwork Cache Plan

## Problem Statement

Coda currently remembers up to 512 signed cover URLs in memory for one hour, but it does not retain the image bytes across route remounts or application restarts. The browser cache often helps, yet it is not an application-owned contract: artwork can decode again during reverse navigation, large libraries repeat authenticated image requests, and an expired signed URL can no longer address bytes the user already viewed.

The goal is to make authenticated Collection artwork feel immediate while preserving Coda's security boundary. Coda must never persist signed URLs, credentials, or an unbounded mirror of Bandcamp content.

## Solution

Add a native, bounded, restart-safe cache for cover image bytes obtained through Bandcamp's official Subsonic `getCoverArt` endpoint. Entries are keyed by the stable validated cover-art identifier, never by the signed request URL. The native layer owns fetching, response validation, atomic writes, indexing, eviction, and cleanup. The renderer receives only a safe local image address scoped to the dedicated cache directory.

Initial policy:

- Cache only authenticated artwork belonging to the user's library. Anonymous Discover, Radio, and Bandcamp Daily artwork remain network-backed until separately reviewed.
- Store at most 5,000 entries and 256 MiB, with least-recently-used eviction. Both limits apply; the byte limit is authoritative.
- Treat entries as fresh for 30 days. Serve an intact stale entry immediately and revalidate in the background when connected.
- Cap each response at 8 MiB and accept only validated JPEG, PNG, or WebP bytes. Reject redirects or responses outside Bandcamp's fixed authenticated endpoint.
- Keep the asset protocol read-only and scoped to one dedicated cache directory. Do not grant general filesystem access or broaden media/network permissions.
- Delete or fail-closed invalidate the artwork cache on Disconnect, matching Coda's authenticated durable-cache contract.
- Never persist a signed URL, Subsonic token, salt, password, response header containing credentials, or user account identifier in the cache or index.

Bandcamp's current Terms grant users a personal, non-commercial license to reproduce service content and expressly contemplate reproducing artwork on devices they own or control. Bandcamp also officially supports streaming and downloading a user's collection through Subsonic clients. A bounded cache of the connected user's library artwork appears consistent with those terms, but this is an engineering assessment rather than legal advice. Recheck the live terms before implementation and stop for review if Bandcamp adds client-specific restrictions.

## Commits

1. **Document and test the cache contract**
   - Add pure contract tests for identifier-derived keys, byte and entry bounds, supported media types, freshness, stale behavior, and LRU ordering.
   - Add security assertions that serialized metadata cannot contain URL query strings, credentials, salts, tokens, or arbitrary paths.
   - Leave production behavior unchanged.

2. **Introduce the native cache index and atomic storage**
   - Add a dedicated cache directory and versioned index containing only stable cover identifier hashes, media type, byte length, freshness timestamps, and access timestamps.
   - Write image bytes through a temporary file plus atomic rename.
   - Recover from a missing, partially written, incompatible, or corrupt index by discarding only the disposable artwork cache.
   - Enforce the per-entry, total-byte, and entry-count bounds before and after every write.

3. **Fetch and validate artwork natively**
   - Replace URL-only cover resolution with a native cache lookup that fetches the fixed Subsonic cover endpoint on a miss.
   - Validate status, declared length, actual length, content type, and file signature before committing bytes.
   - Deduplicate concurrent requests for the same cover identifier and evict failed in-flight work so Retry Artwork can recover.
   - Preserve the existing six-request bulk-hydration ceiling; artwork fetching gets its own small bounded concurrency budget and must not compete with playback.

4. **Expose a narrowly scoped local image source**
   - Enable read-only local asset delivery for only the dedicated artwork cache directory and only as an image source.
   - Return a local source only after the native layer verifies that the requested identifier maps to a valid indexed file.
   - Add integration coverage proving path traversal, symlinks, unsupported extensions, arbitrary local files, and mismatched identifiers are rejected.

5. **Adopt cache-first artwork in the renderer**
   - Keep the current in-memory promise deduplication, but let its resolved value be the local cached source.
   - Render a known cached source on the first commit and keep the current fallback palette visible until a new network image is valid.
   - Preserve eager restoration for artwork already painted during the current session, reduced-motion behavior, and View Transition identity markers.
   - Ensure failed local sources invalidate one cache entry and retry the authenticated endpoint once rather than looping.

6. **Add stale-while-revalidate and deterministic eviction**
   - Serve intact stale bytes immediately, schedule revalidation outside the navigation/playback critical path, and atomically replace the file only after validation succeeds.
   - Update access metadata in batches so scrolling through Collection does not write to disk per card.
   - Evict least-recently-used entries until both limits are satisfied, never evicting a file currently being served or written.

7. **Wire privacy and lifecycle cleanup**
   - Clear the cache and its in-memory local-source map on Disconnect.
   - Add startup cleanup for abandoned temporary files and files not referenced by the index.
   - Add a bounded, non-sensitive cache summary for diagnostics: entry count, total bytes, hit/miss/stale counts, and cleanup outcome only.

8. **Measure and roll out**
   - Compare cold start, warm start, Collection scroll, card-to-detail, detail-to-card, network request count, decode time, disk use, and memory retention before and after.
   - Native-smoke at least a 2,000-release library, artwork refresh, offline restart, corrupted cache recovery, Disconnect, and rapid forward/back navigation.
   - Keep the feature behind an internal rollout switch until the security tests, full frontend and Rust suites, cross-platform build matrix, and native smoke paths are green.

## Decision Document

- The cache stores validated image bytes, not signed URLs.
- Stable cover-art identifiers are hashed for filenames; artist names, album titles, and account identifiers are not part of paths.
- The native layer owns all disk and authenticated-network behavior.
- The renderer gets narrowly scoped local image sources and never arbitrary filesystem paths.
- The cache is disposable, bounded, versioned, and cleared on Disconnect.
- Initial scope is authenticated Collection artwork only.
- Stale-while-revalidate is preferred over blocking a warm render on network freshness.
- Network and disk work must remain outside playback and navigation critical paths.

## Testing Decisions

- Pure tests cover bounds, LRU ordering, key derivation, freshness, and serialization invariants.
- Native tests use temporary directories and mock HTTP responses; they must never contact a live Bandcamp account.
- Boundary tests assert fixed-origin fetching, content validation, traversal rejection, atomic recovery, and credential/signed-URL absence.
- Renderer tests assert observable behavior: a cached cover appears on the first commit, Back does not flash the fallback, refresh recovers a bad entry, and Disconnect removes cached access.
- Native Computer Use QA remains required because DOM tests cannot prove image decode timing, View Transition snapshots, filesystem cleanup, or offline restart behavior.

## Out of Scope

- Caching audio streams or Radio shows.
- Persisting signed image or media URLs.
- Pre-downloading the entire library without the user's normal browsing/sync activity.
- Caching anonymous Discover, Radio, or Bandcamp Daily imagery in the first release.
- Image transcoding, responsive thumbnail generation, or quality changes before byte-cache measurements establish a need.
- A user-facing cache-size preference in the first implementation.

## Further Notes

The current session-level warm-image set should remain as the fastest path even after disk caching lands. The durable cache solves restart and repeated-network work; it should not replace the zero-I/O remount path that keeps reverse navigation smooth.
