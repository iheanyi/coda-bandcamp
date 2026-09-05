// Run: node tools/benchmark-cover-evictions.mjs [baseline-git-ref]
// Extracts both real pure function bodies and compiles them with rustc -O.
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir, cpus, platform, arch } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = "src-tauri/src/cover_cache/store.rs";
const baseline = process.argv[2] ?? "427900109b547ccc9ae04aac11468da9c4b72bab";
const before = execFileSync("git", ["show", `${baseline}:${source}`], {
  cwd: root,
  encoding: "utf8",
});
const after = await readFile(join(root, source), "utf8");
function extract(text) {
  const start = text.indexOf("pub(crate) fn select_evictions(");
  const end = text.indexOf("\npub(crate) fn remove_indexed_entry(", start);
  if (start < 0 || end < 0)
    throw new Error(
      "Eviction helper boundary changed; update benchmark extraction.",
    );
  return text.slice(start, end);
}
const constants = ["MAX_COVER_CACHE_ENTRIES", "MAX_COVER_CACHE_BYTES"]
  .map((name) => {
    const pattern = new RegExp(`pub\\(crate\\) const ${name}: [^;]+;`);
    const old = before.match(pattern)?.[0];
    const current = after.match(pattern)?.[0];
    if (!current || old !== current)
      throw new Error(`Baseline ${name} differs; revise fixture.`);
    return current;
  })
  .join("\n");
const rust = `
use std::collections::{BTreeMap, HashMap};
use std::hint::black_box;
use std::time::Instant;
${constants}
// Only fields read by select_evictions; container/key types match production.
struct CoverCacheEntry { byte_length: u64, last_access_at: u64 }
struct CoverCacheIndex { entries: BTreeMap<String, CoverCacheEntry> }
struct CoverCacheRuntime { index: CoverCacheIndex, leases: HashMap<String, usize> }
mod before { use super::*; ${extract(before)} }
mod after { use super::*; ${extract(after)} }
fn main() {
    for size in [500_usize, 4_999, 5_000] {
        let runtime = CoverCacheRuntime {
            index: CoverCacheIndex { entries: (0..size).map(|i| (format!("{i:064x}"), CoverCacheEntry { byte_length: 1024, last_access_at: ((i * 7919) % size) as u64 })).collect() },
            leases: HashMap::new(),
        };
        for (scenario, key) in [("insert", "f".repeat(64)), ("replace", format!("{:064x}", size / 2))] {
            assert_eq!(before::select_evictions(&runtime, &key, 1024), after::select_evictions(&runtime, &key, 1024));
            let mut samples = [Vec::new(), Vec::new()];
            let functions = [before::select_evictions as fn(&CoverCacheRuntime, &str, u64) -> Option<Vec<String>>, after::select_evictions];
            for round in 0..20 {
                for version in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                    let started = Instant::now();
                    for _ in 0..100 { black_box(functions[version](black_box(&runtime), black_box(&key), black_box(1024))); }
                    if round >= 5 { samples[version].push(started.elapsed().as_secs_f64() * 1_000_000.0 / 100.0); }
                }
            }
            for values in &mut samples { values.sort_by(f64::total_cmp); }
            println!("albums={size} scenario={scenario} before_us={:.3} after_us={:.3} speedup={:.2}", samples[0][7], samples[1][7], samples[0][7] / samples[1][7]);
        }
    }
}
`;
const directory = await mkdtemp(join(tmpdir(), "coda-cover-evictions-"));
const rustPath = join(directory, "benchmark.rs");
const binary = join(directory, "benchmark");
try {
  await writeFile(rustPath, rust);
  execFileSync("rustc", ["--edition=2021", "-O", rustPath, "-o", binary], {
    stdio: "inherit",
  });
  console.log(
    JSON.stringify({
      baseline,
      cpu: cpus()[0].model,
      platform: platform(),
      arch: arch(),
      rustc: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
      samples: 15,
      warmups: 5,
      callsPerSample: 100,
    }),
  );
  execFileSync(binary, [], { stdio: "inherit" });
} finally {
  for (const path of [rustPath, binary])
    await unlink(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  await rmdir(directory);
}
