//! Verifies that the Last.fm build credentials injected by `build.rs` reach
//! compile-time `option_env!` consumers, mirroring how `src/lastfm.rs` reads
//! them.
//!
//! These assertions never print credential values; failure messages report
//! only presence and length information.

use std::env;
use std::fs;
use std::path::PathBuf;

const API_KEY: Option<&str> = option_env!("CODA_LASTFM_API_KEY");
const SHARED_SECRET: Option<&str> = option_env!("CODA_LASTFM_SHARED_SECRET");

#[test]
fn lastfm_build_credentials_reach_compile_time_consumers() {
    for (name, compiled) in [
        ("CODA_LASTFM_API_KEY", nonempty(API_KEY)),
        ("CODA_LASTFM_SHARED_SECRET", nonempty(SHARED_SECRET)),
    ] {
        match compiled {
            Some(value) => assert!(
                is_lastfm_credential_shape(value),
                "{name} was injected at compile time but is not a 32-character \
                 hex credential (got length {}); fix the value in the \
                 repository-root .env or the exported environment variable",
                value.len(),
            ),
            // Soft-pass for contributors without credentials: only fail when
            // a credential is visibly configured right now but was absent at
            // compile time, which means the build predates the credential.
            None => assert!(
                !runtime_configured(name),
                "{name} is configured (environment or repository-root .env) \
                 but was empty at compile time; run `touch src-tauri/build.rs` \
                 and rebuild to inject it",
            ),
        }
    }
}

fn nonempty(value: Option<&'static str>) -> Option<&'static str> {
    value.filter(|value| !value.is_empty())
}

fn runtime_configured(name: &str) -> bool {
    if env::var(name).is_ok_and(|value| !value.is_empty()) {
        return true;
    }
    dotenv_value(name).is_some_and(|value| !value.is_empty())
}

/// Approximate `KEY=value` lookup in the repository-root `.env`. It only has
/// to recognize values that `build.rs` would have injected; unrecognized
/// formats err toward the soft-pass branch above.
fn dotenv_value(name: &str) -> Option<String> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(".env");
    let contents = fs::read_to_string(path).ok()?;
    contents.lines().find_map(|line| {
        let value = line.trim().strip_prefix(name)?.strip_prefix('=')?;
        Some(unquote(value.trim()).to_string())
    })
}

fn unquote(value: &str) -> &str {
    ['"', '\'']
        .iter()
        .find_map(|quote| {
            value
                .strip_prefix(*quote)
                .and_then(|inner| inner.strip_suffix(*quote))
        })
        .unwrap_or(value)
}

fn is_lastfm_credential_shape(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
