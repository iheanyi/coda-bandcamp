#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";

const versionPaths = [
  "package.json",
  "package-lock.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

try {
  const [commit, repositoryRoot, ...extra] = process.argv.slice(2);
  if (!/^[0-9a-f]{40}$/.test(commit ?? "") || !repositoryRoot || extra.length) {
    throw new Error("Expected a full commit SHA and repository root.");
  }

  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw new Error("Could not read release commit metadata.");
    }
    return result.stdout;
  };
  const parents = git("show", "-s", "--format=%P", commit).trim().split(" ");
  if (parents.length !== 1 || !/^[0-9a-f]{40}$/.test(parents[0])) {
    throw new Error("Version bumps must have exactly one parent.");
  }
  const parent = parents[0];
  const changed = git(
    "diff",
    "--name-only",
    "--no-renames",
    "-z",
    parent,
    commit,
  )
    .split("\0")
    .filter(Boolean)
    .sort();
  if (!isDeepStrictEqual(changed, [...versionPaths].sort())) {
    throw new Error(
      "A version bump must change only all five version manifests.",
    );
  }

  const versions = [[], []];
  for (const path of versionPaths) {
    const normalized = [parent, commit].map((ref, index) => {
      if (!git("ls-tree", ref, "--", path).startsWith("100644 blob ")) {
        throw new Error(`Unexpected file type or mode for ${path}.`);
      }
      return normalizeManifest(
        path,
        git("show", `${ref}:${path}`),
        versions[index],
      );
    });
    if (!isDeepStrictEqual(...normalized)) {
      throw new Error(
        `${path} includes changes beyond release version metadata.`,
      );
    }
  }
  for (const values of versions) {
    if (
      !values.every(
        (value) => stableVersion.test(value ?? "") && value === values[0],
      )
    ) {
      throw new Error(
        "All six version fields must contain the same stable version.",
      );
    }
  }
  const before = versions[0][0].split(".").map(BigInt);
  const after = versions[1][0].split(".").map(BigInt);
  const firstDifference = after.findIndex(
    (part, index) => part !== before[index],
  );
  if (
    firstDifference < 0 ||
    after[firstDifference] <= before[firstDifference]
  ) {
    throw new Error("Release version must increase.");
  }
  console.log(
    `Verified version-only bump ${versions[0][0]} -> ${versions[1][0]}.`,
  );
} catch (error) {
  console.error(`Version-only verification failed: ${error.message}`);
  process.exitCode = 1;
}

function normalizeManifest(path, text, versions) {
  if (path.endsWith(".json")) {
    const manifest = JSON.parse(text);
    versions.push(manifest.version);
    manifest.version = "<release-version>";
    if (path === "package-lock.json") {
      versions.push(manifest.packages?.[""]?.version);
      if (!manifest.packages?.[""]) {
        throw new Error("package-lock.json is missing its root package.");
      }
      manifest.packages[""].version = "<release-version>";
    }
    return manifest;
  }

  // Keep every other byte intact. This deliberately accepts the canonical
  // TOML layout written by prepare-release, not arbitrary equivalent rewrites.
  const blocks = path.endsWith("Cargo.toml")
    ? [
        ...text.matchAll(
          /^\[package\][ \t]*\r?$[\s\S]*?(?=^\[[^\r\n]+\][ \t]*\r?$|(?![\s\S]))/gm,
        ),
      ]
    : [
        ...text.matchAll(
          /^\[\[package\]\][ \t]*\r?$[\s\S]*?(?=^\[\[package\]\][ \t]*\r?$|(?![\s\S]))/gm,
        ),
      ].filter((match) => /^name\s*=\s*"coda"\s*$/m.test(match[0]));
  if (blocks.length !== 1) {
    throw new Error(`${path} must contain exactly one Coda package table.`);
  }
  const block = blocks[0];
  const fields = [
    ...block[0].matchAll(
      /^([ \t]*version[ \t]*=[ \t]*)"([^"\r\n]*)"([ \t]*\r?)$/gm,
    ),
  ];
  if (fields.length !== 1) {
    throw new Error(`${path} must contain exactly one package version.`);
  }
  const field = fields[0];
  versions.push(field[2]);
  const offset = block.index + field.index;
  return (
    text.slice(0, offset) +
    `${field[1]}"<release-version>"${field[3]}` +
    text.slice(offset + field[0].length)
  );
}
