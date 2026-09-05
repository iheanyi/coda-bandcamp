# Rust network and domain audit — September 5, 2026

## Scope inspected

Reviewed HTTP scheduling/retry/body reading and redirect policy in `bandcamp_http.rs`; request authentication, mutation handling, XML/JSON parsing and metadata validation in `subsonic.rs`; library pagination, generation guards, connection lifecycle and album response hydration in `library.rs`; all command paths in `playlists.rs` and `favorites.rs`; anonymous request/response handling in `discover.rs`, `radio.rs` and `daily.rs`; Last.fm session handling, signing, requests and retry policy in `lastfm.rs`; and `validation.rs`/`url_policy.rs`. Inspected the nearest protocol/domain tests, including `tests/library_network.rs`. Cache/storage implementation ownership and native media/window ownership were audited separately.

## Ranked findings

### 1. Fixed: Favorites retained every complete album until the last request finished

`favorites.rs:254–313` now drains each completed album from the six-request stream and immediately keeps only requested favorite records. Previously `collect::<Vec<_>>()` retained all complete albums before reconciliation began. A user requesting one favorite from each of many albums caused all the other tracks to remain resident for the duration of the entire refresh. Each response was bounded, but those per-response bounds did not bound aggregate retention effectively.

The accumulator now holds reconciled output plus the bounded active request batch. It also borrows the one loaded credential pair instead of cloning it for every album. Logging retains operation, status, counts and elapsed time only; no credentials, identifiers, URLs or music metadata are added.

### 2. Fixed: disconnected Favorites refresh kept starting queued album requests

`favorites.rs:268–301,345–355` checks the captured connection generation before starting an album request and when each result completes. A stale refresh returns a safe error and drops its remaining futures, rather than finishing up to 5,000 queued requests before final artwork authorization rejects the result. Existing network errors remain partial reconciliation results; a failed album never implicitly unstars its requested tracks.

Cancellation is checked at request/batch boundaries. It is not an interrupt signal for a currently awaited HTTP attempt: observing a disconnect can still wait for an active response or its existing timeout/retry path. A generation notification integrated with the common scheduler would be a separate improvement.

### 3. Follow-up: Daily malformed markup can repeatedly scan the same suffix

`daily.rs:389–438` searches for a matching closing element from each candidate opening tag. `elements_with_class` bounds successful results, not unsuccessful candidate searches. Repeated unclosed matching elements can therefore cause quadratic work within the bounded HTML response. The parser runs off the async executor, which protects its event loop, but does not bound total CPU consumed by malformed markup. This is a source-level finding; no production incident or measured exploitability is claimed. Add a malformed-markup fixture and a shared scanning/work budget before changing parser behavior. Replacing the entire parser without preserving strict URL/identity rules would be unnecessarily broad.

### 4. Follow-up: optional Radio correction blocks an otherwise usable first page

`radio.rs:442–458` awaits the fallback archive request for series with a known metadata correction even after the primary page succeeds. This secondary request uses the ordinary retry policy and can delay displaying already usable episodes. A separate cached or background supplement could preserve the correction without delaying the first page; any change needs a UI merge/error contract and tests. No latency measurement was made, so this remains a verified call-path observation rather than a measured speedup claim.

## Quantified retention change

For an explicit realistic workload model of 1,000 albums × 20 returned tracks, requesting one starred track per album:

| Quantity                                                       |                           Before |                                              After |
| -------------------------------------------------------------- | -------------------------------: | -------------------------------------------------: |
| Complete track records retained pending end-of-batch filtering |                           20,000 | At most the six active album results (120 records) |
| Final requested records                                        |                            1,000 |                                              1,000 |
| Conservative combined live-record allowance                    | At least 20,000 before filtering |    1,120 (1,000 outputs + 6 × 20 incoming records) |

That model reduces the retained-record allowance by 94.4%. These are structural counts calculated from the workload and concurrency cap, not measured RSS or allocator peaks. Native response-byte buffers, parsing temporaries, string lengths and allocator behavior are outside those counts. No end-to-end speedup is claimed: request rate remains two per second, concurrency remains six, and network latency is unchanged. Existing elapsed-time tracing remains available for live comparison without exposing account data.

## Tests and simplification

Added three deterministic, network-free coordinator regressions: mixed starred/unstarred/missing/failed responses preserve correct partial output; stale connections stop queued work; and six pending request futures are all dropped on disconnect. All ten Favorites tests passed with `cargo test --manifest-path src-tauri/Cargo.toml tests::favorites -- --test-threads=1`.

Removed one redundant `parses_flexible_numeric_fields` helper test from `tests/subsonic.rs`. `tests/playlists.rs:38–58` already parses a real playlist response containing a string duration and asserts the resulting track duration, providing stronger coverage of the same behavior. No validation, sanitization, mutation, or protocol fallback coverage was removed.

The first focused compile encountered another concurrent edit using an unavailable Tokio macro; the owning agent fixed it, and the rerun passed. Final cross-layer checks belong to the integrated matrix.

## Boundaries retained

- Shared HTTPS client, host-restricted redirects, response-byte limits and blocking JSON parsing.
- Fixed mutation endpoints and bounded POST forms; no automatic mutation retries.
- Anonymous Discover/Radio/Daily requests remain separate from authenticated credentials.
- Native metadata validation and safe errors remain in place.
- Last.fm scrobbles remain non-retryable; only idempotent Now Playing writes retry.
- No dependencies, capabilities, credential storage, CSP, or native platform behavior changed.
