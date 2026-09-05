# Frontend audit — September 5, 2026

This is a targeted source audit across the frontend subsystems below, plus a measured
queue projection change. It is not a claim that every frontend file or native
interaction has been tested. The earlier browse memoization, playlist search, and
test-pruning work remain separate changes in the same working tree.

## Ranked findings

### P2 — Entire public queue metadata was cloned on structural updates (implemented)

`src/features/playback-runtime/core.ts:661` projected every queue item whenever the
private queue array changed. `publicQueue.ts:23` clones display metadata, palettes,
Radio chapters, and Discover release metadata while stripping playable streams.
Appending, reordering, clearing, or replacing one track therefore recreated every
remaining public track, even when their private Track objects were unchanged.
This also changed the public current-track identity on unrelated queue edits.

The controller now owns a WeakMap-backed projector (`publicQueue.ts:49`). Unchanged
immutable Track objects reuse their safe projection; replacement objects always
produce fresh metadata, including replacements with the same ID. Track objects
that are no longer retained are eligible for garbage collection along with their
projection. This does not add a second server cache or retain a strong history of
removed queues. Existing stream stripping is unchanged.

This relies on the existing immutable queue/Track update contract. Public metadata
must also be treated as immutable. The first projection costs more because it
populates the WeakMap; the table below reports that cost explicitly.

### P2 — A playlist refresh failure hides usable cached targets (follow-up)

`src/features/saved-library/AddToPlaylistDialog.tsx:268` chooses the error screen
before checking retained playlist data. A background refetch can fail while
TanStack Query retains a usable list, yet the dialog then removes those selectable
targets. Render cached targets with a refresh warning/retry action, reserving the
blocking error screen for a first load with no data. This finding comes from branch
inspection; a failed-background-refresh regression and native reproduction remain
to be added before implementing it.

### P2 — Every cover revision wakes every artwork subscriber (follow-up)

`src/coverArtSourceStore.ts:373` broadcasts any changed cover revision to all
subscribers. `src/coverArtSource.ts:46` uses that global subscription per mounted
cover. Each snapshot check reconstructs a URL and validates the identifier twice
through `source`/`revisionFor` (`coverArtSourceStore.ts:526`). React suppresses
unchanged snapshot renders, but it does not avoid these checks. With N visible
covers and N incoming revision events this can generate quadratic snapshot work.
Measure a real first-paint/refresh event burst, then consider subscriptions scoped
to cover ID with a separate all-covers clear notification. Preserve ordering floors,
retry generations, and Strict Mode listener teardown; removing those safeguards
would be an invalid simplification. No speedup is claimed for this unimplemented item.

### P3 — Duplicate queue requests still report successful additions (follow-up)

`src/queue.ts:27` correctly drops existing IDs, but always returns a fresh array,
even when every requested track already exists. The wrappers in `src/App.tsx:258`
and `:267` unconditionally announce the requested count/title as added. Return an
unchanged queue for a no-op and expose the actual added count to notification code.
Cover zero, partial, and complete additions together; preserve deliberate duplicate
semantics for operations other than appendUnique. This would avoid redundant
structural updates and make feedback accurate. Not changed in this audit.

### P3 — Paused sessions enqueue identical checkpoints (follow-up)

`src/features/playback-runtime/persistence.ts:262` runs a checkpoint every five
seconds whenever the runtime is ready, including when paused. It also checkpoints
on transition to paused. `preparePlayerCheckpoint` has no unchanged-value guard;
the serial writer (`:166`) has no queue bound or supersession policy. On a stalled
adapter, repeated ticks can accumulate pending closures. Consider coalescing
unchanged/pending checkpoints while preserving structural-write ordering, explicit
seeks, disconnect clears, and at-most-once scrobble progress. Native deduplication
and actual disk-write cost were not measured here, so this is an IPC/scheduling
opportunity rather than a claim of repeated disk writes.

### P3 — Anonymous infinite queries have no retained-page bound (follow-up)

`src/queries/discoverQueries.ts:6`, `dailyQueries.ts:11`, and
`radioQueries.ts:44` retain every fetched page for an active key. Virtualized grids
bound DOM nodes, but not cached metadata; switching filters also retains prior
queries under the root client's 30-minute gcTime (`src/main.tsx:38`). The visible
load-more action bounds request rate, not session memory. Profile a long browse
session before selecting a retention budget. Simply dropping old pages can break
Back/scroll restoration and should not be done without a corresponding UX design.

### P3 — Stream cache stores an unused resolved value (simplification follow-up)

`src/data-bridge/streamUrls.ts:6` stores both the resolved Promise and `value`, but
the repository only reads the Promise. Removing `value` and its success handler
would remove unused bookkeeping without changing LRU, expiry, request deduplication,
or rejected-request eviction. This is a small cleanup, not a material speed claim.

## Measurement of the implemented queue change

