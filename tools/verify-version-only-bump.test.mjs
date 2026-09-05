import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("./verify-version-only-bump.mjs", import.meta.url),
);
const baseline = {
  "package.json": JSON.stringify({
    name: "coda",
    version: "1.2.3",
    scripts: { build: "vite build" },
    dependencies: { react: "19" },
  }),
  "package-lock.json": JSON.stringify({
    version: "1.2.3",
    packages: {
      "": { name: "coda", version: "1.2.3" },
      "node_modules/react": { version: "19" },
    },
  }),
  "src-tauri/tauri.conf.json": JSON.stringify({
    version: "1.2.3",
    app: { security: { csp: "default-src 'self'" } },
  }),
  "src-tauri/Cargo.toml":
    '[package]\nname = "coda"\nversion = "1.2.3"\n\n[dependencies]\nserde = "1"\n\n[profile.release]\nlto = true\n',
  "src-tauri/Cargo.lock":
    'version = 4\n\n[[package]]\nname = "coda"\nversion = "1.2.3"\ndependencies = ["serde"]\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n',
};

function withRepository(operation) {
  const root = mkdtempSync(join(tmpdir(), "coda-version-guard-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const change = (path, before, after) => {
    const text = readFileSync(join(root, path), "utf8");
    assert.ok(text.includes(before), `Missing fixture text in ${path}`);
    write(path, text.replace(before, after));
  };
  const verify = (commit) =>
    spawnSync(process.execPath, [script, commit, root], { encoding: "utf8" });
  try {
    git("init", "--quiet");
    git("config", "user.name", "Coda Test");
    git("config", "user.email", "coda-test@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    for (const [path, text] of Object.entries(baseline)) write(path, text);
    git("add", ".");
    git("commit", "--quiet", "-m", "baseline");
    const parent = git("rev-parse", "HEAD");
    for (const [path, text] of Object.entries(baseline))
      write(path, text.replaceAll("1.2.3", "1.2.4"));
    operation({ root, git, write, change, verify, parent });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const [name, mutate] of [
  [
    "scripts",
    ({ change }) => change("package.json", "vite build", "node unsafe.mjs"),
  ],
  [
    "JavaScript dependencies",
    ({ change }) => change("package.json", '"react":"19"', '"react":"20"'),
  ],
  [
    "lockfile dependencies",
    ({ change }) =>
      change("package-lock.json", '"version":"19"', '"version":"20"'),
  ],
  [
    "Tauri security",
    ({ change }) =>
      change(
        "src-tauri/tauri.conf.json",
        "default-src 'self'",
        "default-src *",
      ),
  ],
  [
    "Rust dependencies",
    ({ change }) =>
      change("src-tauri/Cargo.toml", 'serde = "1"', 'serde = "2"'),
  ],
  [
    "release profile",
    ({ change }) => change("src-tauri/Cargo.toml", "lto = true", "lto = false"),
  ],
  [
    "another locked crate version",
    ({ change }) =>
      change("src-tauri/Cargo.lock", 'version = "1.0.0"', 'version = "2.0.0"'),
  ],
  [
    "Coda locked dependencies",
    ({ change }) => change("src-tauri/Cargo.lock", '["serde"]', "[]"),
  ],
  [
    "unsynchronized root package",
    ({ change }) =>
      change(
        "package-lock.json",
        '"name":"coda","version":"1.2.4"',
        '"name":"coda","version":"1.2.5"',
      ),
  ],
  ["source changes", ({ write }) => write("src/main.ts", "changed();")],
  [
    "file mode changes",
    ({ git }) => git("update-index", "--chmod=+x", "package.json"),
  ],
  [
    "version downgrade",
    ({ write }) => {
      for (const [path, text] of Object.entries(baseline))
        write(path, text.replaceAll("1.2.3", "1.2.2"));
    },
  ],
]) {
  test(`rejects a version bump containing ${name}`, () =>
    withRepository((fixture) => {
      // Stage the real bump first so the mode test can change only the index.
      fixture.git("add", ".");
      mutate(fixture);
      if (name !== "file mode changes") fixture.git("add", ".");
      fixture.git("commit", "--quiet", "-m", "bump with unrelated changes");
      const result = fixture.verify(fixture.git("rev-parse", "HEAD"));
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /Version-only verification failed/);
    }));
}

test("accepts a synchronized version bump with JSON reformatting", () =>
  withRepository(({ git, write, verify }) => {
    for (const [path, text] of Object.entries(baseline)) {
      if (path.endsWith(".json"))
        write(
          path,
          JSON.stringify(
            JSON.parse(text.replaceAll("1.2.3", "1.2.4")),
            null,
            2,
          ),
        );
    }
    git("add", ".");
    git("commit", "--quiet", "-m", "Release v1.2.4");
    const result = verify(git("rev-parse", "HEAD"));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /1\.2\.3 -> 1\.2\.4/);
  }));

test("rejects initial commits and merges even when manifests look like a bump", () =>
  withRepository(({ git, verify, parent }) => {
    assert.equal(verify(parent).status, 1);
    git("add", ".");
    git("commit", "--quiet", "-m", "Release v1.2.4");
    const bumped = git("rev-parse", "HEAD");
    const merge = git(
      "commit-tree",
      `${bumped}^{tree}`,
      "-p",
      parent,
      "-p",
      bumped,
      "-m",
      "merge",
    );
    const result = verify(merge);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly one parent/);
  }));
