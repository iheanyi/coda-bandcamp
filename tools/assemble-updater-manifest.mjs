#!/usr/bin/env node

import {
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const exactTagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const releaseDownloadPrefix =
  "https://github.com/iheanyi/coda-bandcamp/releases/download";
const maxSignatureLength = 32_768;

try {
  const [tag, releaseArgument, signedAssetArgument, outputArgument, ...extra] =
    process.argv.slice(2);

  if (
    !exactTagPattern.test(tag ?? "") ||
    !releaseArgument ||
    !signedAssetArgument ||
    !outputArgument ||
    extra.length > 0
  ) {
    throw new Error(
      "Expected a vX.Y.Z tag, release metadata path, signed asset directory, and output path.\n" +
        "Usage: node tools/assemble-updater-manifest.mjs v1.2.3 release.json signed-assets latest.json",
    );
  }

  const release = readJson(releaseArgument);
  const signedAssetDirectory = resolve(signedAssetArgument);
  const outputPath = resolve(outputArgument);
  const version = tag.slice(1);
  const errors = [];

  if (!isRecord(release)) {
    throw new Error("release metadata must contain a JSON object");
  }
  if (release.tagName !== tag) {
    errors.push(`release tag must be ${tag}`);
  }
  if (release.isDraft !== true) {
    errors.push("release must still be a draft");
  }

  const releaseAssetNames = readReleaseAssetNames(release.assets, errors);
  const platforms = {};

  for (const definition of updaterDefinitions(version)) {
    const signatureName = `${definition.assetName}.sig`;
    if (!releaseAssetNames.has(definition.assetName)) {
      errors.push(
        `release is missing updater asset ${definition.assetName}`,
      );
    }
    if (!releaseAssetNames.has(signatureName)) {
      errors.push(`release is missing updater signature ${signatureName}`);
    }

    const artifactPath = join(
      signedAssetDirectory,
      definition.assetName,
    );
    const signaturePath = join(signedAssetDirectory, signatureName);
    if (!isNonEmptyRegularFile(artifactPath)) {
      errors.push(
        `downloaded updater asset is missing or empty: ${definition.assetName}`,
      );
      continue;
    }
    if (!isNonEmptyRegularFile(signaturePath)) {
      errors.push(
        `downloaded updater signature is missing or empty: ${signatureName}`,
      );
      continue;
    }

    const signatureSize = lstatSync(signaturePath).size;
    if (signatureSize > maxSignatureLength) {
      errors.push(`updater signature is too large: ${signatureName}`);
      continue;
    }

    const signature = readFileSync(signaturePath, "utf8").trim();
    if (!signature) {
      errors.push(`updater signature is empty: ${signatureName}`);
      continue;
    }

    const entry = {
      signature,
      url: `${releaseDownloadPrefix}/${tag}/${encodeURIComponent(
        definition.assetName,
      )}`,
    };
    for (const platform of definition.platforms) {
      platforms[platform] = { ...entry };
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        version,
        notes: "",
        pub_date: new Date().toISOString(),
        platforms,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `Assembled updater manifest for ${Object.keys(platforms).length} platform entries in ${tag}.\n`,
  );
} catch (error) {
  console.error(
    `Updater manifest assembly failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
}

function updaterDefinitions(version) {
  return [
    {
      assetName: `Coda_${version}_aarch64.app.tar.gz`,
      platforms: ["darwin-aarch64", "darwin-aarch64-app"],
    },
    {
      assetName: `Coda_${version}_x64.app.tar.gz`,
      platforms: ["darwin-x86_64", "darwin-x86_64-app"],
    },
    {
      assetName: `Coda_${version}_amd64.AppImage`,
      platforms: ["linux-x86_64", "linux-x86_64-appimage"],
    },
    {
      assetName: `Coda_${version}_amd64.deb`,
      platforms: ["linux-x86_64-deb"],
    },
    {
      assetName: `Coda-${version}-1.x86_64.rpm`,
      platforms: ["linux-x86_64-rpm"],
    },
    {
      assetName: `Coda_${version}_x64-setup.exe`,
      platforms: ["windows-x86_64", "windows-x86_64-nsis"],
    },
    {
      assetName: `Coda_${version}_x64_en-US.msi`,
      platforms: ["windows-x86_64-msi"],
    },
  ];
}

function readReleaseAssetNames(assets, errors) {
  if (!Array.isArray(assets)) {
    errors.push("release assets must be an array");
    return new Set();
  }

  const names = new Set();
  for (const asset of assets) {
    if (
      !isRecord(asset) ||
      !isString(asset.name) ||
      asset.name.length === 0 ||
      asset.name.length > 512 ||
      basename(asset.name) !== asset.name
    ) {
      errors.push("release contains an invalid asset name");
      continue;
    }
    names.add(asset.name);
  }
  return names;
}

function isNonEmptyRegularFile(path) {
  try {
    const metadata = lstatSync(path);
    return metadata.isFile() && metadata.size > 0;
  } catch {
    return false;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(
      `could not read ${basename(path)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function isRecord(value) {
  return (
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function isString(value) {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    value === String(value)
  );
}
