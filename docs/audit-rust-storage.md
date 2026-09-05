# Rust storage and cache audit — 2026-09-05

Scope: `album_cache.rs`, `library_cache.rs`, `player_state.rs`, `storage.rs`, and
`cover_cache/{mod,store,fetch,protocol,diagnostics}.rs`. Inspected filesystem paths,
serialization, cache limits, lock ownership, async/blocking boundaries, and nearby
cache/player tests. Network policy and image-container parsing were traced only
where they intersect storage; the separate network audit owns those contracts.

## Changes implemented

### P1: Cached artwork filesystem work ran on async executor workers

`resolve_cover_art_from_state` called `read_authorized_cached_cover` synchronously
at its first lookup and again after taking the per-key async lock. That helper
performs filesystem metadata/open/read through `read_cached_bytes`, including up
to 5 MiB per image. Its corrupt-file path can also rewrite the durable index.
Concurrent warm artwork requests could therefore occupy async workers with disk
work even though cache publication already used the blocking pool.

Both lookups now await the helper, which moves its complete existing operation
into `spawn_blocking`. Authorization is still checked inside the lookup, serving
leases still cover the byte read, and corrupt-entry invalidation retains its
ordered cleanup behavior. The existing per-key deduplication check remains.

Evidence: `src-tauri/src/cover_cache/fetch.rs:561` and `:605`;
`src-tauri/src/cover_cache/store.rs:414`. The new scheduling regression runs a
single-thread Tokio executor while another thread holds the storage mutex. The
lookup must return Pending before the executor releases storage. It uses a
five-second watchdog to prevent deadlock, not a timing threshold for success.
Existing warm-hit, miss, unauthorized-access, publication-race, and recovery tests
also pass. This establishes executor yielding; no native latency number is claimed.

### P2: Under-budget cache inserts still cloned and sorted eviction candidates

`select_evictions` summed stored bytes, then cloned every eligible key and sorted
all candidates before checking whether any eviction was necessary. Every fresh
image publication uses this helper while holding the runtime mutex. For a cache
under its byte and entry limits, all of that candidate work was discarded.

It now returns an empty eviction list immediately after accounting for the incoming
image and any replaced image when both limits already fit. The needed-eviction
algorithm, deterministic ties, and serving-lease exclusions are unchanged.

Evidence: `src-tauri/src/cover_cache/store.rs:499`; caller
`src-tauri/src/cover_cache/fetch.rs:402`. A new boundary test covers replacement at
the entry limit, insertion over that limit, exact byte capacity, byte overflow
with all candidates leased, and replacement accounting. The existing LRU tie and
lease test remains.

Reproduce:

```sh
node tools/benchmark-cover-evictions.mjs
```

The script extracts the actual baseline and current helper bodies, compiles them
with `rustc -O`, and compares matching synthetic BTreeMaps/HashMaps. Its minimal
entry structs include only fields read by the helper; this is a selection
microbenchmark, not the entire production cache layout or disk pipeline. The
baseline defaults to `427900109b547ccc9ae04aac11468da9c4b72bab`; a Git ref can be
passed explicitly. It checks result equality, alternates execution order, warms
up five samples, and reports median microseconds across fifteen samples of 100
calls. Generated Rust and executable artifacts use a unique temporary directory
and are cleaned up afterward.

Apple M1 Max, macOS arm64, rustc 1.97.1; final rerun after this audit's Rust
test/Clippy work completed:

| Entries | Operation                 | Before µs | After µs | Speedup |
| ------- | ------------------------- | --------: | -------: | ------: |
| 500     | Insert                    |    24.190 |    0.734 |  32.95x |
| 500     | Replace                   |    24.001 |    0.678 |  35.40x |
| 4,999   | Insert                    |   269.431 |    6.301 |  42.76x |
| 4,999   | Replace                   |   266.445 |    6.069 |  43.90x |
| 5,000   | Insert requiring eviction |   263.078 |  268.093 |   0.98x |
| 5,000   | Replace                   |   260.894 |    6.076 |  42.94x |

The full-cache insertion control is effectively unchanged. Under-budget selection
remains O(n) for the byte sum; the improvement removes key allocations and O(n log
n) sorting. These numbers do not include filesystem writes, fsync, network,
painting, or total native artwork latency. They should not be presented as an
application-wide speedup.

## Prioritized remaining findings

### P1: Lightweight checkpoints still read and parse the entire persisted queue