Run `node tools/benchmark-public-queue.mjs`. It compares the unchanged previous
`publicPlaybackQueueTrack` mapping with the new projector, validates equivalent
output and absent streams, uses five warmups and 21 measured samples, and alternates
measurement order. Synthetic ordinary tracks only; Node v26.5.0, Apple M1 Max.
All durations are median milliseconds for one queue projection. Final samples
were taken after this audit's Rust tests and Clippy completed, before the next
frontend run. Unrelated host workload was not controlled; these are measurements,
not stable performance budgets.

| Tracks | Operation        | Before |  After | Result        |
| -----: | ---------------- | -----: | -----: | ------------- |
|    500 | First projection |  0.105 |  0.136 | +0.031 ms     |
|    500 | Reorder          |  0.117 |  0.011 | 10.94× faster |
|    500 | Replace one      |  0.097 |  0.010 | 9.91× faster  |
|  5,000 | First projection |  1.129 |  1.365 | +0.236 ms     |
|  5,000 | Reorder          |  1.104 |  0.179 | 6.18× faster  |
|  5,000 | Replace one      |  1.002 |  0.131 | 7.63× faster  |
| 25,000 | First projection |  6.067 | 11.622 | +5.555 ms     |
| 25,000 | Reorder          |  5.293 |  1.589 | 3.33× faster  |
| 25,000 | Replace one      |  5.703 |  1.330 | 4.29× faster  |

At 25,000 tracks, reorder creates zero new track/palette projections instead of
25,000; replacing one creates one. Both paths still allocate/traverse the queue
array in O(N). The benchmark excludes React, DOM painting, native IPC, persistence,
and GC-retention measurements. These are not end-to-end desktop speedups or an
improvement to cold startup. Native queue interactions remain part of final
integration verification.

## Scope inspected and safeguards retained

| Area                                 | Files examined                                                                                                                                          | Assessment                                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App composition/startup              | `src/App.tsx`, `main.tsx`, `router.tsx`, `routes/__root.tsx`                                                                                            | App is 460 lines of controller composition; do not assume the historical monolithic App architecture still exists. Startup creates the router without awaiting credentials.                                   |
| Playback state/audio/public boundary | `features/playback-runtime/core.ts`, `publicQueue.ts`, `types.ts`, `audio.tsx` runtime contracts and nearest runtime tests                              | Queue mutation uses immutable replacement; signed streams remain private. Public projection was the implemented hotspot.                                                                                      |
| Playback clock/persistence/media     | `playbackClock.ts`, playback-runtime `persistence.ts`, `systemMedia.ts`, `playerState.ts` checkpoint contracts                                          | Media clock publishes whole-second updates, explicit seeks remain immediate, full saves are debounced separately from checkpoints, native timeline updates are throttled. Preserve these.                     |
| Queue presentation/helpers           | `queue.ts`, `NowPlayingUpNext.tsx`, `TrackQueueList.tsx`, `VirtualizedQueueList.tsx`, `features/queue/QueuePanel.tsx`                                   | Queue rows are virtualized, hidden drawer avoids an upcoming slice, Up Next slices only four entries. No reason to replace these with another virtualization/cache layer.                                     |
| Navigation                           | `features/navigation/useCodaNavigationController.ts`, `useDetailNavigation.ts`, `routeCommit.ts`                                                        | Detail navigation is substantial, but render acknowledgements, bounded five-second commits, directional motion, and focus restoration express actual product contracts. No evidence-backed deletion proposed. |
| Queries/native boundary              | `queries/{anonymousFeed,discoverQueries,dailyQueries,radioQueries,savedLibraryQueries}.ts`, `data-bridge/{library,hydration,streamUrls,runtimeData}.ts` | Query keys isolate anonymous domains; native album/track payload bounds remain explicit; stream cache bounds and failure eviction are present.                                                                |
| Artwork                              | `coverArtSource.ts`, `coverArtSourceStore.ts`                                                                                                           | Revision persistence is already batched. Global subscriber fan-out is a remaining measurement candidate; floor/revision state protects correctness.                                                           |
| Lazy feature surfaces                | `DiscoverView.tsx`, `features/radio/RadioArchiveScreen.tsx`, library `LibraryResults.tsx`, settings `PersistentAppOverlays.tsx`, saved-library dialog   | Discover/Radio lists derive cached pages and use virtualized grids; album/artist grids, queue list, and dialog have lazy boundaries. Playlist search from the earlier pass remains.                           |

## Focused verification

- `npx vitest run src/features/playback-runtime/publicQueue.test.ts src/features/playback-runtime/PlaybackRuntime.test.tsx` — 20 tests passed.
- New coverage checks append/reorder identity reuse, same-ID replacement freshness,
  separate-runtime isolation, stream stripping, and independent nested metadata.
- Existing runtime regression additionally checks Now Playing identity survives
  clearing upcoming entries while preserving its playback/persistence assertions.
- Full frontend/build/native verification is owned by the integrating agent.

No dependencies, capabilities, CSP rules, credential flows, or network endpoints
were changed. The Android WebView login investigation remains discussion only.
