import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "prepare-release.mjs",
);
const gitIntegrationTestTimeout = 20_000;
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function run(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    ...options,
  });

  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      [
        `Command failed: ${command} ${arguments_.join(" ")}`,
        result.stdout,
        result.stderr,
      ].join("\n"),
    );
  }

  return result;
}

function git(root, ...arguments_) {
  return run("git", arguments_, { cwd: root }).stdout.trim();
}

function writeRepositoryFiles(root, version = "0.1.0") {
  mkdirSync(join(root, "src-tauri"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify(
      {
        name: "coda-bandcamp-desktop",
        private: true,
        version,
        scripts: { test: "vitest run" },
        dependencies: { react: "^19.0.0" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "package-lock.json"),
    `${JSON.stringify(
      {
        name: "coda-bandcamp-desktop",
        version,
        lockfileVersion: 3,
        packages: {
          "": {
            name: "coda-bandcamp-desktop",
            version,
            dependencies: { react: "^19.0.0" },
          },
          "node_modules/react": {
            version: "19.1.0",
            resolved: "https://registry.example.test/react-19.1.0.tgz",
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify(
      {
        productName: "Coda",
        version,
        identifier: "com.coda.bandcamp",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.toml"),
    `[package]
name = "coda"
version = "${version}"
description = "Coda desktop player"

[dependencies]
serde = "1"
`,
  );
  writeFileSync(
    join(root, "src-tauri", "Cargo.lock"),
    `version = 4

[[package]]
name = "coda"
version = "${version}"
dependencies = [
 "serde",
]

[[package]]
name = "serde"
version = "1.0.228"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "fixture-checksum"

[[package]]
name = "unrelated-fixture"
version = "${version}"
`,
  );
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), "coda-prepare-release-"));
  const remoteParent = mkdtempSync(join(tmpdir(), "coda-release-origin-"));
  const remote = join(remoteParent, "origin.git");
  temporaryDirectories.push(root, remoteParent);

  run("git", ["init", "--bare", remote]);
  run("git", ["init", "--initial-branch=main", root]);
  git(root, "config", "user.name", "Release Test");
  git(root, "config", "user.email", "release-test@example.test");
  writeRepositoryFiles(root);
  git(root, "add", ".");
  git(root, "commit", "-m", "Initial Coda");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-u", "origin", "main");

  return { root, remote };
}

function prepareRelease(
  root,
  {
    event = "workflow_dispatch",
    releaseType = "patch",
    tag = "",
    runId = "1001",
    branch = "main",
    allowFailure = false,
  } = {},
) {
  const githubOutput = join(root, "github-output.txt");
  const arguments_ = [
    scriptPath,
    "--event",
    event,
    "--release-type",
    releaseType,
    "--tag",
    tag,
    "--run-id",
    runId,
    "--branch",
    branch,
    "--repository-root",
    root,
    "--github-output",
    githubOutput,
  ];
  const result = run(process.execPath, arguments_, {
    cwd: root,
    allowFailure,
  });

  return {
    ...result,
    output:
      result.status === 0 && result.stdout.trim()
        ? JSON.parse(result.stdout)
        : undefined,
    githubOutput:
      result.status === 0 ? readFileSync(githubOutput, "utf8") : undefined,
  };
}

function readVersions(root) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json")));
  const packageLock = JSON.parse(readFileSync(join(root, "package-lock.json")));
  const tauriConfig = JSON.parse(
    readFileSync(join(root, "src-tauri", "tauri.conf.json")),
  );
  const cargoManifest = readFileSync(
    join(root, "src-tauri", "Cargo.toml"),
    "utf8",
  );
  const cargoLock = readFileSync(
    join(root, "src-tauri", "Cargo.lock"),
    "utf8",
  );

  return {
    packageJson: packageJson.version,
    packageLock: packageLock.version,
    packageLockRoot: packageLock.packages[""].version,
    tauriConfig: tauriConfig.version,
    cargoManifest: /^\s*version = "([^"]+)"$/m.exec(cargoManifest)?.[1],
    cargoLock:
      /\[\[package\]\]\nname = "coda"\nversion = "([^"]+)"/.exec(
        cargoLock,
      )?.[1],
  };
}

test("creates the first stable release from the existing manifest version", () => {
  const { root, remote } = createRepository();
  const originalCommit = git(root, "rev-parse", "HEAD");

  const result = prepareRelease(root, { releaseType: "major", runId: "4100" });

  expect(result.output).toEqual({
    version: "0.1.0",
    tag: "v0.1.0",
    commit_sha: originalCommit,
  });
  expect(result.githubOutput).toBe(
    `version=0.1.0\ntag=v0.1.0\ncommit_sha=${originalCommit}\n`,
  );
  expect(readVersions(root)).toEqual({
    packageJson: "0.1.0",
    packageLock: "0.1.0",
    packageLockRoot: "0.1.0",
    tauriConfig: "0.1.0",
    cargoManifest: "0.1.0",
    cargoLock: "0.1.0",
  });
  expect(git(root, "tag", "--list")).toBe("v0.1.0");
  expect(git(root, "for-each-ref", "--format=%(contents)", "refs/tags/v0.1.0")).toContain(
    "coda-release-run:4100",
  );
  expect(
    run("git", ["--git-dir", remote, "rev-parse", "refs/tags/v0.1.0^{commit}"])
      .stdout,
  ).toContain(originalCommit);
}, gitIntegrationTestTimeout);

test("applies patch, minor, and major bumps across every Coda manifest", () => {
  const { root } = createRepository();
  prepareRelease(root, { runId: "4200" });

  const patch = prepareRelease(root, {
    releaseType: "patch",
    runId: "4201",
  }).output;
  expect(patch.version).toBe("0.1.1");
  expect(new Set(Object.values(readVersions(root)))).toEqual(new Set(["0.1.1"]));

  const minor = prepareRelease(root, {
    releaseType: "minor",
    runId: "4202",
  }).output;
  expect(minor.version).toBe("0.2.0");
  expect(new Set(Object.values(readVersions(root)))).toEqual(new Set(["0.2.0"]));

  const major = prepareRelease(root, {
    releaseType: "major",
    runId: "4203",
  }).output;
  expect(major.version).toBe("1.0.0");
  expect(new Set(Object.values(readVersions(root)))).toEqual(new Set(["1.0.0"]));

  const packageLock = JSON.parse(
    readFileSync(join(root, "package-lock.json"), "utf8"),
  );
  expect(packageLock.packages["node_modules/react"]).toEqual({
    version: "19.1.0",
    resolved: "https://registry.example.test/react-19.1.0.tgz",
  });
  expect(
    readFileSync(join(root, "src-tauri", "Cargo.lock"), "utf8"),
  ).toContain(`name = "unrelated-fixture"\nversion = "0.1.0"`);
}, gitIntegrationTestTimeout);

test("reuses the exact tag and commit when the same workflow run is rerun", () => {
  const { root } = createRepository();
  prepareRelease(root, { runId: "4300" });
  const originalDispatchCommit = git(root, "rev-parse", "HEAD");
  const patch = prepareRelease(root, {
    releaseType: "patch",
    runId: "4301",
  }).output;

  git(root, "checkout", "--detach", originalDispatchCommit);
  const rerun = prepareRelease(root, {
    releaseType: "major",
    runId: "4301",
  }).output;

  expect(rerun).toEqual(patch);
  expect(git(root, "tag", "--list", "v*")).toBe("v0.1.0\nv0.1.1");

  const supersededRerun = prepareRelease(root, {
    runId: "4300",
    allowFailure: true,
  });
  expect(supersededRerun.status).not.toBe(0);
  expect(supersededRerun.stderr).toMatch(/superseded/i);
}, gitIntegrationTestTimeout);

test("validates exact pushed tags without changing repository state", () => {
  const { root } = createRepository();
  const commit = git(root, "rev-parse", "HEAD");
  git(root, "tag", "-a", "v0.1.0", "-m", "Manual v0.1.0");
  git(root, "push", "origin", "refs/tags/v0.1.0");

  const result = prepareRelease(root, {
    event: "push",
    tag: "v0.1.0",
    runId: "4400",
  });

  expect(result.output).toEqual({
    version: "0.1.0",
    tag: "v0.1.0",
    commit_sha: commit,
  });
  expect(git(root, "status", "--short", "--untracked-files=no")).toBe("");
}, gitIntegrationTestTimeout);

test("rejects superseded tags and tags whose commits are not on main", () => {
  const { root } = createRepository();
  prepareRelease(root, { runId: "4450" });
  prepareRelease(root, { runId: "4451" });

  const supersededTag = prepareRelease(root, {
    event: "push",
    tag: "v0.1.0",
    runId: "4452",
    allowFailure: true,
  });
  expect(supersededTag.status).not.toBe(0);
  expect(supersededTag.stderr).toMatch(/latest stable tag/i);

  git(root, "checkout", "-b", "feature-release");
  writeRepositoryFiles(root, "0.2.0");
  git(root, "add", ".");
  git(root, "commit", "-m", "Feature release fixture");
  git(root, "tag", "-a", "v0.2.0", "-m", "Feature v0.2.0");
  git(root, "push", "origin", "refs/tags/v0.2.0");

  const featureTag = prepareRelease(root, {
    event: "push",
    tag: "v0.2.0",
    runId: "4453",
    allowFailure: true,
  });
  expect(featureTag.status).not.toBe(0);
  expect(featureTag.stderr).toMatch(/main/i);
}, gitIntegrationTestTimeout);

test("rejects invalid inputs and manifest drift without moving refs", () => {
  const invalidCases = [
    { releaseType: "beta" },
    { branch: "feature/not-main" },
    { event: "push", tag: "v1.2.3-beta.1" },
    { event: "push", tag: "1.2.3" },
  ];

  for (const [index, options] of invalidCases.entries()) {
    const { root, remote } = createRepository();
    const mainBefore = run("git", [
      "--git-dir",
      remote,
      "rev-parse",
      "refs/heads/main",
    ]).stdout.trim();

    const result = prepareRelease(root, {
      ...options,
      runId: `450${index}`,
      allowFailure: true,
    });

    expect(result.status, JSON.stringify(options)).not.toBe(0);
    expect(
      run("git", ["--git-dir", remote, "rev-parse", "refs/heads/main"]).stdout,
    ).toContain(mainBefore);
    expect(run("git", ["--git-dir", remote, "tag", "--list"]).stdout).toBe("");
  }

  const { root, remote } = createRepository();
  const packageLockPath = join(root, "package-lock.json");
  const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
  packageLock.packages[""].version = "9.9.9";
  writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
  git(root, "add", "package-lock.json");
  git(root, "commit", "-m", "Introduce fixture version drift");
  git(root, "push", "origin", "main");

  const driftResult = prepareRelease(root, {
    runId: "4599",
    allowFailure: true,
  });

  expect(driftResult.status).not.toBe(0);
  expect(driftResult.stderr).toMatch(/version mismatch/i);
  expect(run("git", ["--git-dir", remote, "tag", "--list"]).stdout).toBe("");
}, gitIntegrationTestTimeout);
