import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/cross-platform.yml", import.meta.url),
  "utf8",
);
const releaseWorkflow = await readFile(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

test("branch CI keeps Linux packaging deterministic while releases build AppImage", () => {
  assert.match(
    workflow,
    /platform: ubuntu-22\.04\s+target: x86_64-unknown-linux-gnu\s+bundleArgs: --bundles deb,rpm/,
  );
  assert.match(
    workflow,
    /args: --config src-tauri\/tauri\.ci\.conf\.json --target \$\{\{ matrix\.target \}\} \$\{\{ matrix\.bundleArgs \}\}/,
  );
  assert.doesNotMatch(releaseWorkflow, /--bundles deb,rpm/);
});
