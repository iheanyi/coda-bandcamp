#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , tag, repositoryArgument, ...extraArguments] = process.argv;
const tagMatch = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag ?? "");

if (!tagMatch || extraArguments.length > 0) {
  console.error(
    "Expected an exact vX.Y.Z release tag and an optional repository root.\n" +
      "Usage: node tools/check-release-version.mjs v1.2.3 [repository-root]",
  );
  process.exitCode = 1;
} else {
  try {
    const expectedVersion = tag.slice(1);
    const repositoryRoot = resolve(repositoryArgument ?? process.cwd());
    const packageJson = readJson(repositoryRoot, "package.json");
    const packageLock = readJson(repositoryRoot, "package-lock.json");
    const tauriConfig = readJson(repositoryRoot, "src-tauri/tauri.conf.json");
    const cargoManifest = readText(repositoryRoot, "src-tauri/Cargo.toml");
    const cargoLock = readText(repositoryRoot, "src-tauri/Cargo.lock");

    const versions = [
      ["package.json version", packageJson.version],
      ["package-lock.json root version", packageLock.version],
      ['package-lock.json packages[""] version', packageLock.packages?.[""]?.version],
      ["src-tauri/tauri.conf.json version", tauriConfig.version],
      [
        "src-tauri/Cargo.toml package version",
        findManifestPackageVersion(cargoManifest),
      ],
      ["src-tauri/Cargo.lock coda version", findLockedCodaVersion(cargoLock)],
    ];
    const mismatches = versions.filter(([, version]) => version !== expectedVersion);

    if (mismatches.length > 0) {
      console.error(
        `Release tag ${tag} does not match every Coda version:\n${mismatches
          .map(
            ([label, version]) =>
              `- ${label}: expected ${expectedVersion}, found ${displayVersion(version)}`,
          )
          .join("\n")}`,
      );
      process.exitCode = 1;
    } else {
      console.log(`Release version ${expectedVersion} matches all manifests.`);
    }
  } catch (error) {
    console.error(
      `Release version check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}

function readJson(repositoryRoot, relativePath) {
  const contents = readText(repositoryRoot, relativePath);

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Could not parse ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function readText(repositoryRoot, relativePath) {
  try {
    return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    throw new Error(
      `Could not read ${relativePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function findManifestPackageVersion(contents) {
  const packageTable = contents.match(
    /^\[package\]\s*$([\s\S]*?)(?=^\[[^\n]+\]\s*$|(?![\s\S]))/m,
  )?.[1];
  return findTomlString(packageTable, "version");
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

function displayVersion(version) {
  return typeof version === "string" ? version : "<missing>";
}
