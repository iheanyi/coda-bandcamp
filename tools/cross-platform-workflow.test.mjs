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

// Windows runners check out text with CRLF (core.autocrlf defaults on and no
// .gitattributes pins line endings), which broke every "\n"-anchored probe in
// this suite on 2026-08-18. All file reads go through this helper so current
// and future probes stay checkout-agnostic.
function normalizeLineEndings(text) {
  return text.replaceAll("\r\n", "\n");
}

async function readTextFile(path) {
  return normalizeLineEndings(await readFile(path, "utf8"));
}

const workflow = await readTextFile(
  new URL("../.github/workflows/cross-platform.yml", import.meta.url),
);
const releaseWorkflow = await readTextFile(
  new URL("../.github/workflows/release.yml", import.meta.url),
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
    /- run: npm run typecheck\n/,
    "branch CI must keep the typecheck gate the release green-CI check relies on",
  );
  assert.doesNotMatch(
    workflow,
    /- run: npm run build\n/,
    "branch CI must not build the frontend twice; the vite build lives in the tauri-action beforeBuildCommand",
  );

  const ciOverlay = JSON.parse(
    await readTextFile(
      new URL("../src-tauri/tauri.ci.conf.json", import.meta.url),
    ),
  );
  assert.equal(
    ciOverlay.build.beforeBuildCommand,
    "npx vite build",
    "the CI overlay owns the single frontend build",
  );

  const releaseOverlay = JSON.parse(
    await readTextFile(
      new URL("../src-tauri/tauri.release.conf.json", import.meta.url),
    ),
  );
  assert.equal(releaseOverlay.build.beforeBuildCommand, "npx vite build");
  assert.equal(
    releaseOverlay.bundle,
    undefined,
    "release overlay must not touch bundle settings such as updater artifacts",
  );
});