`checkpoint_player_state` calls `load_player_state_or_clear_invalid` while holding
`PLAYER_STATE_LOCK`, then uses only the current track identity and persistence
generation. That read loads up to 32 MiB of JSON and deserializes/validates up to
25,000 tracks. The frontend schedules checkpoints every **five seconds**, with
additional pause/scrobble triggers. Full saves also reread the prior snapshot in
`next_player_persistence_generation`, and validate the new state twice.

Evidence: `src-tauri/src/player_state.rs:712` and `:723`; read/validation path
`:381`; generation lookup `:462`; save `:677`;
`src/features/playback-runtime/persistence.ts:25`, `:224`, and `:263`.

The checkpoint write is small, but its preparation is O(queue size), allocates the
full queue, and serializes other player persistence behind it. This is a confirmed
call-path finding; disk/CPU cost has not been benchmarked. Do not remove the
generation/track checks. A follow-up should maintain minimal authoritative
snapshot identity under the same lock, initialize it from a validated read, update
only after successful atomic full writes, and invalidate it on clear/failure as
appropriate. Test restart, stale same-track checkpoints, failed writes, and
external corruption semantics before shipping that change.

### P2: Cover index durability holds the shared runtime mutex

`flush_accesses` validates/serializes the full index and writes/fsyncs it while
holding `runtime`. Publication also writes image bytes and the index under this
mutex. Moving reads to the blocking pool does not eliminate all contention:
authorization, touches, and diagnostics still acquire this mutex synchronously.

Evidence: `src-tauri/src/cover_cache/store.rs:459`;
`src-tauri/src/cover_cache/fetch.rs:357` and `:432`;
`src-tauri/src/cover_cache/mod.rs:280`;
`src-tauri/src/cover_cache/diagnostics.rs:22`.

The existing 30-second/128-touch batching is valuable. Measure lock wait during
large-index publication before splitting index snapshots from durable writes.
Such a change needs version/order checks so a delayed flush cannot overwrite a
newer publication or recreate cleared data. Deferred; no measured contention claim.

### P2: Album-cache capacity pressure causes repeated full payload decoding

Once the redb table exceeds 256 entries or 32 MiB, every write scans existing
entries and deserializes/validates full track payloads just to obtain age and byte
weights. Normal growth beyond 256 albums can repeat this for each new album,
under the global write lock. This is bounded but unnecessarily expensive at
capacity. The current guards correctly prevent stale refreshes or connections
from committing and prevent stale reads from deleting newer entries.

Evidence: `src-tauri/src/album_cache.rs:611`, `:668`, and `:684`.

A compact metadata index could reduce decoding, but adds a consistency contract
and is not justified without a capacity-pressure benchmark. Retain corruption,
TTL, concurrent refresh, and generation tests. Deferred and unmeasured.

### P3: Snapshot writers make avoidable metadata clones

`write_library_cache` clones the entire album slice into an owned snapshot before
serializing it; album-cache writes similarly clone tracks. A borrowed serialization
shape could eliminate these copies. This occurs during background persistence,
not per audio tick, and current bounds limit the damage. Do not add a generic
persistence framework for this small opportunity.

Evidence: `src-tauri/src/library_cache.rs:115`;
`src-tauri/src/album_cache.rs:640`. Deferred and unmeasured.

## Contracts retained and test assessment

- Atomic storage writes use exclusive temporary creation, write/fsync, rename,
  and parent-directory synchronization on Unix; Windows retains its explicit
  write-through replacement path. Removing durability is not a performance fix.
- Library/player readers bound input before JSON parsing and distinguish
  discardable corruption from operational errors. Those tests prevent data loss
  and should remain.
- Player snapshots preserve generation-safe checkpoints, at-most-once pending
  scrobble restoration, and bounded stripped metadata. Their failure and
  stale-generation tests provide value and were retained.
- Album-cache reads enforce TTL and identity; writes recheck generations before
  commit. Redb initialization checks corrupt/truncated layouts before opening.
  The stale-prune and transaction-race regressions were retained.
- Cover cache maintains 5,000 entries/256 MiB, bounded image/index reads, symlink
  rejection, fail-closed cleanup markers, and lease-aware eviction. Existing
  authorization and recovery tests were retained. Two targeted regressions were
  added for the changed behavior; no security/storage tests were pruned merely
  because they were detailed.

## Verification

`cargo test --manifest-path src-tauri/Cargo.toml cover_cache --lib`: **32 passed**.
The sandbox initially blocked three existing loopback HTTP fixtures; the same
focused run outside the sandbox passed all tests. Changed Rust files were
formatted with rustfmt. The coordinating agent owns the final cargo
fmt/test/clippy matrix and native smoke testing. No capability, credential,
network allowlist, persisted schema, or cache-limit changes were made.
