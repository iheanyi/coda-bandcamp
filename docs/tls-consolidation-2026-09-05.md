# One HTTPS crypto provider — 2026-09-05

## Change

Coda now selects Ring for Rustls across its Reqwest clients and Tauri updater.
Reqwest uses `rustls-no-provider`; a direct Rustls dependency explicitly enables
`ring`, `std`, and `tls12` with default features disabled. The shared
`network::client_builder()` initializes the process provider before client
construction, including tests that do not run the desktop entry point. Startup
also initializes it before registering plugins.

Bandcamp, artwork, and Last.fm clients retain their existing HTTPS restrictions,
timeouts, redirect policies, and platform certificate verification. Updater
signature verification and its configuration are unchanged. No credentials,
permissions, CSP, or keyring behavior changed.

This is not identical cryptographic capability: Ring omits AWS-LC's hybrid
post-quantum X25519MLKEM768 key exchange. Standard TLS remains available. The
tradeoff is smaller artifacts and less native build work.

## Dependency and size result

The TLS consolidation removes 14 package/version entries and no longer
contains AWS-LC. Removed entries include AWS-LC, CMake, fs_extra, jobserver, and
optional QUIC/Rand dependencies no longer selected by the old feature path.
Some were lockfile-only dependencies, so this is not a claim of 14 fewer
compiled crates on every platform. Rustls was already present transitively.
The certificate regression additionally uses dev-only rcgen with Ring and
default features disabled to generate throwaway credentials in memory; it adds
test tooling, not a new production crypto provider.

Matched local macOS release executables, with identical frontend assets and
release profile:

| Configuration          | Executable bytes |
| ---------------------- | ---------------: |
| Previous AWS-LC + Ring |       10,053,424 |
| Ring only              |        8,586,704 |

Reduction: **1,466,720 bytes / 14.59%**. These are raw executable sizes, not
installer download sizes or runtime-memory measurements.

## Build timings

Both configurations used the same archived source baseline, copied frontend
assets, release profile, and sanitized environment without Last.fm build
credentials. Cold runs used separate empty target directories. The final quiet
pair reused cached dependencies, restored the respective source/configuration,
and compiled only Coda in both runs.

| Scenario                        | AWS-LC + Ring | Ring only | Interpretation                                 |
| ------------------------------- | ------------: | --------: | ---------------------------------------------- |
| Cold release build              |     223.310 s | 219.289 s | Differing host contention; no reliable speedup |
| Quiet cached-dependency rebuild |      71.860 s |  71.697 s | Effectively unchanged (0.163 s difference)     |

An earlier warm pair measured 148.239 s versus 80.399 s while other builds/tests
were active. It is discarded as performance evidence. A transition build took
98.632 s and is not compared with warm builds. **This change demonstrated a
smaller binary, not a meaningful local build-speed improvement.** Compiler
parallelism and other native framework work can dominate wall-clock time even
when one crypto library is removed.

Raw logs, JSON records, and Cargo timing HTML are in
`/private/var/folders/74/d3dwy9q171v6zjzx4pghctv00000gn/T/coda-tls-build-04kw0c4p`.

## Verification

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`: 163 library tests and one
  integration test passed. Two new regressions cover concurrent fresh-process
  initialization and rejection of a local self-signed HTTPS certificate.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- Native Coda restored its 1,912-release collection and loaded live Discover
  results after rebuilding with Ring.
- A temporary smoke executable used the real updater plugin/configuration in a
  Tauri mock application. Its manifest check succeeded over HTTPS without
  downloading/installing an update. Public Last.fm HTTPS also succeeded (400
  expected for a request without API parameters). No user credentials were used.
  The probe was removed from the repository after execution.
- The self-signed certificate is generated in memory for each test. Its rejection test
  inspects the certificate-error cause, so a timeout cannot masquerade as a pass.
- Unsigned macOS app-only packaging succeeded. The bundled executable matched
  the final Ring release executable byte-for-byte; updater artifact generation
  was disabled for this isolated packaging check. No release was published.

Evidence: `/tmp/coda-ring-tests.log`, `/tmp/coda-ring-clippy.log`,
`/tmp/coda-tls-smoke.log`, `/tmp/coda-tls-smoke.rs`.

Windows/Linux runtime checks and the next GitHub build timings are not locally
validated. Neither the local size result nor a warm dependency cache establishes
an exact future CI duration.
