# Test suite simplification

## September 5, 2026

Removed 11 low-value tests across two deleted files and one reduced suite:

| Suite                          | Before | After | Reason                                                                                                                                                                                            |
| ------------------------------ | -----: | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `viewTransitionStyles.test.ts` |      8 |     0 | CSS source regexes pinned selector spelling, declaration order, and animation literals. They did not render a transition or prove clickability, clipping, compositor behavior, or reduced motion. |
| `App.bridge.test.ts`           |      1 |     0 | Only tested the mock harness's own unknown-command error. The harness still rejects unexpected commands in every App integration test.                                                            |
| `LibraryScreenChrome.test.tsx` |      9 |     7 | Removed a copied spring configuration assertion and a reduced-motion test that merely found an indicator. Neither established actual animation behavior.                                          |

`CodaDevtools.test.tsx` retains its test that Router and Query inspectors receive the actual application instances. Removed the duplicate literal configuration assertion so changing panel placement does not require editing a second copy of the configuration.

Behavioral navigation, keyboard interaction, rapid selection, scoped shuffle, accessibility, virtualization, bounded queue, playback, persistence, signed-URL sanitization, native validation, and mutation rollback tests remain. Reduced-motion bypass behavior remains covered in `viewTransitions.test.ts`; selection behavior remains covered in `selectionMotion.test.tsx` and `ScrollableSelectionRail.test.tsx`. These DOM tests cannot prove the visual appearance of native transitions; those still need desktop inspection.

## Test harness idle time

The shared setup previously delayed every test file by 175 ms to let TanStack Virtual's pending 150 ms scroll debounce settle before jsdom teardown. The wait is now conditional on a captured scroll event in that file. Files that dispatch any scroll retain the full conservative delay. A capture listener observes non-bubbling scroll events and is removed at teardown.

This removes 175 ms of intentional idle time per file without scroll, or 1.4 seconds across the eight-file, 25-test utility sample below. This is a deterministic reduction in requested timer waits, not a claim that parallel full-suite wall time improves by that sum. Library-owned debounce cleanup is unchanged; the existing workaround is retained for files that can trigger it.

Sample command (run with one worker before and after):

```sh
npx vitest run src/formatting.test.ts src/random.test.ts src/formatError.test.ts src/libraryDates.test.ts src/radioIdentity.test.ts src/radioSeries.test.ts src/routing/linkActivation.test.ts src/routing/tryParseRouteId.test.ts --maxWorkers=1 --reporter=json
```

Both utility runs passed all 25 tests. The JSON-reported span from suite start to the final test result was 20.344 seconds before and 26.451 seconds after. Other agents were running the full suite and builds concurrently, so these elapsed values are not a controlled speed comparison and do not establish an overall speedup. The removed 1.4 seconds of requested waits is the bounded improvement established here.

Verification:

- Seven focused suites passed: 76 tests covering Chrome, Devtools, all three virtualized lists/grids, selection rails, and View Transitions. No unhandled timer errors were reported.
- The utility sample passed 25 tests before and 25 after.
- Formatting was applied to edited tests; unrelated setup formatting was restored. `git diff --check` passed.
- Integrated verification: `npx vitest run --coverage --dir src --maxWorkers=2` passed all 180 files / 1,217 tests with no unhandled errors. Coverage: statements 87.29%, branches 81.42%, functions 87.20%, lines 89.67%.
- `npm run test:anti-slop` passed 102 tests as part of the initial `npm test` run. `npm run test:automation-build` passed 29 tests. `npm run build` passed (with the existing large-chunk advisory).
- The initial `npm test` file discovery raced the two deletions: all executed tests passed, but the removed paths were reported missing. Subsequent concurrent `npm test`/coverage runs experienced timing failures and were stopped. The complete coverage rerun above used two workers and passed without raising timeouts or deleting failures.

The accompanying changes add two behavioral scenarios (catalog memo invalidation and playlist search), for a net reduction of nine tests. Existing large-playlist coverage was extended rather than duplicated.

Native macOS verification exercised playlist no-match feedback, clearing with focus restoration, dialog dismissal back to its trigger, and collection genre filtering/reset. The development app initially showed a blank window while its renderer server was unavailable; starting a persistent server and restarting Coda Dev recovered the existing collection. This was environment recovery, not an application-code fix. Windows/Linux native behavior was not exercised. No credential, network capability, or CSP changes were made.

## Additional pruning before publishing

A second pass removed **15 more executed frontend tests**, taking the suite from
1,219 to 1,204. These removals are based on what the assertions prove, not a target
count or a desire to hide failures.

| Suite                                 | Removed | Reason                                                                                                                                                                                                                                       |
| ------------------------------------- | ------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `detailTransitionDescriptors.test.ts` |       4 | Copies of constant registration, route/focus, DOM-selector, and option tables. Retained executable open/close resolution, symmetry, queue-dependent behavior, and derived selector checks; navigation integration suites exercise consumers. |
| `ItemInteractions.test.tsx`           |       2 | Wrapper slot/class assertions did not establish pointer behavior or layout. Retained playback click and accessible toggle behavior.                                                                                                          |
| `motionProfile.test.ts`               |       1 | Copied built-in preset display names. Validation, persistence, immutable snapshots, and preset interactions remain.                                                                                                                          |
| `lib.test.ts`                         |       1 | Function-identity checks for barrel re-exports. Actual command behavior and connection cache cleanup remain.                                                                                                                                 |
| `LibraryRouteRuntime.test.tsx`        |       5 | Four extra mocked status passthrough permutations and redundant getter checks. Retained argument forwarding, rendered Collection/Recent consumers, and actual resource-state behavior in the runtime adapter suite.                          |
| `AppShell.test.tsx`                   |       1 | Only pinned two CSS class literals; it could not prove immersive layout.                                                                                                                                                                     |
| `MotionLabPanel.test.tsx`             |       1 | Tested identity of an unrelated audio element appended by the test itself. Moved its useful non-modal accessibility assertion into the real preset interaction test.                                                                         |

Across both frontend pruning passes, 26 tests were removed and four behavioral
scenarios were added: a net reduction of 22 from the original 1,226. Separately,
the Rust pass removed four weak tests and added five behavioral regressions.
No full-suite speedup is inferred from the lower count. Preserving distinct
failure, race, security, playback, and restoration scenarios matters more than
reaching an arbitrary smaller total.

Second-pass verification before integrating upstream commits:

- `npx vitest run --coverage --dir src --maxWorkers=2`: 181 files / 1,204 tests passed. Coverage: 87.33% statements, 81.68% branches, 87.36% functions, 89.69% lines.
- Primary pruning targets: four files / 27 tests passed. Additional feature pruning targets plus the resource adapter: four files / 16 tests passed.
- Newer upstream queue fixes and v0.9.0 were then preserved by rebasing onto `ce5c391`. They add their own queue regression cases, so 1,204 describes the pre-rebase audit suite, not a frozen target for the combined repository.
- After rebase, `npx vitest run src/VirtualizedQueueList.test.tsx src/features/queue/QueuePanel.test.tsx src/features/playback-runtime/PlaybackRuntime.test.tsx src/features/playback-runtime/publicQueue.test.ts src/App.queue-playback.test.tsx --maxWorkers=2` passed five files / 53 tests, covering the upstream queue changes alongside projection reuse and playback integration.
- `npm run build` passed after rebase, retaining the existing large-chunk advisory. `git diff --check` passed. The Rust sources are unchanged from the full test/fmt/Clippy verification documented in the audit; upstream only changed the Rust package version and lockfile version.