test("coverage floors run once while every platform runs the suite", () => {
  const coverageCondition = workflow.match(
    /- run: npm run test:coverage\n\s+if: (.+)\n/,
  )?.[1];
  assert.equal(
    coverageCondition,
    "matrix.platform == 'ubuntu-22.04'",
    "coverage floors must stay enforced on every push via the Linux job",
  );
  const plainSuiteCondition = workflow.match(
    /- run: npx vitest run --dir src\n\s+if: (.+)\n/,
  )?.[1];
  assert.equal(
    plainSuiteCondition,
    "matrix.platform != 'ubuntu-22.04'",
    "Windows and macOS must still gate on the full frontend suite",
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

    const manifest = JSON.parse(await readTextFile(outputPath));
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
      /apt_retry \d+ install -y \\\n([\s\S]*?patchelf)\n/,
    )?.[1];
    assert.ok(packageList, `${name} workflow is missing its apt package list`);
    const cacheKeys = [...contents.matchAll(/key: (apt-archives-[^\n]+)/g)].map(
      (match) => match[1],
    );
    assert.ok(
      cacheKeys.length > 0,
      `${name} workflow is missing the apt cache key`,
    );
    for (const key of cacheKeys) {
      // env.ImageOS/env.ImageVersion are runner process env vars that render
      // empty in a cache step's with: context (observed as
      // apt-archives---coda-v1 in v0.7.2), so keys must use the
      // GITHUB_ENV-promoted image id.
      assert.match(
        key,
        /^apt-archives-\$\{\{ env\.APT_CACHE_IMAGE \}\}-/,
        `${name} workflow apt cache key must use the runtime-resolved image id: ${key}`,
      );
    }
    assert.match(
      contents,
      /APT_CACHE_IMAGE=\$\{ImageOS:\?\}-\$\{ImageVersion:\?\}" >> "\$GITHUB_ENV"/,
      `${name} workflow must promote the runner image id into GITHUB_ENV`,
    );
    const cacheKey = cacheKeys[0];
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

test("publish installs minisign from the baked index with a guarded fallback", () => {
  const publishJob = releaseWorkflow.slice(
    releaseWorkflow.indexOf("\n  publish-release:"),
  );
  assert.ok(publishJob.length > 0, "release workflow is missing publish job");

  const cacheIndex = publishJob.indexOf("Restore apt package cache");
  const verifyIndex = publishJob.indexOf(
    "Cryptographically verify updater signatures",
  );
  assert.ok(
    cacheIndex >= 0 && verifyIndex > cacheIndex,
    "publish must restore its apt cache before verifying signatures",
  );
  assert.match(
    publishJob,
    /key: apt-archives-\$\{\{ env\.APT_CACHE_IMAGE \}\}-minisign-v1/,
    "the publish apt cache must stay distinct from the build-dependency cache",
  );

  const fastPathIndex = publishJob.indexOf(
    'timeout 120 apt-get "${apt_options[@]}" "${install_args[@]}"',
  );
  const fallbackUpdateIndex = publishJob.indexOf("apt_retry 180 update");
  assert.ok(
    fastPathIndex >= 0,
    "publish must try installing minisign from the baked image index first",
  );
  assert.ok(
    fallbackUpdateIndex > fastPathIndex,
    "the index refresh must only run as fallback for a failed baked-index install",
  );
  assert.match(
    publishJob,
    /apt_retry 120 "\$\{install_args\[@\]\}"/,
    "the fallback install must keep the wall-clock retry wrapper",
  );
});

test("same-head push and PR runs deduplicate without ever touching main", () => {
  const concurrency = workflow.match(/\nconcurrency:\n(?: {2}.+\n)+/)?.[0];
  assert.ok(
    concurrency,
    "cross-platform workflow must declare a concurrency block",
  );

  const group = concurrency.match(/group: (.+)\n/)?.[1];
  assert.ok(group, "concurrency must declare a group");
  assert.match(
    group,
    /github\.event\.pull_request\.head\.sha \|\| github\.sha/,
    "push and PR runs must share one group keyed by the branch-head SHA",
  );
  assert.match(
    group,
    /github\.ref == 'refs\/heads\/main' && github\.run_id/,
    "main runs must take a run-unique group no other run can join",
  );
  assert.match(
    concurrency,
    /cancel-in-progress: \$\{\{ github\.ref != 'refs\/heads\/main' \}\}/,
    "cancellation must be scoped so it can never affect main runs",
  );

  assert.match(
    releaseWorkflow,
    /concurrency:\n {2}group: release\n {2}cancel-in-progress: false\n/,
    "the release workflow's dedicated concurrency group must stay untouched",
  );
});

test("workflow probes survive CRLF checkouts", () => {
  // Replays the four probes that failed on the 2026-08-18 windows-latest run
  // against a simulated CRLF checkout: the raw text must reproduce that
  // failure, and read-site normalization must satisfy every probe.
  const crlfWorkflow = workflow.replaceAll("\n", "\r\n");
  const crlfRelease = releaseWorkflow.replaceAll("\n", "\r\n");

  assert.equal(
    crlfRelease.match(/\n {2}prepare-release:[\s\S]*?(?=\n {2}[\w-]+:\n)/),
    null,
    "an unnormalized CRLF checkout must reproduce the original failure",
  );

  const normalizedWorkflow = normalizeLineEndings(crlfWorkflow);
  const normalizedRelease = normalizeLineEndings(crlfRelease);
  assert.ok(
    normalizedRelease.match(/\n {2}prepare-release:[\s\S]*?(?=\n {2}[\w-]+:\n)/),
    "normalization must restore the prepare-release job probe",
  );
  assert.match(normalizedWorkflow, /- run: npm run typecheck\n/);
  assert.ok(normalizedWorkflow.indexOf("\njobs:\n") >= 0);
  assert.match(
    normalizedWorkflow,
    /apt_retry \d+ install -y \\\n[\s\S]*?patchelf\n/,
  );
});

test("every apt invocation carries fail-fast hang guards", () => {
  // The v0.7.1 publish hang and both 2026-08-18 ubuntu-22.04 CI hangs were
  // apt fetches wedged on a mirror. Acquire timeouts alone proved
  // insufficient: a trickling connection never trips an inactivity timeout,
  // so every apt-get call must also sit behind a hard wall-clock bound with
  // retries (the apt_retry wrapper) in its guarded noninteractive form.
  const requiredGuards = [
    "-o Acquire::https::Timeout=30",
    "-o Acquire::http::Timeout=30",
    "-o Acquire::Retries=3",
    "-o DPkg::Lock::Timeout=60",
  ];

  for (const [name, contents] of [
    ["cross-platform", workflow],
    ["release", releaseWorkflow],
  ]) {
    const optionBlocks = contents.match(/apt_options=\([\s\S]*?\n\s*\)/g);
    assert.ok(optionBlocks?.length, `${name} workflow must define apt_options`);
    for (const block of optionBlocks) {
      for (const guard of requiredGuards) {
        assert.ok(
          block.includes(guard),
          `${name} workflow apt_options must include ${guard}`,
        );
      }
    }

    const retryHelperCount = contents.match(/apt_retry\(\) \{/g)?.length ?? 0;
    assert.equal(
      retryHelperCount,
      optionBlocks.length,
      `${name} workflow must pair every apt_options block with apt_retry`,
    );
    assert.equal(
      contents.match(/for attempt in 1 2 3/g)?.length ?? 0,
      retryHelperCount,
      `${name} workflow apt_retry must keep its three-attempt loop`,
    );

    let invocationCount = 0;
    for (const line of contents.split("\n")) {
      if (!line.includes("apt-get") || line.trimStart().startsWith("#")) {
        continue;
      }
      assert.ok(
        line.includes('apt-get "${apt_options[@]}"'),
        `${name} workflow has an unguarded apt-get invocation: ${line.trim()}`,
      );
      const timeoutIndex = line.indexOf("timeout ");
      assert.ok(
        timeoutIndex !== -1 && timeoutIndex < line.indexOf("apt-get"),
        `${name} workflow apt-get invocation lacks a wall-clock bound: ${line.trim()}`,
      );
      invocationCount += 1;
    }
    const noninteractiveCount =
      contents.match(/sudo env DEBIAN_FRONTEND=noninteractive/g)?.length ?? 0;
    assert.ok(invocationCount > 0, `${name} workflow must invoke apt-get`);
    assert.equal(
      noninteractiveCount,
      invocationCount,
      `${name} workflow must run every apt-get under a noninteractive frontend`,
    );
  }
});
