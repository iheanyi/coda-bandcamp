# GitHub Actions cache audit — 2026-09-05

Audit findings; cache configuration was not changed. All three workflows inspected: cross-platform.yml, release.yml, pages.yml. Live API inventory and usage/retention/storage limits fetched. Pinned Swatinem/rust-cache v2.9.2 and actions/setup-node v7 source inspected.

## Live inventory

12 caches, all `refs/heads/main`, 4,535,966,907 bytes (4.536 decimal GB). Configured storage limit 10 GB; retention 7 days. No current storage pressure, no extant tag/PR-scoped caches. Listing API does not expose an eviction history, so absence of older caches does not prove why they disappeared.

- Rust: four targets, 4,092,747,221 bytes. Linux 1.473 GB, Windows 1.147 GB, macOS arm64 1.011 GB, Intel-on-arm64 461 MB.
- npm: three OS/architecture cache entries, 257,536,001 bytes.
- Tauri bundler tools: four entries, 130,183,070 bytes. Two current CLI-version keys and two superseded lockfile-hash keys (~65 MB).
- apt: one Ubuntu 22 runner-image cache, 55,500,615 bytes.
- No extant Pages-specific npm cache or publish minisign cache.

## Concrete findings

### P2 — Every release version bump makes npm cache miss even without dependency changes

Locations: release.yml:195–199; cross-platform.yml:59–63 and 117–121; pages.yml:30–35. Pinned setup-node hashes the entire lockfile and, for npm, restores only the exact key (src/cache-restore.ts:32–61). prepare-release changes root version fields in package-lock.json, so each new version loses access to the preceding dependency download cache despite identical packages. Unlike Rust's manifest normalization, npm has no version-only normalization or prefix fallback.

Recommendation: use an explicit npm tarball-cache restore with exact OS/architecture/lock hash primary key and an OS/architecture/npm prefix fallback; continue `npm ci` with lockfile integrity verification. Save from a designated main-branch producer. This also permits release tags to consume main's prior-version cache. Do not cache node_modules. Benefit is avoided package downloads and redundant ~77–104 MB cache uploads on misses; actual npm ci savings require measurement. Cold Windows npm ci was 26s in b76 versus 23s in c80, so this is smaller than Rust compilation.

### P2 — Generic caches still create disposable branch/tag copies

Locations: release.yml:219–231,242–247,425–429; cross-platform.yml:140–154,168–173. These use combined actions/cache restore/save without restricting saves. Rust already uses `save-if: main`. Release tag misses for bundler tools, apt, and minisign create caches inaccessible to later tags. CI branch/PR generic cache misses similarly save to their isolated refs. Current inventory has none; this is a proven configuration opportunity, not claimed current pollution.

Recommendation: split restore/save and save only from trusted main-branch producers. Release tag jobs should restore only; manual main releases may save. For publish-only minisign there is no normal CI producer, so either keep main-dispatch production, or skip that tiny download cache and retain baked apt-index fast path. Do not introduce a whole warming job for a ~100 KB package.

### P2 — Multiple npm producers repeat compression after a cold miss

Locations: cross-platform.yml:63,121. Frontend and native jobs on each OS restore the same npm key independently and both can save. On b76 Windows native spent 20s in setup-node post, then lost a reservation race; another run had already saved the key. A single npm producer per platform would eliminate these losing saves while retaining parallel restore/build. Requires explicit restore/save control because pinned setup-node exposes no restore-only option.

Main runs intentionally overlap (cross-platform.yml:11–16) to preserve exact release checks. Do not serialize all main CI simply to prevent occasional cache races: that trades developer latency for cache warmth.

### P3 — Superseded bundler keys occupy ~65 MB

Inventory shows old package-lock-keyed Linux and Windows bundler caches alongside new CLI-version keys. They are unused by current YAML and can expire naturally under the seven-day policy. Optional targeted cleanup only; no broad purge and no performance claim.

### P3 — Rust cache generation size warrants observation, not immediate expansion

Four target caches total 4.093 GB. Two complete manifest/toolchain generations could use ~8.2 GB plus smaller caches; a third would exceed current 10 GB. New crate-type/profile changes are correctly hashed and can create a new generation. Current usage is below half the limit; no evidence warrants paying for more storage now. Observe cache hit/miss and usage after dependency/toolchain churn; prune demonstrably superseded entries if actual eviction pressure appears.

## Verified healthy behavior

- Rust keys share target family between CI/release/Intel producer, include Rust version/host/environment and whole parsed Cargo manifests plus registry lock data. Package version and local path versions are normalized; `[lib].crate-type`, profiles, and dependency features remain hashed. Version-only release bumps therefore reuse Rust cache; artifact-shape changes correctly produce a new exact key. Prefix fallback can seed the new generation, which is then saved on main.
- Rust source/workspace crates are intentionally excluded from dependency cache; Coda rebuilds with current source/assets. No recommendation to cache signed releases, credentials, or complete stale Coda outputs.
- Intel warming runs only on main; exact hits skip compilation. Observed 122s prior job to 32s after fix, with 94s compilation removed.
- Tauri tools use locked CLI-version revision with OS and no broad incompatible fallback. CI and release agree. Current Windows/Linux architectures are x64 so no cross-architecture ambiguity today.
- apt cache keys include actual promoted runner ImageOS/ImageVersion and package-set revision. CI and Linux release use same Ubuntu 22 producer/consumer layout; publish uses Ubuntu 24 and separate minisign suffix. apt verifies package hashes against indexes. Existing exact-hit entries cannot gain later downloads; runner-image churn refreshes generation, but this is only ~55 MB and no measured persistent slowdown.
- Pages correctly points npm key at website/package-lock.json; it does not mistakenly hash only the desktop lockfile. Pages artifact upload is an artifact, not a dependency cache.
- Cache refs respect GitHub isolation; no current default-branch cache poisoning issue found in these workflows. Actions are pinned.

