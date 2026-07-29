import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";

const scriptPath = join(
  process.cwd(),
  "tools",
  "assemble-updater-manifest.mjs",
);
const temporaryDirectories = [];
const version = "1.2.3";
const tag = `v${version}`;
const updaterAssets = [
  "Coda_1.2.3_aarch64.app.tar.gz",
  "Coda_1.2.3_x64.app.tar.gz",
  "Coda_1.2.3_amd64.AppImage",
  "Coda_1.2.3_amd64.deb",
  "Coda-1.2.3-1.x86_64.rpm",
  "Coda_1.2.3_x64-setup.exe",
  "Coda_1.2.3_x64_en-US.msi",
];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createFixture({ releaseTag = tag, omittedAsset } = {}) {
  const root = mkdtempSync(join(tmpdir(), "coda-updater-manifest-"));
  temporaryDirectories.push(root);
  const signedAssetDirectory = join(root, "signed-assets");
  const releasePath = join(root, "release.json");
  const outputPath = join(root, "latest.json");
  mkdirSync(signedAssetDirectory);

  const assetNames = [];
  for (const assetName of updaterAssets) {
    if (assetName === omittedAsset) continue;

    writeFileSync(join(signedAssetDirectory, assetName), "artifact");
    writeFileSync(
      join(signedAssetDirectory, `${assetName}.sig`),
      `signature-for-${assetName}\n`,
    );
    assetNames.push(assetName, `${assetName}.sig`);
  }

  writeFileSync(
    releasePath,
    JSON.stringify({
      assets: assetNames.map((name) => ({ name })),
      isDraft: true,
      tagName: releaseTag,
    }),
  );

  return { outputPath, releasePath, signedAssetDirectory };
}

function runAssembler(fixture, releaseTag = tag) {
  return spawnSync(
    process.execPath,
    [
      scriptPath,
      releaseTag,
      fixture.releasePath,
      fixture.signedAssetDirectory,
      fixture.outputPath,
    ],
    { encoding: "utf8" },
  );
}

test("assembles one complete updater manifest after every platform build", () => {
  const fixture = createFixture();

  const result = runAssembler(fixture);

  expect(result.status, result.stderr).toBe(0);
  const manifest = JSON.parse(readFileSync(fixture.outputPath, "utf8"));
  expect(manifest.version).toBe(version);
  expect(manifest.notes).toBe("");
  expect(Number.isNaN(Date.parse(manifest.pub_date))).toBe(false);
  expect(Object.keys(manifest.platforms).sort()).toEqual([
    "darwin-aarch64",
    "darwin-aarch64-app",
    "darwin-x86_64",
    "darwin-x86_64-app",
    "linux-x86_64",
    "linux-x86_64-appimage",
    "linux-x86_64-deb",
    "linux-x86_64-rpm",
    "windows-x86_64",
    "windows-x86_64-msi",
    "windows-x86_64-nsis",
  ]);
  expect(manifest.platforms["darwin-aarch64"]).toEqual({
    signature:
      "signature-for-Coda_1.2.3_aarch64.app.tar.gz",
    url: "https://github.com/iheanyi/coda-bandcamp/releases/download/v1.2.3/Coda_1.2.3_aarch64.app.tar.gz",
  });
  expect(manifest.platforms["windows-x86_64"]).toEqual(
    manifest.platforms["windows-x86_64-nsis"],
  );
});

test("refuses to assemble a manifest before every updater artifact is ready", () => {
  const missingAsset = "Coda_1.2.3_aarch64.app.tar.gz";
  const fixture = createFixture({ omittedAsset: missingAsset });

  const result = runAssembler(fixture);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    `release is missing updater asset ${missingAsset}`,
  );
});

test("rejects a draft whose tag does not match the requested release", () => {
  const fixture = createFixture({ releaseTag: "v1.2.4" });

  const result = runAssembler(fixture);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("release tag must be v1.2.3");
});
