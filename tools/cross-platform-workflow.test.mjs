import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = new URL("..", import.meta.url);
const releaseCommit = "a".repeat(40);
const workflow = await readFile(
  new URL("../.github/workflows/cross-platform.yml", import.meta.url),
  "utf8",
);
const releaseWorkflow = await readFile(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

function runTool(path, arguments_) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL(path, repositoryRoot)), ...arguments_],
    {
      encoding: "utf8",
    },
  );
}

async function withTemporaryDirectory(prefix, operation) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  try {
    await operation(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

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

test("release builds retry transient packaging and asset-upload failures in place", () => {
  const tauriActionStep = releaseWorkflow.match(
    /uses: tauri-apps\/tauri-action@[\s\S]*?(?=\n\s{2}[a-z][a-z-]+:|\n\s{6}- name:|$)/,
  )?.[0];

  assert.ok(
    tauriActionStep,
    "Release workflow is missing its Tauri action step",
  );
  assert.match(tauriActionStep, /retryAttempts: 2/);
});

test("release draft verification accepts only matching text metadata", async () => {
  await withTemporaryDirectory("coda-release-draft-", async (directory) => {
    const releasePath = join(directory, "release.json");
    const marker =
      `<!-- coda-release-run:123 ` +
      `coda-release-commit:${releaseCommit} -->`;
    await writeFile(
      releasePath,
      JSON.stringify({
        body: `Release notes\n${marker}`,
        isDraft: true,
        tagName: "v1.2.3",
      }),
    );

    const valid = runTool("tools/verify-release-draft.mjs", [
      "v1.2.3",
      releaseCommit,
      "123",
      releasePath,
    ]);
    assert.equal(valid.status, 0, valid.stderr);

    await writeFile(
      releasePath,
      JSON.stringify({
        body: 123,
        isDraft: true,
        tagName: "v1.2.3",
      }),
    );
    const invalid = runTool("tools/verify-release-draft.mjs", [
      "v1.2.3",
      releaseCommit,
      "123",
      releasePath,
    ]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /does not belong to workflow run 123/u);
  });
});

test("updater manifest assembly validates and maps release assets", async () => {
  await withTemporaryDirectory("coda-updater-manifest-", async (directory) => {
    const releasePath = join(directory, "release.json");
    const signedAssetDirectory = join(directory, "signed-assets");
    const outputPath = join(directory, "latest.json");
    const updaterAssetNames = [
      "Coda_1.2.3_aarch64.app.tar.gz",
      "Coda_1.2.3_x64.app.tar.gz",
      "Coda_1.2.3_amd64.AppImage",
      "Coda_1.2.3_amd64.deb",
      "Coda-1.2.3-1.x86_64.rpm",
      "Coda_1.2.3_x64-setup.exe",
      "Coda_1.2.3_x64_en-US.msi",
    ];
    const releaseAssetNames = updaterAssetNames.flatMap((name) => [
      name,
      `${name}.sig`,
    ]);

    await mkdir(signedAssetDirectory);
    await Promise.all(
      releaseAssetNames.map((name) =>
        writeFile(
          join(signedAssetDirectory, name),
          name.endsWith(".sig") ? "signature" : "artifact",
        ),
      ),
    );
    await writeFile(
      releasePath,
      JSON.stringify({
        assets: releaseAssetNames.map((name) => ({ name })),
        isDraft: true,
        tagName: "v1.2.3",
      }),
    );

    const result = runTool("tools/assemble-updater-manifest.mjs", [
      "v1.2.3",
      releasePath,
      signedAssetDirectory,
      outputPath,
    ]);
    assert.equal(result.status, 0, result.stderr);

    const manifest = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(manifest.version, "1.2.3");
    assert.equal(Object.keys(manifest.platforms).length, 11);
    assert.equal(
      manifest.platforms["windows-x86_64-msi"].signature,
      "signature",
    );
  });
});

test("release preparation rejects incomplete automation input", () => {
  const result = runTool("tools/prepare-release.mjs", []);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Event must be push or workflow_dispatch/u);
});
