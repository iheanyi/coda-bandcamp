use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};

/// Last.fm desktop application credentials consumed at compile time by
/// `option_env!` in `src/lastfm.rs`.
const LASTFM_BUILD_VARS: [&str; 2] = ["CODA_LASTFM_API_KEY", "CODA_LASTFM_SHARED_SECRET"];

fn main() {
    inject_lastfm_build_credentials();
    tauri_build::build()
}

/// Re-exports the Last.fm build credentials to rustc so the compile-time
/// `option_env!` reads see them. Real environment variables take precedence;
/// the repository-root `.env` file is the local fallback so `tauri dev` and
/// `tauri build` work without exporting variables manually. CI supplies real
/// environment variables and has no `.env`, so it is unaffected.
fn inject_lastfm_build_credentials() {
    let dotenv_path = repository_root_dotenv();
    // Cargo re-runs build scripts on every build when a tracked path is
    // missing, so only track `.env` once it exists. Creating `.env` for the
    // first time needs one forced rebuild (for example `touch build.rs`).
    if dotenv_path.exists() {
        println!("cargo:rerun-if-changed={}", dotenv_path.display());
    }
    let dotenv_values = dotenv_values(&dotenv_path);

    for name in LASTFM_BUILD_VARS {
        println!("cargo:rerun-if-env-changed={name}");
        let value = env::var(name)
            .ok()
            .filter(|value| !value.is_empty())
            .or_else(|| {
                dotenv_values
                    .get(name)
                    .filter(|value| !value.is_empty())
                    .cloned()
            });
        let Some(value) = value else {
            continue;
        };
        // A line break would terminate the `rustc-env` directive early and
        // inject the remainder as a new cargo directive; refuse such values
        // without echoing them.
        if value.contains(['\n', '\r']) {
            println!("cargo:warning={name} contains line breaks and was ignored");
            continue;
        }
        println!("cargo:rustc-env={name}={value}");
    }
}

fn repository_root_dotenv() -> PathBuf {
    let manifest_dir =
        env::var("CARGO_MANIFEST_DIR").expect("cargo always sets CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir).join("..").join(".env")
}

fn dotenv_values(path: &Path) -> HashMap<String, String> {
    match dotenvy::from_path_iter(path) {
        Ok(entries) => entries.filter_map(Result::ok).collect(),
        Err(_) => HashMap::new(),
    }
}
