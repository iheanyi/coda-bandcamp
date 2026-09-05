# Build profile benchmark — 2026-09-05

## Decision

Use eight release code-generation units instead of one. Keep thin LTO,
`opt-level = "s"`, stripping, and panic-abort unchanged. Eight units let LLVM
process more of each crate in parallel; thin LTO still performs optimization
across those units. Sixteen units did not demonstrate a further benefit and
produced a larger executable.

## Local results

macOS, identical sanitized source/dependency lockfile and frontend assets, no
`.env` or signing/build credentials. Each alternative had a separate empty
target directory for its first build. Warm runs touched only the library source
mtime, and their logs show that only Coda recompiled.

| Codegen units |            Empty-target build | Completed warm builds        | Executable bytes |
| ------------- | ----------------------------: | ---------------------------- | ---------------: |
| 1             | Not measured in this campaign | 88.969 s, 129.093 s          |        8,586,704 |
| 8             |                      89.399 s | 35.868 s, 37.664 s, 39.707 s |        9,194,800 |
| 16            |                      95.836 s | 37.785 s, 55.608 s, 84.218 s |        9,294,800 |

Eight units had a **37.664-second warm median**, with **608,096 bytes / 7.08%**
more executable size than the Ring/one-unit baseline. Its binary remains about
8.5% smaller than the earlier same-assets AWS-LC executable. Installer sizes
must be measured separately.

The mechanism is visible in Cargo timing sections: the first one-unit library
build spent 41.67 seconds in code generation; the eight-unit library builds
spent roughly 11–13 seconds there. The separate binary compilation/link unit
is not a measurement of pure linker duration.

**These are not controlled percentage speedup figures.** Host contention rose
substantially during the later samples: load averages reached
70.48 / 91.04 / 81.86, with an unrelated Java workload consuming several cores.
No other user's processes were stopped. The third one-unit sample was
interrupted and excluded; a planned fresh one-unit cold build was skipped rather
than collecting more misleading data. The early eight-unit results support the
choice, but GitHub CI and actual release timings are the operational check.

## Reproduction

Use an isolated archived checkout with the same prebuilt `dist` for every
setting. In that checkout, vary only the unit count and target directory:

```sh
CARGO_TARGET_DIR=/tmp/coda-cgu-8 \
CARGO_PROFILE_RELEASE_CODEGEN_UNITS=8 \
cargo build --release --locked --offline --timings \
  --manifest-path src-tauri/Cargo.toml
```

For warm samples, touch `src-tauri/src/lib.rs` in that isolated checkout and
repeat the command, verifying that dependencies did not recompile. Keep all
completed samples, report host load, and compare emitted executable bytes.

Raw JSON, scripts, logs, hashes, and copied Cargo timing HTML:
`/private/var/folders/74/d3dwy9q171v6zjzx4pghctv00000gn/T/coda-tls-build-04kw0c4p/codegen-benchmark/`.

## Verification and release baseline

An isolated benchmark of the actual artwork-cache eviction helper produced
identical outputs in all nine scenarios across one, eight, and sixteen units.
Eight units added approximately 5 microseconds to the no-eviction path
(12.389 to 17.803 microseconds for 4,999 entries) and 27 microseconds when all
5,000 entries were leased (176.050 to 202.630 microseconds). Full-cache eviction
was nearly unchanged (255.170 to 257.412 microseconds). These interleaved samples
share the host-contention caveat; they do not establish application startup or
playback performance. The small absolute helper cost is an accepted tradeoff,
not evidence that runtime performance is universally unchanged.

Local `cargo fmt --check`, the complete native test suite, and Clippy passed.
The compiler profile change does not alter network, credential, updater,
capability, or renderer configuration.

The prior published v0.9.0 [release run](https://github.com/iheanyi/coda-bandcamp/actions/runs/33257725784)
took **442 seconds (7m22s)** end to end. Rust compiler reports: Windows 231 s,
Linux 110 s, macOS ARM 147 s, macOS Intel 160 s. Linux additionally spent about
102 seconds packaging after compilation. Its 17 assets include seven updater
signatures and one manifest. Historical runner/cache conditions differ, so the
next release comparison describes observed workflow performance, not an isolated
compiler experiment.

Profile behavior: [Cargo code-generation units](https://doc.rust-lang.org/cargo/reference/profiles.html#codegen-units)
and [LTO](https://doc.rust-lang.org/cargo/reference/profiles.html#lto).
