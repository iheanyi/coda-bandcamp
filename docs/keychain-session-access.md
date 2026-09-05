# Repeated local Keychain prompts

The reported prompt was Coda Dev requesting Bandcamp/Last.fm credentials, not
`codesign` requesting its signing key. Host inspection confirmed an available
`Coda Local Development` certificate and a certificate-signed dev bundle. A
missing identity was therefore not the explanation for this running build.

Previously every `load_credentials` and `load_lastfm_session` went to Keychain.
Album persistence, artwork authorization/publication, library commands and
Last.fm playback updates repeatedly used those functions. Allowing one read could
therefore immediately be followed by more permission prompts.

A small serialized native session now remembers successful reads, including an
absent Last.fm session. Eight simultaneous readers perform one vault read instead
of eight. This is a counted request reduction, not an elapsed-time benchmark.
Failed reads are not cached, so a denied/locked vault remains retryable.

Successful writes and deletes invalidate the session under the same lock. The
next read returns to the vault; the existing Bandcamp connect read-back and
credential equality check still run against stored values. Failed mutations
preserve the prior session. Connection generations and cache ownership checks
remain, now comparing against the active native session. Direct changes made by
another app or Keychain Access take effect after restarting Coda; the process no
longer polls the vault for external edits on every artwork operation.

No credentials enter the renderer, logs, fixtures, or new persistent storage.
No Keychain ACL, signing requirement, certificate, or Tauri capability is broadened.
The existing optional certificate-based dev signing remains; ad-hoc fallback now
warns that native rebuilds may require credential approval again. macOS can still
require initial consent. The app cannot silently grant itself Always Allow.

## Verification

Five deterministic session tests cover concurrent reads, failed-read retry and
cached absence, real read-back after mutation, failed mutation, and ordering of
an in-flight read with a mutation. The existing signing fallback test also checks
the new actionable warning.

- Removing reuse in a temporary copy of the session module made the concurrent-read regression fail with eight vault reads where one was expected. The implemented version passes.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 161 library tests and one integration test passed; tests use fake vault callbacks rather than stored account credentials.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: passed.
- `npm run test:automation-build`: 29 tests passed, including the four development runner tests. `sh -n src-tauri/coda-dev-runner.sh` and `git diff --check`: passed.
- The existing `npm run dev` process rebuilt and relaunched the actual signed macOS app. Collection loaded and Favorites refresh completed for four known tracks across two albums. No additional credential prompt was observed during that smoke check. This does not prove that a never-approved, locked, or differently signed Keychain identity can skip initial consent.

The change has not been exercised natively on Windows or Linux. No frontend logic
changed in this fix; the preceding frontend coverage/build results belong to the
already-pushed performance and test-pruning commit.
