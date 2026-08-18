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

test("bundle builds receive Last.fm credentials from GitHub secrets", () => {
  for (const [name, contents] of [
    ["cross-platform", workflow],
    ["release", releaseWorkflow],
  ]) {
    const tauriActionStep = contents.match(
      /uses: tauri-apps\/tauri-action@[\s\S]*?(?=\n\s{6}- |$)/,
    )?.[0];
    assert.ok(
      tauriActionStep,
      `${name} workflow is missing its Tauri action step`,
    );
    for (const variable of [
      "CODA_LASTFM_API_KEY",
      "CODA_LASTFM_SHARED_SECRET",
    ]) {
      assert.match(
        tauriActionStep,
        new RegExp(`${variable}: \\$\\{\\{ secrets\\.${variable} \\}\\}`),
        `${name} workflow must map ${variable} from GitHub secrets`,
      );
    }
  }
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

test("release tagging and publishing are gated on green cross-platform CI", () => {
  const prepareJob = releaseWorkflow.match(
    /\n {2}prepare-release:[\s\S]*?(?=\n {2}[\w-]+:\n)/,
  )?.[0];
  assert.ok(prepareJob, "Release workflow is missing its prepare job");

  const gateIndex = prepareJob.indexOf("check-runs?filter=latest");
  const tagCreationIndex = prepareJob.indexOf("tools/prepare-release.mjs");
  assert.ok(gateIndex > -1, "prepare job must assert CI check-run results");
  assert.ok(
    tagCreationIndex > gateIndex,
    "the green-CI gate must run before the tag-creating prepare step",
  );
  assert.match(
    prepareJob,
    /permissions:\n {6}checks: read/,
    "prepare job needs checks: read to query check runs",
  );

  assert.doesNotMatch(
    releaseWorkflow,
    /npm (run )?test/,
    "releases must not re-run the test suite; ordinary CI owns tests",
  );
  assert.doesNotMatch(
    prepareJob,
    /npm ci/,
    "the release gate must stay dependency-free and fast",
  );

  const requiredChecks = releaseWorkflow
    .match(/required_checks=\(([^)]+)\)/)?.[1]
    ?.split(/\s+/);
  const ciPlatforms = [...workflow.matchAll(/platform: ([\w.-]+)/g)].map(
    (match) => match[1],
  );
  assert.ok(requiredChecks?.length, "gate must declare required checks");
  assert.ok(ciPlatforms.length, "branch CI must declare matrix platforms");
  assert.deepEqual(
    [...requiredChecks].sort(),
    [...new Set(ciPlatforms)].sort(),
    "gate's required checks must match cross-platform CI job names exactly",
  );

  for (const job of ["prepare-draft", "build-release", "publish-release"]) {
    const jobBlock = releaseWorkflow.match(
      new RegExp(`\\n {2}${job}:[\\s\\S]*?(?=\\n {2}[\\w-]+:\\n|$)`),
    )?.[0];
    assert.ok(jobBlock, `Release workflow is missing its ${job} job`);
    const needsBlock = jobBlock.match(
      /needs:(?: [\w-]+|(?:\n {6}- [\w-]+)+)/,
    )?.[0];
    assert.ok(needsBlock, `${job} must declare needs`);
    assert.match(
      needsBlock,
      /prepare-release/,
      `${job} must descend from the green-CI gate`,
    );
  }
});

test("release builds skip only the already-run typecheck", async () => {
  assert.match(
    releaseWorkflow,
    /args: --config src-tauri\/tauri\.release\.conf\.json --target \$\{\{ matrix\.target \}\}/,
  );
  assert.match(
    workflow,
    /- run: npm run build\n/,
    "branch CI must keep its own typecheck via npm run build",
  );

  const releaseOverlay = JSON.parse(
    await readFile(
      new URL("../src-tauri/tauri.release.conf.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(releaseOverlay.build.beforeBuildCommand, "npx vite build");
  assert.equal(
    releaseOverlay.bundle,
    undefined,
    "release overlay must not touch bundle settings such as updater artifacts",
  );
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

test("every workflow job declares an execution timeout", () => {
  for (const [name, contents] of [
    ["cross-platform", workflow],
    ["release", releaseWorkflow],
  ]) {
    const jobsStart = contents.indexOf("\njobs:\n");
    assert.ok(jobsStart >= 0, `${name} workflow is missing a jobs section`);
    const jobBlocks = contents
      .slice(jobsStart + "\njobs:\n".length)
      .split(/\n(?=  [\w-]+:\n)/);
    assert.ok(jobBlocks.length > 0);
    for (const block of jobBlocks) {
      const jobName = block.match(/^ {2}([\w-]+):\n/)?.[1];
      assert.ok(jobName, `${name} workflow has an unparseable job block`);
      assert.match(
        block,
        /^ {4}timeout-minutes: \d+$/m,
        `${name} job ${jobName} must declare timeout-minutes so a hung step cannot hold the release concurrency group for six hours`,
      );
    }
  }
});

test("Linux apt cache stays shareable between branch CI and releases", () => {
  const extractAptSetup = (name, contents) => {
    const packageList = contents.match(
      /sudo apt-get install -y \\\n([\s\S]*?patchelf)\n/,
    )?.[1];
    assert.ok(packageList, `${name} workflow is missing its apt package list`);
    const cacheKey = contents.match(/key: (apt-archives-[^\n]+)/)?.[1];
    assert.ok(cacheKey, `${name} workflow is missing the apt cache key`);
    const restoreIndex = contents.indexOf("Restore apt package cache");
    const installIndex = contents.indexOf("Install Linux system dependencies");
    assert.ok(
      restoreIndex >= 0 && restoreIndex < installIndex,
      `${name} workflow must restore the apt cache before installing`,
    );
    return {
      cacheKey,
      packages: packageList
        .split("\n")
        .map((line) => line.replace(/[\s\\]+/g, ""))
        .filter((line) => line !== "" && !line.startsWith("-o")),
    };
  };

  const branch = extractAptSetup("cross-platform", workflow);
  const release = extractAptSetup("release", releaseWorkflow);
  // Tag-triggered release runs can only restore caches saved on the default
  // branch, so both workflows must agree on the key and the package set.
  assert.equal(release.cacheKey, branch.cacheKey);
  assert.deepEqual(release.packages, branch.packages);
  assert.ok(branch.packages.includes("libwebkit2gtk-4.1-dev"));
});
