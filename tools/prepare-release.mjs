#!/usr/bin/env node

import {
  appendFileSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const stableVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const exactTagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseTypes = new Set(["patch", "minor", "major"]);
const versionPaths = Object.freeze([
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
]);

try {
  const options = parseOptions(process.argv.slice(2));
  const result =
    options.event === "push"
      ? preparePushedTag(options)
      : prepareManualRelease(options);

  if (options.githubOutput) {
    appendFileSync(
      options.githubOutput,
      `version=${result.version}\ntag=${result.tag}\ncommit_sha=${result.commit_sha}\n`,
    );
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(
    `Release preparation failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}

function parseOptions(arguments_) {
  const values = new Map();

  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];

    if (!name?.startsWith("--") || value === undefined) {
      throw new Error(
        "Expected --event, --release-type, --tag, --run-id, --branch, and --repository-root options.",
      );
    }

    if (values.has(name)) {
      throw new Error(`Option ${name} was provided more than once.`);
    }

    values.set(name, value);
  }

  const allowedOptions = new Set([
    "--event",
    "--release-type",
    "--tag",
    "--run-id",
    "--branch",
    "--repository-root",
    "--github-output",
  ]);

  for (const name of values.keys()) {
    if (!allowedOptions.has(name)) {
      throw new Error(`Unknown option ${name}.`);
    }
  }

  const event = values.get("--event");
  const releaseType = values.get("--release-type");
  const tag = values.get("--tag") ?? "";
  const runId = values.get("--run-id");
  const branch = values.get("--branch");
  const repositoryRoot = values.get("--repository-root");

  if (event !== "push" && event !== "workflow_dispatch") {
    throw new Error("Event must be push or workflow_dispatch.");
  }

  if (!releaseTypes.has(releaseType)) {
    throw new Error("Release type must be patch, minor, or major.");
  }

  if (!/^\d+$/.test(runId ?? "")) {
    throw new Error("Run ID must contain only decimal digits.");
  }

  if (!branch) {
    throw new Error("Branch is required.");
  }

  if (!repositoryRoot) {
    throw new Error("Repository root is required.");
  }

  return {
    event,
    releaseType,
    tag,
    runId,
    branch,
    repositoryRoot: resolve(repositoryRoot),
    githubOutput: values.get("--github-output"),
  };
}

function preparePushedTag(options) {
  const version = parseTag(options.tag);
  assertLatestStableTag(options.repositoryRoot, options.tag);
  assertReleaseCommitOnMain(options.repositoryRoot, options.tag);
  const versions = readRepositoryVersions(
    options.repositoryRoot,
    `refs/tags/${options.tag}`,
  );
  assertMatchingVersions(versions, version);
  const commitSha = git(
    options.repositoryRoot,
    "rev-parse",
    `${options.tag}^{commit}`,
  );

  return {
    version,
    tag: options.tag,
    commit_sha: commitSha,
  };
}

function prepareManualRelease(options) {
  if (options.branch !== "main") {
    throw new Error("Manual releases must run from the main branch.");
  }

  assertCleanTrackedFiles(options.repositoryRoot);

  const runTag = findTagForRun(options.repositoryRoot, options.runId);

  if (runTag) {
    assertLatestStableTag(options.repositoryRoot, runTag);
    const version = parseTag(runTag);
    const versions = readRepositoryVersions(
      options.repositoryRoot,
      `refs/tags/${runTag}`,
    );
    assertMatchingVersions(versions, version);

    return {
      version,
      tag: runTag,
      commit_sha: git(
        options.repositoryRoot,
        "rev-parse",
        `${runTag}^{commit}`,
      ),
    };
  }

  const versions = readRepositoryVersions(options.repositoryRoot);
  const currentVersion = assertMatchingVersions(versions);
  const stableTags = listStableTags(options.repositoryRoot);
  let version = currentVersion;

  if (stableTags.length > 0) {
    const latestTag = stableTags.at(-1);
    const latestVersion = parseTag(latestTag);
    const ancestry = runGit(
      options.repositoryRoot,
      ["merge-base", "--is-ancestor", latestTag, "HEAD"],
      { allowFailure: true },
    );

    if (ancestry.status !== 0) {
      throw new Error(
        `Latest release tag ${latestTag} is not an ancestor of the selected main commit.`,
      );
    }

    if (currentVersion !== latestVersion) {
      throw new Error(
        `Version mismatch: manifests contain ${currentVersion}, but latest release tag is ${latestTag}.`,
      );
    }

    version = bumpVersion(latestVersion, options.releaseType);
  }

  const tag = `v${version}`;

  if (gitReferenceExists(options.repositoryRoot, `refs/tags/${tag}`)) {
    throw new Error(`Release tag ${tag} already exists for a different run.`);
  }

  synchronizeRepositoryVersion(options.repositoryRoot, version);
  assertMatchingVersions(
    readRepositoryVersions(options.repositoryRoot),
    version,
  );

  const changedPaths = git(
    options.repositoryRoot,
    "status",
    "--short",
    "--",
    ...versionPaths,
  );

  if (changedPaths) {
    git(options.repositoryRoot, "add", "--", ...versionPaths);
    git(options.repositoryRoot, "commit", "-m", `Release ${tag}`);
  }

  const commitSha = git(options.repositoryRoot, "rev-parse", "HEAD");
  git(
    options.repositoryRoot,
    "tag",
    "-a",
    tag,
    "-m",
    `Coda ${tag}\n\ncoda-release-run:${options.runId}`,
  );
  git(
    options.repositoryRoot,
    "push",
    "--atomic",
    "origin",
    `HEAD:refs/heads/${options.branch}`,
    `refs/tags/${tag}`,
  );

  return {
    version,
    tag,
    commit_sha: commitSha,
  };
}

function listStableTags(repositoryRoot) {
  const output = git(repositoryRoot, "tag", "--list", "v*");
  const tags = output ? output.split("\n").filter(Boolean) : [];

  return tags
    .filter((tag) => exactTagPattern.test(tag))
    .sort((left, right) =>
      compareVersions(parseTag(left), parseTag(right)),
    );
}

function assertLatestStableTag(repositoryRoot, tag) {
  const latestTag = listStableTags(repositoryRoot).at(-1);

  if (latestTag !== tag) {
    throw new Error(
      `Release tag ${tag} is superseded; latest stable tag is ${
        latestTag ?? "<none>"
      }.`,
    );
  }
}

function assertReleaseCommitOnMain(repositoryRoot, tag) {
  const mainReference = "refs/remotes/origin/main";

  if (!gitReferenceExists(repositoryRoot, mainReference)) {
    throw new Error("The origin/main reference is unavailable.");
  }

  const ancestry = runGit(
    repositoryRoot,
    [
      "merge-base",
      "--is-ancestor",
      `${tag}^{commit}`,
      mainReference,
    ],
    { allowFailure: true },
  );

  if (ancestry.status !== 0) {
    throw new Error(`Release tag ${tag} does not point to a commit on main.`);
  }
}

function findTagForRun(repositoryRoot, runId) {
  const marker = `coda-release-run:${runId}`;
  const matches = listStableTags(repositoryRoot).filter((tag) => {
    const tagType = git(repositoryRoot, "cat-file", "-t", `refs/tags/${tag}`);

    if (tagType !== "tag") {
      return false;
    }

    const contents = git(
      repositoryRoot,
      "for-each-ref",
      "--format=%(contents)",
      `refs/tags/${tag}`,
    );

    return contents.split("\n").includes(marker);
  });

  if (matches.length > 1) {
    throw new Error(
      `Workflow run ${runId} is associated with multiple release tags.`,
    );
  }

  return matches[0];
}

function parseTag(tag) {
  const match = exactTagPattern.exec(tag);

  if (!match) {
    throw new Error("Release tags must use the exact stable vX.Y.Z format.");
  }

  return `${match[1]}.${match[2]}.${match[3]}`;
}

function parseVersion(version) {
  const match = stableVersionPattern.exec(version);

  if (!match) {
    throw new Error(
      `Version ${JSON.stringify(version)} is not an exact stable X.Y.Z version.`,
    );
  }

  return match.slice(1).map(Number);
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];

    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function bumpVersion(version, releaseType) {
  const [major, minor, patch] = parseVersion(version);

  if (releaseType === "major") {
    return `${major + 1}.0.0`;
  }

  if (releaseType === "minor") {
    return `${major}.${minor + 1}.0`;
  }

  return `${major}.${minor}.${patch + 1}`;
}

function readRepositoryVersions(repositoryRoot, reference) {
  const readText = (relativePath) =>
    reference
      ? git(repositoryRoot, "show", `${reference}:${relativePath}`)
      : readFileSync(resolve(repositoryRoot, relativePath), "utf8");
  const packageJson = parseJson(readText("package.json"), "package.json");
  const packageLock = parseJson(
    readText("package-lock.json"),
    "package-lock.json",
  );
  const tauriConfig = parseJson(
    readText("src-tauri/tauri.conf.json"),
    "src-tauri/tauri.conf.json",
  );
  const cargoManifest = readText("src-tauri/Cargo.toml");
  const cargoLock = readText("src-tauri/Cargo.lock");

  return [
    ["package.json version", packageJson.version],
    ["package-lock.json root version", packageLock.version],
    [
      'package-lock.json packages[""] version',
      packageLock.packages?.[""]?.version,
    ],
    ["src-tauri/tauri.conf.json version", tauriConfig.version],
    [
      "src-tauri/Cargo.toml package version",
      findManifestPackageVersion(cargoManifest),
    ],
    ["src-tauri/Cargo.lock coda version", findLockedCodaVersion(cargoLock)],
  ];
}

function assertMatchingVersions(versions, expectedVersion) {
  const baseline = expectedVersion ?? versions[0]?.[1];
  const mismatches = versions.filter(([, version]) => version !== baseline);

  if (!stableVersionPattern.test(baseline ?? "") || mismatches.length > 0) {
    throw new Error(
      `Version mismatch:\n${versions
        .map(([label, version]) => `- ${label}: ${displayVersion(version)}`)
        .join("\n")}`,
    );
  }

  return baseline;
}

function synchronizeRepositoryVersion(repositoryRoot, version) {
  updateJson(resolve(repositoryRoot, "package.json"), (contents) => {
    contents.version = version;
  });
  updateJson(resolve(repositoryRoot, "package-lock.json"), (contents) => {
    if (!contents.packages?.[""]) {
      throw new Error(
        'package-lock.json is missing the root packages[""] entry.',
      );
    }

    contents.version = version;
    contents.packages[""].version = version;
  });
  updateJson(
    resolve(repositoryRoot, "src-tauri/tauri.conf.json"),
    (contents) => {
      contents.version = version;
    },
  );
  updateManifestPackageVersion(
    resolve(repositoryRoot, "src-tauri/Cargo.toml"),
    version,
  );
  updateLockedCodaVersion(
    resolve(repositoryRoot, "src-tauri/Cargo.lock"),
    version,
  );
}

function updateJson(path, update) {
  const contents = parseJson(readFileSync(path, "utf8"), path);
  update(contents);
  writeFileSync(path, `${JSON.stringify(contents, null, 2)}\n`);
}

function updateManifestPackageVersion(path, version) {
  const contents = readFileSync(path, "utf8");
  const packageTable = findManifestPackageTable(contents);

  if (!packageTable) {
    throw new Error("src-tauri/Cargo.toml is missing its [package] table.");
  }

  const nextPackageTable = replaceTomlString(
    packageTable.contents,
    "version",
    version,
    "src-tauri/Cargo.toml [package] table",
  );
  writeFileSync(
    path,
    replaceRange(
      contents,
      packageTable.index,
      packageTable.contents.length,
      nextPackageTable,
    ),
  );
}

function updateLockedCodaVersion(path, version) {
  const contents = readFileSync(path, "utf8");
  const packageBlocks = contents.split(
    /(?=^\[\[package\]\][ \t]*\r?$)/m,
  );
  const codaBlockIndexes = packageBlocks
    .map((packageBlock, index) =>
      findTomlString(packageBlock, "name") === "coda" ? index : -1,
    )
    .filter((index) => index >= 0);

  if (codaBlockIndexes.length !== 1) {
    throw new Error(
      "src-tauri/Cargo.lock must contain exactly one coda package block.",
    );
  }

  const codaBlockIndex = codaBlockIndexes[0];
  packageBlocks[codaBlockIndex] = replaceTomlString(
    packageBlocks[codaBlockIndex],
    "version",
    version,
    "src-tauri/Cargo.lock coda package block",
  );
  writeFileSync(path, packageBlocks.join(""));
}

function replaceTomlString(contents, key, value, label) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^([ \\t]*${escapedKey}[ \\t]*=[ \\t]*)"[^"\\r\\n]*"([ \\t]*)$`,
    "gm",
  );
  const matches = [...contents.matchAll(pattern)];

  if (matches.length !== 1) {
    throw new Error(`${label} must contain exactly one ${key} field.`);
  }

  const match = matches[0];
  return replaceRange(
    contents,
    match.index,
    match[0].length,
    `${match[1]}"${value}"${match[2]}`,
  );
}

function replaceRange(contents, index, length, replacement) {
  return contents.slice(0, index) + replacement + contents.slice(index + length);
}

function parseJson(contents, label) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Could not parse ${label}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function findManifestPackageVersion(contents) {
  return findTomlString(findManifestPackageTable(contents)?.contents, "version");
}

function findManifestPackageTable(contents) {
  const match =
    /^\[package\][ \t]*\r?$[\s\S]*?(?=^\[[^\r\n]+\][ \t]*\r?$|(?![\s\S]))/m.exec(
      contents,
    );

  return match
    ? {
        contents: match[0],
        index: match.index,
      }
    : undefined;
}

function findLockedCodaVersion(contents) {
  for (const packageBlock of contents.split(/(?=^\[\[package\]\]\s*$)/m)) {
    if (findTomlString(packageBlock, "name") === "coda") {
      return findTomlString(packageBlock, "version");
    }
  }

  return undefined;
}

function findTomlString(contents, key) {
  if (contents === undefined) {
    return undefined;
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedKey}\\s*=\\s*"([^"]+)"\\s*$`, "m").exec(
    contents,
  )?.[1];
}

function assertCleanTrackedFiles(repositoryRoot) {
  const status = git(
    repositoryRoot,
    "status",
    "--short",
    "--untracked-files=no",
  );

  if (status) {
    throw new Error(
      "The selected commit has tracked worktree changes before release preparation.",
    );
  }
}

function gitReferenceExists(repositoryRoot, reference) {
  return (
    runGit(
      repositoryRoot,
      ["show-ref", "--verify", "--quiet", reference],
      { allowFailure: true },
    ).status === 0
  );
}

function git(repositoryRoot, ...arguments_) {
  const result = runGit(repositoryRoot, arguments_);
  return result.stdout.trim();
}

function runGit(repositoryRoot, arguments_, { allowFailure = false } = {}) {
  const result = spawnSync("git", arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });

  if (result.error) {
    throw new Error(`Could not start git: ${result.error.message}`);
  }

  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(
      `git ${arguments_.join(" ")} failed${detail ? `: ${detail}` : "."}`,
    );
  }

  return result;
}

function displayVersion(version) {
  return (
    Object.prototype.toString.call(version) === "[object String]" &&
    version === String(version)
      ? version
      : "<missing>"
  );
}
