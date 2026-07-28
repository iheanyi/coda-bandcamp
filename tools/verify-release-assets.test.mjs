import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";

const scriptPath = join(process.cwd(), "tools", "verify-release-assets.mjs");
const temporaryDirectories = [];
const requiredPlatforms = [
  "darwin-aarch64",
  "darwin-x86_64",
  "linux-x86_64",
  "windows-x86_64",
];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createReleaseFiles(transformLatest = (latest) => latest) {
  const root = mkdtempSync(join(tmpdir(), "coda-release-assets-"));
  temporaryDirectories.push(root);
  const assets = ["latest.json"];
  const platforms = Object.fromEntries(
    requiredPlatforms.map((platform) => {
      const extension = platform.startsWith("windows")
        ? "exe"
        : platform.startsWith("linux")
          ? "AppImage"
          : "app.tar.gz";
      const assetName = `Coda_1.2.3_${platform}.${extension}`;
      assets.push(assetName, `${assetName}.sig`);
      return [
        platform,
        {
          signature: `signature-for-${platform}`,
          url: `https://github.com/iheanyi/coda-bandcamp/releases/download/v1.2.3/${assetName}`,
        },
      ];
    }),
  );
  const latestPath = join(root, "latest.json");
  const releasePath = join(root, "release.json");
  const releaseAssets = assets.map((name, index) => ({
    apiUrl: `https://api.github.com/repos/iheanyi/coda-bandcamp/releases/assets/${10_000 + index}`,
    name,
  }));
  const assetApiUrls = new Map(
    releaseAssets.map((asset) => [asset.name, asset.apiUrl]),
  );

  writeFileSync(
    latestPath,
    JSON.stringify(
      transformLatest(
        {
          version: "1.2.3",
          notes: "Release notes",
          pub_date: "2026-07-28T00:00:00Z",
          platforms,
        },
        assetApiUrls,
      ),
    ),
  );
  writeFileSync(
    releasePath,
    JSON.stringify({
      isDraft: true,
      tagName: "v1.2.3",
      assets: releaseAssets,
    }),
  );

  return { latestPath, releasePath };
}

function runVerifier(latestPath, releasePath, tag = "v1.2.3") {
  return spawnSync(
    process.execPath,
    [scriptPath, tag, latestPath, releasePath],
    { encoding: "utf8" },
  );
}

test("accepts a complete draft with every signed updater platform", () => {
  const { latestPath, releasePath } = createReleaseFiles();

  const result = runVerifier(latestPath, releasePath);

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(
    /Verified signed updater assets for 4 platforms in v1\.2\.3\./,
  );
});

test("accepts updater API URLs owned by assets in the same draft", () => {
  const { latestPath, releasePath } = createReleaseFiles(
    (latest, assetApiUrls) => {
      for (const entry of Object.values(latest.platforms)) {
        const assetName = decodeURIComponent(
          new URL(entry.url).pathname.split("/").at(-1),
        );
        entry.url = assetApiUrls.get(assetName);
      }
      return latest;
    },
  );

  const result = runVerifier(latestPath, releasePath);

  expect(result.status, result.stderr).toBe(0);
});

test("rejects a missing platform before publication", () => {
  const { latestPath, releasePath } = createReleaseFiles((latest) => {
    delete latest.platforms["windows-x86_64"];
    return latest;
  });

  const result = runVerifier(latestPath, releasePath);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(
    /latest\.json is missing platform windows-x86_64/,
  );
});

test("rejects unsigned, missing, or off-repository updater assets", () => {
  const { latestPath, releasePath } = createReleaseFiles((latest) => {
    latest.platforms["darwin-aarch64"].signature = "";
    latest.platforms["linux-x86_64"].url =
      "https://example.test/Coda_1.2.3_linux-x86_64.AppImage";
    latest.platforms["darwin-x86_64"].url =
      "https://api.github.com/repos/iheanyi/coda-bandcamp/releases/assets/999999";
    latest.platforms["windows-x86_64"].url =
      "https://github.com/iheanyi/coda-bandcamp/releases/download/v1.2.3/missing.exe";
    return latest;
  });

  const result = runVerifier(latestPath, releasePath);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "darwin-aarch64 does not have a valid updater signature",
  );
  expect(result.stderr).toContain(
    "linux-x86_64 does not reference this repository and tag",
  );
  expect(result.stderr).toContain(
    "darwin-x86_64 does not reference this repository and tag",
  );
  expect(result.stderr).toContain(
    "windows-x86_64 references missing release asset missing.exe",
  );
});