## Cold versus warm evidence

The b76 Windows miss was an overlap, not bad keys: exact Rust key matched preceding e7 run. b76 restore at 20:03:23 preceded e7's 1.147 GB upload completion at 20:04:38. b76's later save conflict was expected once e7 populated the key.

c80 restored that Rust cache successfully and compiled only Coda:

- Rust release compilation: cold 8m08s, warm 3m17s.
- Entire installer step: cold 8m44s, warm 3m44s.
- Entire CI: cold 18m35s, warm 7m07s.
- Tests: cold compiler 4m32s, warm compiler 1m01s. Clippy: 2m33s to 9.37s.

These show cache effectiveness. They do not isolate linker durations or predict future exact timings.

## Sources and evidence files

- GitHub cache reference: https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching
- Live limit endpoints: https://docs.github.com/en/rest/actions/cache
- Pinned Rust manifest hashing: https://github.com/Swatinem/rust-cache/blob/6323deb102c322ba6fcbdcafc7e3dddab59af2b6/src/config.ts#L175-L209
- Pinned npm restore: https://github.com/actions/setup-node/blob/820762786026740c76f36085b0efc47a31fe5020/src/cache-restore.ts#L32-L61
- Local inventory: /tmp/coda-cache-flat.json; usage /tmp/coda-cache-usage.json
- Warm logs: /tmp/coda-perf-warm-windows-log.txt; cold logs /tmp/coda-perf-windows-log.txt; prior producer /tmp/coda-perf-prior-windows.txt

## Platform build and release size audit

Read-only investigation of warm CI run [33989955840](https://github.com/iheanyi/coda-bandcamp/actions/runs/33989955840), commit c80f8f5. All listed jobs succeeded. These are warm-cache CI builds, not cold build timings or release-publishing timings.

| Platform    | Rust release compiler report | Native job elapsed | Tauri build/package/upload step |
| ----------- | ---------------------------: | -----------------: | ------------------------------: |
| Windows x64 |         3m17s (compiler log) |              6m58s |                           3m44s |
| macOS ARM64 |                        2m39s |              5m16s |                           3m24s |
| Linux x64   |                        1m40s |              5m18s |                           3m33s |

Intel cache warming took 20 seconds and skipped compilation on an exact hit. That is not an Intel build measurement. Frontend jobs ran in parallel: Windows 4m51s, macOS 3m59s, Linux 3m42s.

Linux packaging remains material: compiler finished at 20:26:59.831 UTC; all three bundles finished at 20:28:46.040 UTC, about 106 seconds later. AppImage bundling began at 20:27:05.612. The macOS ARM compiler finished at 20:28:05.859; bundles finished at 20:28:41.196, about 35 seconds later. Compiler optimizations will not remove these package costs.

## Published v0.9.0 sizes

[Release v0.9.0](https://github.com/iheanyi/coda-bandcamp/releases/tag/v0.9.0) was published August 29, 2026. These predate current work, so they are context, not a before/after size comparison. Units are MiB (1,048,576 bytes).

| Platform/package       | Published download |               Raw executable |
| ---------------------- | -----------------: | ---------------------------: |
| Windows NSIS installer |           3.01 MiB |                Not inspected |
| Windows MSI            |           4.07 MiB |                Not inspected |
| macOS ARM DMG          |           4.38 MiB |  9.95 MiB (10,431,888 bytes) |
| macOS Intel DMG        |           4.78 MiB | 11.56 MiB (12,124,992 bytes) |
| Linux deb              |           5.06 MiB |                Not inspected |
| Linux rpm              |           5.07 MiB |                Not inspected |
| Linux AppImage         |          78.98 MiB |                Not inspected |

Raw macOS executable sizes were read from tar archive member metadata, without extracting or running executables. The ARM updater archive is 4.41 MiB; Intel is 4.80 MiB. Do not compare the compressed DMG or AppImage directly with the raw Rust executable. AppImage's self-contained distribution packaging accounts for a different payload than system-package formats; its exact bundled-library breakdown was not downloaded or inspected.

## Dependency observations

- The Windows resolved graph builds both AWS-LC (Coda's Reqwest `rustls` feature) and ring (the updater's `rustls-tls`). Sharing one explicitly installed provider is a concrete candidate for build and binary measurements. It requires client initialization coverage and preserved certificate verification; it is not a safe feature-only switch.
- Direct Rand 0.8 coexists with governor's Rand 0.9. Updating the small direct call surface could remove the old Rand/ChaCha/core versions. Expected effect is modest and unmeasured.
- Multiple windows-sys versions are imposed by Tauri/plugin/keyring transitive constraints. Forcing version consolidation would be inappropriate.
- Desktop extra staticlib/cdylib outputs are unused by repo consumers and are independently being benchmarked by the primary agent. Removing these outputs can reduce build work and intermediate artifacts; it does not by itself establish a smaller shipped executable.

Evidence: `/tmp/coda-perf-warm.json`, `/tmp/coda-platform-job-101370317985.log`, `/tmp/coda-platform-job-101370318018.log`, `/tmp/coda-platform-release.json`, and `/tmp/coda-platform-release-size-audit/`. No repository changes were made.
