#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const REQUIRED_PLATFORMS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
  "windows-x86_64",
];
const RELEASE_PATH_PREFIX = "/iheanyi/coda-bandcamp/releases/download/";
const MAX_SIGNATURE_LENGTH = 32_768;

const [, , tag, latestArgument, releaseArgument, ...extraArguments] =
  process.argv;

if (
  !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag ?? "") ||
  !latestArgument ||
  !releaseArgument ||
  extraArguments.length > 0
) {
  console.error(
    "Expected a vX.Y.Z tag, latest.json path, and release metadata path.\n" +
      "Usage: node tools/verify-release-assets.mjs v1.2.3 latest.json release.json",
  );
  process.exitCode = 1;
} else {
  try {
    const latest = readJson(latestArgument);
    const release = readJson(releaseArgument);
    const errors = verifyRelease(tag, latest, release);

    if (errors.length > 0) {
      console.error(`Release ${tag} is not publishable:\n${errors.join("\n")}`);
      process.exitCode = 1;
    } else {
      console.log(
        `Verified signed updater assets for ${REQUIRED_PLATFORMS.length} platforms in ${tag}.`,
      );
    }
  } catch (error) {
    console.error(
      `Release asset verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}

function readJson(path) {
  const absolutePath = resolve(path);
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${basename(path)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function verifyRelease(tag, latest, release) {
  const errors = [];
  if (!isRecord(latest)) {
    return ["- latest.json must contain a JSON object"];
  }
  if (!isRecord(release)) {
    return ["- release metadata must contain a JSON object"];
  }

  if (release.tagName !== tag) {
    errors.push(`- release tag must be ${tag}`);
  }
  if (release.isDraft !== true) {
    errors.push("- release must still be a draft");
  }
  if (latest.version !== tag.slice(1)) {
    errors.push(`- latest.json version must be ${tag.slice(1)}`);
  }

  const assetNames = releaseAssetNames(release.assets, errors);
  if (!assetNames.has("latest.json")) {
    errors.push("- release is missing latest.json");
  }

  const platforms = isRecord(latest.platforms) ? latest.platforms : {};
  if (!isRecord(latest.platforms)) {
    errors.push("- latest.json platforms must be an object");
  }

  for (const platform of REQUIRED_PLATFORMS) {
    const entry = platforms[platform];
    if (!isRecord(entry)) {
      errors.push(`- latest.json is missing platform ${platform}`);
      continue;
    }

    if (
      typeof entry.signature !== "string" ||
      entry.signature.trim().length === 0 ||
      entry.signature.length > MAX_SIGNATURE_LENGTH
    ) {
      errors.push(`- ${platform} does not have a valid updater signature`);
    }

    const assetName = updaterAssetName(entry.url, tag);
    if (!assetName) {
      errors.push(`- ${platform} does not reference this repository and tag`);
      continue;
    }
    if (!assetNames.has(assetName)) {
      errors.push(`- ${platform} references missing release asset ${assetName}`);
    }
    if (!assetNames.has(`${assetName}.sig`)) {
      errors.push(`- ${platform} is missing release signature ${assetName}.sig`);
    }
  }

  return errors;
}

function releaseAssetNames(assets, errors) {
  if (!Array.isArray(assets)) {
    errors.push("- release assets must be an array");
    return new Set();
  }

  return new Set(
    assets.flatMap((asset) =>
      isRecord(asset) &&
      typeof asset.name === "string" &&
      asset.name.length > 0 &&
      asset.name.length <= 512
        ? [asset.name]
        : [],
    ),
  );
}

function updaterAssetName(value, tag) {
  if (typeof value !== "string" || value.length > 2_048) return undefined;

  try {
    const url = new URL(value);
    const expectedPrefix = `${RELEASE_PATH_PREFIX}${tag}/`;
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      !url.pathname.startsWith(expectedPrefix)
    ) {
      return undefined;
    }

    const encodedName = url.pathname.slice(expectedPrefix.length);
    if (!encodedName || encodedName.includes("/")) return undefined;
    return decodeURIComponent(encodedName);
  } catch {
    return undefined;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
