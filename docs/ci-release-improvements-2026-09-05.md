# CI and release improvements — September 5, 2026

## Measured baseline

Timings below come from GitHub job/step timestamps for two completed main CI runs
and their releases. They predate the local workflow changes; they are not an
observed before/after speedup.

| Run                                                                                               | Overall elapsed |      Slowest job | Frontend/static work on that native job |
| ------------------------------------------------------------------------------------------------- | --------------: | ---------------: | --------------------------------------: |
| [Main CI, queue insertion fix](https://github.com/iheanyi/coda-bandcamp/actions/runs/33257147681) |         12m 12s | Windows: 12m 08s |                                  4m 04s |
| [Main CI, queue landing line](https://github.com/iheanyi/coda-bandcamp/actions/runs/33234790271)  |         12m 40s | Windows: 12m 37s |                                  5m 18s |
| [Release v0.9.0](https://github.com/iheanyi/coda-bandcamp/actions/runs/33257725784)               |          7m 22s |  Windows: 6m 27s |                   Tests already omitted |
| [Release v0.8.3](https://github.com/iheanyi/coda-bandcamp/actions/runs/33235292376)               |          7m 28s |  Windows: 6m 25s |                   Tests already omitted |

The corresponding Windows release build/upload steps took 261s and 269s. Final
verification/publication took only 23s and 22s; splitting or weakening that step
would miss the bottleneck. The separate Intel warming job spent 130s and 114s
compiling/linking, in addition to setup and cache restore.

Reproduce source data with `gh api repos/iheanyi/coda-bandcamp/actions/runs/RUN_ID/jobs --paginate`.
Durations are `completed_at - started_at`; compare whole workflows too, since
runner queue time matters.

## Implemented changes

### Run frontend validation alongside native builds

An independent three-OS frontend matrix owns frontend and automation tests.
Linux enforces coverage plus lint, TypeScript and Rust formatting; Windows and
macOS retain the complete uninstrumented frontend suite and tooling tests.
The native matrix retains Rust tests, Clippy, all bundles, Last.fm build inputs,
and its existing platform check names. Both matrices can start immediately.

The release gate requires all six frontend/native checks. Neither a green native
build nor a green frontend suite alone can authorize a release. No branch rules
were changed; live inspection found no current main protection or rulesets.

Subtracting moved work from the historical Windows job gives native-path
estimates of 484s and 439s, versus 728s and 757s. Allowing for additional job setup,
**roughly 3–5 minutes less elapsed CI time** is a reasonable hypothesis, not a
promise. The frontend jobs repeat checkout/npm installation and consume more
concurrent runner slots. Queueing and runner-minute cost need measurement on the
first actual run. No tests were removed for this optimization.

### Skip redundant Intel cache warming

The warming job compiles only when the pinned Rust cache action does not report
an exact hit. Prefix restores still compile. Main remains the cache producer for
Intel release builds, with the same target/shared key. The pinned action defines
[`cache-hit` as an exact match](https://github.com/Swatinem/rust-cache/blob/6323deb102c322ba6fcbdcafc7e3dddab59af2b6/action.yml#L66-L68).
This avoids the observed 114–130s compilation step on exact hits; setup/restore
still run. It primarily saves runner time rather than the workflow critical path.

### Prove version-only release commits

The previous fallback trusted changes restricted to five manifest filenames.
A dependency, npm script, Cargo profile or Tauri CSP edit in those files could
therefore inherit green CI from the parent without being tested itself.

The dependency-free guard now requires one parent, all five ordinary manifests,
six synchronized increasing versions, and no other semantic JSON or byte-level
TOML changes. The exact-commit green-CI fast path remains. Actual release-bump
fixtures and malicious/non-version changes exercise the guard, including merge
commits and file modes. Release tagging still follows validation.

Four release builds remain parallel. Draft ownership, the single `latest.json`
writer, seven required updater artifact/signature pairs, cryptographic signature
verification, and the final stale-release check remain intact.

## Additional improvements included for landing

- Push and PR runs now use separate per-branch/per-PR cancellation groups, so newer revisions supersede old ones without a push cancelling merge validation. Main retains unique uncancellable groups.
- A lightweight selection job skips a duplicate branch-push matrix only after confirming both an exact-revision open PR and an actual eligible PR workflow run. Missing/conflicting/stale PRs and API failures conservatively retain full push CI. Main and PR events perform no API lookup. Both matrices wait only for this selector, then run in parallel.
- Draft preparation now shares the release preparation job, eliminating its separate runner allocation, checkout action and Node setup. The release commit remains pinned, including reruns that reuse an existing version commit.
- A tested gate waits up to 20 minutes for missing/pending checks on the immutable release commit (or a proven version-only parent). Completed failures stop immediately and cannot be bypassed through parent checks. The containing job allows 25 minutes.
- Bundler cache keys now use the locked Tauri CLI version plus an explicit tool-layout revision. Unrelated React/npm dependency updates no longer create a fresh primary bundler key. CI and release builds use the same helper, and prefix restores preserve older warm caches.
- The earlier Windows playlist test failure is repaired by modeling browser scroll events in jsdom and selecting the exact playlist by accessible name. No expectation was weakened and no application behavior changed.

The Windows release build/packaging step remains the main release bottleneck.
Release optimization and LTO settings are unchanged. Preparation consolidation
removes measured 9–14s draft-job overhead, but an actual future release is required
to establish end-to-end release savings; landing CI changes does not publish a release.

## Validation

- `npm run test:automation-build`: 54 tests passed, including version-only validation, bounded release waiting, push/PR ownership, cache-key and workflow contracts.
- `npm run lint` and `npm run lint:anti-slop`: passed.
- Pinned `actionlint` v1.7.7 validated both workflows, including shellcheck. YAML parsing also passed.
- Prettier checks for edited scripts, package metadata and this report passed. `git diff --check` passed.
- The guard accepted the actual shipped `ce5c391` version bump (0.8.3 to 0.9.0).

The workflow and release-gate updates ship together because the gate requires
both frontend and native checks. The eight dialog tests passed with the corrected
scroll simulation. No release was dispatched. Actual elapsed time, queue delay
and runner cost are measured from the landing run's GitHub job timestamps and
reported separately from the projections above. No application code changed in
this pass.
