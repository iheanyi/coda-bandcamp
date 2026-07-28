import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-release-version.mjs",
);
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository({
  packageVersion = "1.2.3",
  packageLockVersion = packageVersion,
  packageLockEntryVersion = packageVersion,
  tauriVersion = packageVersion,
  cargoVersion = packageVersion,
  cargoLockVersion = packageVersion,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "coda-release-version-"));
  temporaryDirectories.push(root);
  mkdirSync(join(root, "src-tauri"), { recursive: true });

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "coda-bandcamp-desktop",
      version: packageVersion,
    }),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      name: "coda-bandcamp-desktop",
      version: packageLockVersion,
      lockfileVersion: 3,
      packages: {
        "": {
          name: "coda-bandcamp-desktop",
          version: packageLockEntryVersion,
        },
      },
    }),
  );
  writeFileSync(
    join(root, "src-tauri", "tauri.conf.json"),
    JSON.stringify({
      productName: "Coda",
      version: tauriVersion,
    }),
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.toml"),
    `[package]
name = "coda"
version = "${cargoVersion}"

[dependencies]
serde = "1"
`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.lock"),
    `version = 4

[[package]]
name = "coda"
version = "${cargoLockVersion}"

[[package]]
name = "serde"
version = "1.0.0"
`,
  );

  return root;
}

function runValidator(tag, root) {
  return spawnSync(process.execPath, [scriptPath, tag, root], {
    encoding: "utf8",
  });
}

test("accepts an exact release tag when every Coda version matches", () => {
  const root = createRepository();

  const result = runValidator("v1.2.3", root);

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(
    /Release version 1\.2\.3 matches all manifests\./,
  );
  expect(result.stderr).toBe("");
});

test("rejects malformed and non-release SemVer tags", () => {
  const root = createRepository();

  for (const tag of [
    "1.2.3",
    "v1.2",
    "v1.2.3-beta.1",
    "v1.2.3+build.4",
    "v01.2.3",
    "v1.02.3",
    "v1.2.03",
    "v1.2.3\n",
  ]) {
    const result = runValidator(tag, root);

    expect(
      result.status,
      `expected ${JSON.stringify(tag)} to fail`,
    ).not.toBe(0);
    expect(result.stderr).toMatch(/Expected an exact vX\.Y\.Z release tag/);
  }
});

test("reports every manifest and lockfile version that does not match the tag", () => {
  const root = createRepository({
    packageVersion: "1.0.0",
    packageLockVersion: "1.0.1",
    packageLockEntryVersion: "1.0.2",
    tauriVersion: "1.0.3",
    cargoVersion: "1.0.4",
    cargoLockVersion: "1.0.5",
  });

  const result = runValidator("v2.0.0", root);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(
    /package\.json version: expected 2\.0\.0, found 1\.0\.0/,
  );
  expect(result.stderr).toMatch(
    /package-lock\.json root version: expected 2\.0\.0, found 1\.0\.1/,
  );
  expect(result.stderr).toMatch(
    /package-lock\.json packages\[""\] version: expected 2\.0\.0, found 1\.0\.2/,
  );
  expect(result.stderr).toMatch(
    /src-tauri\/tauri\.conf\.json version: expected 2\.0\.0, found 1\.0\.3/,
  );
  expect(result.stderr).toMatch(
    /src-tauri\/Cargo\.toml package version: expected 2\.0\.0, found 1\.0\.4/,
  );
  expect(result.stderr).toMatch(
    /src-tauri\/Cargo\.lock coda version: expected 2\.0\.0, found 1\.0\.5/,
  );
});
