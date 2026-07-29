import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildDevEnvironment,
  buildTauriOverride,
  computeCurrentNativeBuildFingerprint,
  computeNativeBuildFingerprint,
  parsePort,
  readRegisteredGroveServer,
  resolveCargoTargetDirectory,
  resolveDevIdentity,
  resolveDevPort,
  runManagedCommand,
  stopStaleNativeDevelopmentProcesses,
} from "./dev-instance.mjs";

const baseConfig = {
  productName: "Coda",
  identifier: "com.coda.bandcamp",
  build: {
    beforeDevCommand: "npm run web:dev",
    devUrl: "http://127.0.0.1:1420",
  },
  app: {
    windows: [
      {
        label: "main",
        title: "Coda",
        minWidth: 760,
        visible: true,
      },
      {
        label: "mini-player",
        title: "Coda Mini Player",
        alwaysOnTop: true,
        visible: false,
      },
    ],
  },
};

test("keeps Grove opt-in for standard desktop development", async () => {
  const packageManifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(packageManifest.scripts.dev, "tauri dev");
  assert.equal(packageManifest.scripts["desktop:dev"], "tauri dev");
  assert.equal(
    packageManifest.scripts["dev:grove"],
    "node tools/dev-instance.mjs",
  );
});

test("stops this worktree's stale native process group from a custom Cargo target", async () => {
  const repository = "/workspace/shadcn-tailwind";
  const expectedExecutable = path.join(
    repository,
    "src-tauri",
    "custom-target",
    "debug",
    "coda-shadcn-tailwind",
  );
  const running = new Set([41, 42, 43]);
  const signaledGroups = [];

  const stopped = await stopStaleNativeDevelopmentProcesses("shadcn-tailwind", {
    cargoTargetDirectory: "custom-target",
    isProcessRunning: (pid) => running.has(pid),
    listProcesses: () => [
      { executablePath: expectedExecutable, parentPid: 900, pid: 41 },
      {
        executablePath:
          "/workspace/other/src-tauri/target/debug/coda-shadcn-tailwind",
        parentPid: 900,
        pid: 42,
      },
      {
        executablePath:
          "/workspace/other/src-tauri/target/debug/coda-shadcn-tailwind",
        parentPid: 1,
        pid: 43,
      },
    ],
    platform: "darwin",
    pollIntervalMs: 0,
    readExecutablePath: () => assert.fail("bulk process data should be reused"),
    readProcessGroupId: (pid) => (pid === process.pid ? 700 : 401),
    repository,
    signalProcessGroup: (processGroupId, signal) => {
      signaledGroups.push([processGroupId, signal]);
      running.delete(41);
    },
    timeoutMs: 20,
  });

  assert.deepEqual(stopped, [41]);
  assert.deepEqual(signaledGroups, [[401, "SIGTERM"]]);
  assert.equal(running.has(42), true);
  assert.equal(running.has(43), true);
});

test("resolves Cargo target directories from the native project", () => {
  const repository = "/workspace/shadcn-tailwind";

  assert.equal(
    resolveCargoTargetDirectory(repository),
    path.join(repository, "src-tauri", "target"),
  );
  assert.equal(
    resolveCargoTargetDirectory(repository, "custom-target"),
    path.join(repository, "src-tauri", "custom-target"),
  );
  assert.equal(
    resolveCargoTargetDirectory(repository, "/tmp/coda-target"),
    "/tmp/coda-target",
  );
});

async function waitFor(check, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

function isRunning(pid) {
  try {
    const state = execFileSync("ps", ["-o", "state=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return state !== "" && !state.startsWith("Z");
  } catch {
    return false;
  }
}

async function createRunnerFixture() {
  const fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "coda-dev-runner-"),
  );
  const targetDirectory = path.join(fixtureDirectory, "target", "debug");
  const fakeBinDirectory = path.join(fixtureDirectory, "bin");
  const executable = path.join(targetDirectory, "coda");
  const codesignLog = path.join(fixtureDirectory, "codesign.log");
  await mkdir(targetDirectory, { recursive: true });
  await mkdir(fakeBinDirectory);
  await writeFile(executable, "#!/bin/sh\nprintf 'fixture launched\\n'\n");
  await chmod(executable, 0o755);
  await writeFile(
    path.join(fakeBinDirectory, "security"),
    `#!/bin/sh
printf '  1) %s "Coda Local Development"\\n' "$CODA_TEST_IDENTITY_HASH"
`,
  );
  await writeFile(
    path.join(fakeBinDirectory, "codesign"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$CODA_TEST_CODESIGN_LOG"
if [ "\${1:-}" = "--force" ] &&
  [ -n "\${CODA_TEST_CODESIGN_BLOCK_MARKER:-}" ]; then
  : >"$CODA_TEST_CODESIGN_BLOCK_MARKER"
  while [ ! -e "$CODA_TEST_CODESIGN_RELEASE" ]; do
    sleep 0.02
  done
fi
if [ "\${1:-}" = "--verify" ] &&
  [ -n "\${CODA_TEST_FAIL_VERIFY_ONCE:-}" ] &&
  [ ! -e "$CODA_TEST_FAIL_VERIFY_ONCE" ]; then
  : >"$CODA_TEST_FAIL_VERIFY_ONCE"
  exit 1
fi
`,
  );
  await chmod(path.join(fakeBinDirectory, "security"), 0o755);
  await chmod(path.join(fakeBinDirectory, "codesign"), 0o755);

  return {
    codesignLog,
    environment: {
      ...process.env,
      CARGO_TARGET_DIR: path.join(fixtureDirectory, "target"),
      CODA_DEV_EXECUTABLE_SLUG: "fixture",
      CODA_DEV_NATIVE_FINGERPRINT: "b".repeat(64),
      CODA_DEV_NATIVE_OVERRIDE: JSON.stringify({
        identifier: "com.coda.bandcamp",
      }),
      CODA_LASTFM_API_KEY: "fixture-api-secret",
      CODA_LASTFM_SHARED_SECRET: "fixture-shared-secret",
      CODA_TEST_CODESIGN_LOG: codesignLog,
      CODA_TEST_IDENTITY_HASH: "A".repeat(40),
      PATH: `${fakeBinDirectory}:${process.env.PATH}`,
    },
    executable,
    fixtureDirectory,
  };
}

test("keeps the stable Tauri identifier without dropping window settings", () => {
  const identity = resolveDevIdentity({
    branch: "codex/shadcn-tailwind",
    portValue: "3421",
    worktreeName: "shadcn-tailwind",
  });
  const override = buildTauriOverride(baseConfig, identity);

  assert.deepEqual(identity, {
    displayName: "Coda Shadcn Tailwind",
    executableSlug: "shadcn-tailwind",
    port: 3421,
    slug: "shadcn-tailwind",
  });
  assert.equal(override.identifier, "com.coda.bandcamp");
  assert.equal(override.build.devUrl, "http://127.0.0.1:3421");
  assert.equal(override.app.windows[0].title, "Coda Shadcn Tailwind");
  assert.equal(override.app.windows[0].minWidth, 760);
  assert.equal(
    override.app.windows[1].title,
    "Coda Shadcn Tailwind Mini Player",
  );
  assert.equal(override.app.windows[1].alwaysOnTop, true);
});

test("uses an explicit instance name and validates Grove's port", () => {
  assert.deepEqual(
    resolveDevIdentity({
      branch: "main",
      instanceOverride: "Chrome Review",
      portValue: "3381",
      worktreeName: "coda-bandcamp",
    }),
    {
      displayName: "Coda Chrome Review",
      executableSlug: "coda-bandcamp",
      port: 3381,
      slug: "chrome-review",
    },
  );
  assert.throws(() => parsePort(undefined), /grove start/i);
  assert.throws(() => parsePort("0"), /between 1 and 65535/);
  assert.throws(() => parsePort("65536"), /between 1 and 65535/);
  assert.throws(() => parsePort("abc"), /integer/);
});

test("standalone development reuses the worktree port before the base fallback", () => {
  assert.equal(
    resolveDevPort({
      baseDevUrl: "http://127.0.0.1:1420",
      grovePort: 3347,
      portValue: undefined,
    }),
    3347,
  );
  assert.equal(
    resolveDevPort({
      baseDevUrl: "http://127.0.0.1:1420",
      grovePort: 3347,
      portValue: "4400",
    }),
    4400,
  );
  assert.equal(
    resolveDevPort({
      baseDevUrl: "http://127.0.0.1:1420",
      grovePort: undefined,
      portValue: undefined,
    }),
    1420,
  );
});

test("reads only the current worktree's registered Grove development server", () => {
  const repository = path.join(tmpdir(), "coda-grove-port");
  const readCommand = () =>
    JSON.stringify({
      name: "coda-grove-port",
      port: 3347,
      status: "stopped",
      url: "http://localhost:3347",
    });

  assert.deepEqual(readRegisteredGroveServer(repository, readCommand), {
    port: 3347,
    running: false,
  });
  assert.equal(
    readRegisteredGroveServer(repository, () =>
      JSON.stringify({
        port: "not-a-port",
        status: "stopped",
      }),
    ),
    undefined,
  );
  assert.equal(
    readRegisteredGroveServer(repository, () => {
      throw new Error("grove is unavailable");
    }),
    undefined,
  );
});

test("reuses the worktree executable across one-off native test labels", () => {
  const smoke = resolveDevIdentity({
    branch: "codex/shadcn-tailwind",
    instanceOverride: "Shadcn Smoke",
    portValue: "3381",
    worktreeName: "shadcn-tailwind",
  });
  const finalReview = resolveDevIdentity({
    branch: "codex/renamed-ui-branch",
    instanceOverride: "Shadcn Final",
    portValue: "3381",
    worktreeName: "shadcn-tailwind",
  });
  const otherWorktree = resolveDevIdentity({
    branch: "codex/shadcn-tailwind-copy",
    instanceOverride: "Shadcn Smoke",
    portValue: "3383",
    worktreeName: "shadcn-tailwind-copy",
  });

  assert.notEqual(smoke.slug, finalReview.slug);
  assert.equal(smoke.executableSlug, "shadcn-tailwind");
  assert.equal(finalReview.executableSlug, smoke.executableSlug);
  assert.notEqual(otherWorktree.executableSlug, smoke.executableSlug);
  assert.equal(
    buildDevEnvironment({}, smoke).CODA_DEV_EXECUTABLE_SLUG,
    buildDevEnvironment({}, finalReview).CODA_DEV_EXECUTABLE_SLUG,
  );
  assert.deepEqual(
    buildTauriOverride(baseConfig, smoke),
    buildTauriOverride(baseConfig, finalReview),
  );
  assert.equal(
    buildTauriOverride(baseConfig, smoke).identifier,
    "com.coda.bandcamp",
  );
});

test("builds the environment consumed by Vite and the macOS runner", () => {
  const environment = buildDevEnvironment(
    { EXISTING_VALUE: "kept" },
    {
      displayName: "Coda Main",
      executableSlug: "main",
      port: 3381,
      slug: "main",
    },
    { identifier: "com.coda.bandcamp" },
  );

  assert.equal(environment.EXISTING_VALUE, "kept");
  assert.equal(environment.PORT, "3381");
  assert.equal(environment.VITE_CODA_APP_NAME, "Coda Main");
  assert.equal(environment.CODA_DEV_INSTANCE_SLUG, "main");
  assert.equal(environment.CODA_DEV_EXECUTABLE_SLUG, "main");
  assert.deepEqual(JSON.parse(environment.CODA_DEV_NATIVE_OVERRIDE), {
    identifier: "com.coda.bandcamp",
  });
  assert.equal(environment.CODA_DEV_NATIVE_FINGERPRINT, undefined);
});

test(
  "rebuilds native code before adopting or replacing an approved executable",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;
    const cargoExecutable = path.join(fixture.fixtureDirectory, "bin", "cargo");
    const cachedExecutable = path.join(
      path.dirname(fixture.executable),
      "coda-fixture",
    );
    const fingerprintFile = `${cachedExecutable}.native-fingerprint`;
    const observedFingerprint = path.join(
      fixture.fixtureDirectory,
      "observed-fingerprint",
    );

    try {
      await writeFile(cachedExecutable, await readFile(fixture.executable));
      await chmod(cachedExecutable, 0o755);
      await writeFile(fingerprintFile, `${"a".repeat(64)}\n`);
      await writeFile(
        cargoExecutable,
        `#!/bin/sh
if [ "\${1:-}" = "-V" ]; then
  printf 'cargo 1.97.1\\n'
  exit 0
fi
printf '%s\\n' "$CODA_DEV_NATIVE_FINGERPRINT" >"$CODA_TEST_OBSERVED_FINGERPRINT"
printf '%s\\n' '#!/bin/sh' "printf 'rebuilt fixture launched\\\\n'" >"$CARGO_TARGET_DIR/debug/coda"
chmod +x "$CARGO_TARGET_DIR/debug/coda"
exec "$CODA_TEST_RUNNER" "$CARGO_TARGET_DIR/debug/coda"
`,
      );
      await chmod(cargoExecutable, 0o755);
      const output = execFileSync(runner, ["run", "--version"], {
        encoding: "utf8",
        env: {
          ...fixture.environment,
          CODA_TEST_OBSERVED_FINGERPRINT: observedFingerprint,
          CODA_TEST_RUNNER: runner,
        },
      });
      const fingerprint = await readFile(observedFingerprint, "utf8");
      const codesignCalls = (await readFile(fixture.codesignLog, "utf8"))
        .split("\n")
        .filter((line) => line.includes(`--sign ${"A".repeat(40)}`));

      assert.equal(output, "rebuilt fixture launched\n");
      assert.match(fingerprint, /^[0-9a-f]{64}\n$/);
      assert.equal(output.includes("fixture-api-secret"), false);
      assert.equal(output.includes("fixture-shared-secret"), false);
      assert.equal(
        await readFile(fingerprintFile, "utf8"),
        `coda-dev-native-fingerprint-v2\n${fingerprint}`,
      );
      assert.equal(codesignCalls.length, 1, codesignCalls.join("\n"));
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test("keeps credentials shared while giving macOS instances distinct processes", async () => {
  const rust = await readFile(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  const runner = await readFile(
    new URL("../src-tauri/coda-dev-runner.sh", import.meta.url),
    "utf8",
  );

  assert.match(rust, /SERVICE_NAME: &str = "com\.coda\.bandcamp"/);
  assert.match(rust, /LASTFM_SERVICE_NAME: &str = "com\.coda\.lastfm"/);
  assert.match(runner, /signing_identifier="com\.coda\.bandcamp"/);
  assert.match(runner, /executable_slug="\$\{CODA_DEV_EXECUTABLE_SLUG:-\}"/);
  assert.match(runner, /instance_executable=.*\/coda-\$executable_slug"/);
  assert.match(runner, /compute_native_fingerprint/);
  assert.doesNotMatch(runner, /raw_hash/);
  assert.doesNotMatch(runner, /\/coda-\$instance_slug"/);
});

test(
  "reuses an unchanged signed worktree executable",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;

    try {
      const firstOutput = execFileSync(runner, [fixture.executable], {
        encoding: "utf8",
        env: fixture.environment,
      });
      const cachedExecutable = path.join(
        path.dirname(fixture.executable),
        "coda-fixture",
      );
      const firstStat = await stat(cachedExecutable);
      const secondOutput = execFileSync(runner, [fixture.executable], {
        encoding: "utf8",
        env: fixture.environment,
      });
      const secondStat = await stat(cachedExecutable);
      const codesignCalls = (await readFile(fixture.codesignLog, "utf8"))
        .split("\n")
        .filter((line) => line.includes(`--sign ${"A".repeat(40)}`));
      const cacheArtifacts = `${await readFile(
        `${cachedExecutable}.native-fingerprint`,
        "utf8",
      )}\n${await readFile(fixture.codesignLog, "utf8")}`;

      assert.equal(firstOutput, "fixture launched\n");
      assert.equal(secondOutput, firstOutput);
      assert.equal(codesignCalls.length, 1);
      assert.equal(secondStat.ino, firstStat.ino);
      assert.equal(secondStat.mtimeMs, firstStat.mtimeMs);
      assert.equal(cacheArtifacts.includes("fixture-api-secret"), false);
      assert.equal(cacheArtifacts.includes("fixture-shared-secret"), false);
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "adopts an existing matching approved executable without replacing it",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;
    const cachedExecutable = path.join(
      path.dirname(fixture.executable),
      "coda-fixture",
    );

    try {
      await writeFile(cachedExecutable, await readFile(fixture.executable));
      await chmod(cachedExecutable, 0o755);
      const before = await stat(cachedExecutable);

      execFileSync(runner, [fixture.executable], {
        env: fixture.environment,
      });

      const after = await stat(cachedExecutable);
      const codesignCalls = (await readFile(fixture.codesignLog, "utf8"))
        .split("\n")
        .filter((line) => line.includes(`--sign ${"A".repeat(40)}`));
      const fingerprint = await readFile(
        `${cachedExecutable}.native-fingerprint`,
        "utf8",
      );

      assert.equal(codesignCalls.length, 0);
      assert.equal(after.ino, before.ino);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(
        fingerprint,
        `coda-dev-native-fingerprint-v2\n${"b".repeat(64)}\n`,
      );
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "migrates a matching legacy fingerprint without replacing the approved executable",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;
    const cachedExecutable = path.join(
      path.dirname(fixture.executable),
      "coda-fixture",
    );
    const fingerprintFile = `${cachedExecutable}.native-fingerprint`;

    try {
      await writeFile(cachedExecutable, await readFile(fixture.executable));
      await chmod(cachedExecutable, 0o755);
      await writeFile(fingerprintFile, `${"a".repeat(64)}\n`);
      const before = await stat(cachedExecutable);

      const output = execFileSync(runner, [fixture.executable], {
        encoding: "utf8",
        env: fixture.environment,
      });

      const after = await stat(cachedExecutable);
      const codesignCalls = (await readFile(fixture.codesignLog, "utf8"))
        .split("\n")
        .filter((line) => line.includes(`--sign ${"A".repeat(40)}`));

      assert.equal(output, "fixture launched\n");
      assert.equal(codesignCalls.length, 0);
      assert.equal(after.ino, before.ino);
      assert.equal(after.mtimeMs, before.mtimeMs);
      assert.equal(
        await readFile(fingerprintFile, "utf8"),
        `coda-dev-native-fingerprint-v2\n${"b".repeat(64)}\n`,
      );
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test("fingerprints native inputs while ignoring renderer and generated output", async () => {
  const fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "coda-native-fingerprint-"),
  );
  const nativeSource = path.join(
    fixtureDirectory,
    "src-tauri",
    "src",
    "lib.rs",
  );
  const nativeConfig = path.join(
    fixtureDirectory,
    "src-tauri",
    "tauri.conf.json",
  );
  const nativeCapability = path.join(
    fixtureDirectory,
    "src-tauri",
    "capabilities",
    "default.json",
  );
  const credentialFile = path.join(fixtureDirectory, "src-tauri", ".env.local");
  const generatedTarget = path.join(
    fixtureDirectory,
    "src-tauri",
    "target",
    "debug",
    "coda",
  );
  const generatedBindings = path.join(
    fixtureDirectory,
    "src-tauri",
    "gen",
    "schema.json",
  );
  const rendererSource = path.join(fixtureDirectory, "src", "App.tsx");
  const nativeOverride = {
    identifier: "com.coda.bandcamp",
    build: { devUrl: "http://127.0.0.1:3381" },
  };
  const toolchain = {
    cargo: "cargo 1.97.1",
    host: "darwin arm64",
    rustc: "rustc 1.97.1",
  };
  const buildEnvironment = {
    CODA_LASTFM_API_KEY: "secret-a",
    CODA_LASTFM_SHARED_SECRET: "secret-b",
    RUSTFLAGS: "-C target-cpu=native",
  };
  const fingerprint = ({
    environment = buildEnvironment,
    override = nativeOverride,
    tools = toolchain,
  } = {}) =>
    computeNativeBuildFingerprint({
      environment,
      nativeOverride: override,
      repositoryRoot: fixtureDirectory,
      toolchain: tools,
    });

  try {
    await mkdir(path.dirname(nativeSource), { recursive: true });
    await mkdir(path.dirname(nativeCapability), { recursive: true });
    await mkdir(path.dirname(generatedTarget), { recursive: true });
    await mkdir(path.dirname(generatedBindings), { recursive: true });
    await mkdir(path.dirname(rendererSource), { recursive: true });
    await writeFile(nativeSource, "fn native_behavior() {}\n");
    await writeFile(
      path.join(fixtureDirectory, "src-tauri", "Cargo.toml"),
      '[package]\nname = "fixture"\n',
    );
    await writeFile(
      path.join(fixtureDirectory, "src-tauri", "Cargo.lock"),
      "version = 4\n",
    );
    await writeFile(nativeConfig, "{}\n");
    await writeFile(nativeCapability, '{"permissions":[]}\n');
    await writeFile(credentialFile, "PRIVATE_VALUE=first\n");
    await writeFile(generatedTarget, "generated target v1\n");
    await writeFile(generatedBindings, "generated bindings v1\n");
    await writeFile(rendererSource, "export const ui = 'v1';\n");

    const initial = await fingerprint();
    assert.equal(
      await computeCurrentNativeBuildFingerprint(
        {
          ...buildEnvironment,
          CODA_DEV_NATIVE_OVERRIDE: JSON.stringify(nativeOverride),
        },
        { repository: fixtureDirectory, toolchain },
      ),
      initial,
    );

    await writeFile(generatedTarget, "generated target v2\n");
    await writeFile(generatedBindings, "generated bindings v2\n");
    await writeFile(rendererSource, "export const ui = 'v2';\n");
    await writeFile(credentialFile, "PRIVATE_VALUE=second\n");
    assert.equal(await fingerprint(), initial);

    await writeFile(nativeSource, "fn native_behavior_changed() {}\n");
    assert.notEqual(await fingerprint(), initial);
    assert.notEqual(
      await computeCurrentNativeBuildFingerprint(
        {
          ...buildEnvironment,
          CODA_DEV_NATIVE_OVERRIDE: JSON.stringify(nativeOverride),
        },
        { repository: fixtureDirectory, toolchain },
      ),
      initial,
    );
    await writeFile(nativeSource, "fn native_behavior() {}\n");

    await writeFile(nativeConfig, '{"identifier":"changed"}\n');
    assert.notEqual(await fingerprint(), initial);
    await writeFile(nativeConfig, "{}\n");

    await writeFile(nativeCapability, '{"permissions":["changed"]}\n');
    assert.notEqual(await fingerprint(), initial);
    await writeFile(nativeCapability, '{"permissions":[]}\n');

    assert.notEqual(
      await fingerprint({
        environment: {
          CODA_LASTFM_API_KEY: "changed-secret",
          CODA_LASTFM_SHARED_SECRET: "secret-b",
          RUSTFLAGS: "-C target-cpu=native",
        },
      }),
      initial,
    );
    assert.notEqual(
      await fingerprint({
        environment: {
          ...buildEnvironment,
          CARGO_PROFILE_DEV_OPT_LEVEL: "1",
        },
      }),
      initial,
    );
    assert.notEqual(
      await fingerprint({
        override: {
          ...nativeOverride,
          build: { devUrl: "http://127.0.0.1:3382" },
        },
      }),
      initial,
    );
    assert.notEqual(
      await fingerprint({
        tools: { ...toolchain, rustc: "rustc 1.98.0" },
      }),
      initial,
    );
    assert.match(initial, /^[0-9a-f]{64}$/);
    assert.equal(initial.includes("secret"), false);
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});

test(
  "re-signs the worktree executable when native inputs change",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;

    try {
      execFileSync(runner, [fixture.executable], {
        env: fixture.environment,
      });
      execFileSync(runner, [fixture.executable], {
        env: {
          ...fixture.environment,
          CODA_DEV_NATIVE_FINGERPRINT: "c".repeat(64),
        },
      });
      const codesignCalls = (await readFile(fixture.codesignLog, "utf8"))
        .split("\n")
        .filter((line) => line.includes(`--sign ${"A".repeat(40)}`));

      assert.equal(codesignCalls.length, 2);
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "invalidates the published fingerprint before replacing the signed executable",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;
    const cachedExecutable = path.join(
      path.dirname(fixture.executable),
      "coda-fixture",
    );
    const fingerprintFile = `${cachedExecutable}.native-fingerprint`;
    const fakeMove = path.join(fixture.fixtureDirectory, "bin", "mv");

    try {
      execFileSync(runner, [fixture.executable], {
        env: fixture.environment,
      });
      await writeFile(
        fixture.executable,
        "#!/bin/sh\nprintf 'replacement fixture launched\\n'\n",
      );
      await chmod(fixture.executable, 0o755);
      await writeFile(
        fakeMove,
        `#!/bin/sh
destination=""
for argument in "$@"; do
  destination="$argument"
done
if [ "$destination" = "$CODA_TEST_FAIL_MOVE_DESTINATION" ]; then
  exit 79
fi
exec /bin/mv "$@"
`,
      );
      await chmod(fakeMove, 0o755);

      assert.throws(() =>
        execFileSync(runner, [fixture.executable], {
          env: {
            ...fixture.environment,
            CODA_DEV_NATIVE_FINGERPRINT: "c".repeat(64),
            CODA_TEST_FAIL_MOVE_DESTINATION: fingerprintFile,
          },
        }),
      );
      await assert.rejects(readFile(fingerprintFile, "utf8"), {
        code: "ENOENT",
      });

      await unlink(fakeMove);
      const retryOutput = execFileSync(runner, [fixture.executable], {
        encoding: "utf8",
        env: {
          ...fixture.environment,
          CODA_DEV_NATIVE_FINGERPRINT: "c".repeat(64),
        },
      });
      const codesignCalls = (await readFile(fixture.codesignLog, "utf8"))
        .split("\n")
        .filter((line) => line.includes(`--sign ${"A".repeat(40)}`));

      assert.equal(retryOutput, "replacement fixture launched\n");
      assert.equal(codesignCalls.length, 2);
      assert.equal(
        await readFile(fingerprintFile, "utf8"),
        `coda-dev-native-fingerprint-v2\n${"c".repeat(64)}\n`,
      );
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "terminates the signing runner after cleaning up an interrupted replacement",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;
    const cachedExecutable = path.join(
      path.dirname(fixture.executable),
      "coda-fixture",
    );
    const fingerprintFile = `${cachedExecutable}.native-fingerprint`;
    const blockMarker = path.join(fixture.fixtureDirectory, "codesign-blocked");
    const releaseMarker = path.join(
      fixture.fixtureDirectory,
      "release-codesign",
    );

    try {
      const child = spawn(runner, [fixture.executable], {
        env: {
          ...fixture.environment,
          CODA_TEST_CODESIGN_BLOCK_MARKER: blockMarker,
          CODA_TEST_CODESIGN_RELEASE: releaseMarker,
        },
        stdio: "ignore",
      });
      const completion = new Promise((resolve) => {
        child.once("close", (code, signal) => resolve({ code, signal }));
      });

      await waitFor(async () => {
        try {
          return (await stat(blockMarker)).isFile();
        } catch {
          return false;
        }
      });
      child.kill("SIGTERM");
      await writeFile(releaseMarker, "");

      assert.deepEqual(await completion, { code: 143, signal: null });
      await assert.rejects(stat(cachedExecutable), { code: "ENOENT" });
      await assert.rejects(stat(fingerprintFile), { code: "ENOENT" });
      const targetEntries = await readdir(path.dirname(fixture.executable));
      assert.equal(
        targetEntries.some(
          (entry) =>
            entry.startsWith("coda-fixture.signing.") ||
            entry.startsWith("coda-fixture.native-fingerprint.tmp."),
        ),
        false,
      );
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "reuses the approved executable when Cargo relinks with the same native fingerprint",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;

    try {
      const firstOutput = execFileSync(runner, [fixture.executable], {
        encoding: "utf8",
        env: fixture.environment,
      });
      await writeFile(
        fixture.executable,
        "#!/bin/sh\nprintf 'changed fixture launched\\n'\n",
      );
      const secondOutput = execFileSync(runner, [fixture.executable], {
        encoding: "utf8",
        env: fixture.environment,
      });
      const codesignCalls = (await readFile(fixture.codesignLog, "utf8"))
        .split("\n")
        .filter((line) => line.includes(`--sign ${"A".repeat(40)}`));

      assert.equal(firstOutput, "fixture launched\n");
      assert.equal(secondOutput, "fixture launched\n");
      assert.equal(codesignCalls.length, 1);
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "re-signs instead of reusing an executable whose signature no longer verifies",
  { skip: process.platform !== "darwin" },
  async () => {
    const fixture = await createRunnerFixture();
    const runner = new URL("../src-tauri/coda-dev-runner.sh", import.meta.url)
      .pathname;
    const failedVerificationMarker = path.join(
      fixture.fixtureDirectory,
      "failed-verification",
    );

    try {
      execFileSync(runner, [fixture.executable], {
        env: fixture.environment,
      });
      execFileSync(runner, [fixture.executable], {
        env: {
          ...fixture.environment,
          CODA_TEST_FAIL_VERIFY_ONCE: failedVerificationMarker,
        },
      });
      const codesignCalls = (await readFile(fixture.codesignLog, "utf8"))
        .split("\n")
        .filter((line) => line.includes(`--sign ${"A".repeat(40)}`));

      assert.equal(codesignCalls.length, 2);
    } finally {
      await rm(fixture.fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "stopping the Grove wrapper terminates the complete dev process tree",
  { skip: process.platform === "win32" },
  async () => {
    const fixtureDirectory = await mkdtemp(
      path.join(tmpdir(), "coda-grove-signals-"),
    );
    const pidPath = path.join(fixtureDirectory, "pids.json");
    const signalSource = new EventEmitter();
    const grandchildSource = "setInterval(() => {}, 1_000);";
    const childSource = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const grandchild = spawn(
        process.execPath,
        ["-e", ${JSON.stringify(grandchildSource)}],
        { stdio: "ignore" },
      );
      writeFileSync(
        process.env.CODA_TEST_PID_PATH,
        JSON.stringify({ parent: process.pid, grandchild: grandchild.pid }),
      );
      setInterval(() => {}, 1_000);
    `;
    let pids;

    try {
      const completion = runManagedCommand(
        process.execPath,
        ["-e", childSource],
        {
          env: { ...process.env, CODA_TEST_PID_PATH: pidPath },
          stdio: "ignore",
        },
        signalSource,
      );
      pids = await waitFor(async () => {
        try {
          return JSON.parse(await readFile(pidPath, "utf8"));
        } catch {
          return undefined;
        }
      });

      assert.equal(isRunning(pids.parent), true);
      assert.equal(isRunning(pids.grandchild), true);
      signalSource.emit("SIGTERM");
      await assert.rejects(completion, /SIGTERM/);

      await waitFor(
        () => !isRunning(pids.parent) && !isRunning(pids.grandchild),
      );
    } finally {
      for (const pid of [pids?.parent, pids?.grandchild]) {
        if (pid && isRunning(pid)) {
          process.kill(pid, "SIGKILL");
        }
      }
      await unlink(pidPath).catch(() => {});
      await rmdir(fixtureDirectory).catch(() => {});
    }
  },
);

test(
  "forwards repeated termination signals until the managed child exits",
  { skip: process.platform === "win32" },
  async () => {
    const fixtureDirectory = await mkdtemp(
      path.join(tmpdir(), "coda-repeated-signals-"),
    );
    const pidPath = path.join(fixtureDirectory, "pid");
    const signalCountPath = path.join(fixtureDirectory, "signal-count");
    const signalSource = new EventEmitter();
    const childSource = `
      const { writeFileSync } = require("node:fs");
      let count = 0;
      process.on("SIGTERM", () => {
        count += 1;
        writeFileSync(process.env.CODA_TEST_SIGNAL_COUNT_PATH, String(count));
      });
      writeFileSync(process.env.CODA_TEST_PID_PATH, String(process.pid));
      setInterval(() => {}, 1_000);
    `;
    let childPid;

    try {
      const completion = runManagedCommand(
        process.execPath,
        ["-e", childSource],
        {
          env: {
            ...process.env,
            CODA_TEST_PID_PATH: pidPath,
            CODA_TEST_SIGNAL_COUNT_PATH: signalCountPath,
          },
          stdio: "ignore",
        },
        signalSource,
      );
      childPid = await waitFor(async () => {
        try {
          return Number(await readFile(pidPath, "utf8")) || undefined;
        } catch {
          return undefined;
        }
      });

      signalSource.emit("SIGTERM");
      await waitFor(async () => {
        try {
          return (await readFile(signalCountPath, "utf8")) === "1";
        } catch {
          return false;
        }
      });
      assert.equal(signalSource.listenerCount("SIGTERM"), 1);

      signalSource.emit("SIGTERM");
      await waitFor(
        async () => (await readFile(signalCountPath, "utf8")) === "2",
      );
      signalSource.emit("SIGINT");
      await assert.rejects(completion, /SIGINT/);
    } finally {
      if (childPid && isRunning(childPid)) {
        process.kill(-childPid, "SIGKILL");
      }
      await rm(fixtureDirectory, { recursive: true, force: true });
    }
  },
);

test(
  "losing the Grove parent terminates the complete dev process tree",
  { skip: process.platform === "win32" },
  async () => {
    const fixtureDirectory = await mkdtemp(
      path.join(tmpdir(), "coda-grove-parent-"),
    );
    const pidPath = path.join(fixtureDirectory, "pids.json");
    const signalSource = new EventEmitter();
    const grandchildSource = "setInterval(() => {}, 1_000);";
    const childSource = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const grandchild = spawn(
        process.execPath,
        ["-e", ${JSON.stringify(grandchildSource)}],
        { stdio: "ignore" },
      );
      writeFileSync(
        process.env.CODA_TEST_PID_PATH,
        JSON.stringify({ parent: process.pid, grandchild: grandchild.pid }),
      );
      setInterval(() => {}, 1_000);
    `;
    let originalParentPid = 41;
    let pids;

    try {
      const completion = runManagedCommand(
        process.execPath,
        ["-e", childSource],
        {
          env: { ...process.env, CODA_TEST_PID_PATH: pidPath },
          stdio: "ignore",
        },
        signalSource,
        {
          isGroveManaged: false,
          parentPollIntervalMs: 10,
          readParentPid: () => originalParentPid,
          readProcessGroupId: () => {
            throw new Error(
              "manual launches must not inspect the parent group",
            );
          },
        },
      );
      completion.catch(() => {});
      pids = await waitFor(async () => {
        try {
          return JSON.parse(await readFile(pidPath, "utf8"));
        } catch {
          return undefined;
        }
      });

      assert.equal(isRunning(pids.parent), true);
      assert.equal(isRunning(pids.grandchild), true);
      originalParentPid = 42;

      await waitFor(
        () => !isRunning(pids.parent) && !isRunning(pids.grandchild),
        500,
      );
      await assert.rejects(completion, /SIGTERM/);
    } finally {
      for (const pid of [pids?.parent, pids?.grandchild]) {
        if (pid && isRunning(pid)) {
          process.kill(pid, "SIGKILL");
        }
      }
      await unlink(pidPath).catch(() => {});
      await rmdir(fixtureDirectory).catch(() => {});
    }
  },
);

test(
  "losing a confirmed Grove parent cleans the app group before the Grove group",
  { skip: process.platform === "win32" },
  async () => {
    const fixtureDirectory = await mkdtemp(
      path.join(tmpdir(), "coda-grove-group-"),
    );
    const pidPath = path.join(fixtureDirectory, "pids.json");
    const signalSource = new EventEmitter();
    const grandchildSource = "setInterval(() => {}, 1_000);";
    const childSource = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const grandchild = spawn(
        process.execPath,
        ["-e", ${JSON.stringify(grandchildSource)}],
        { stdio: "ignore" },
      );
      writeFileSync(
        process.env.CODA_TEST_PID_PATH,
        JSON.stringify({ parent: process.pid, grandchild: grandchild.pid }),
      );
      setInterval(() => {}, 1_000);
    `;
    const originalGroveProcessGroupId = 51;
    const signaledGroups = [];
    let currentParentPid = originalGroveProcessGroupId;
    let pids;

    try {
      const completion = runManagedCommand(
        process.execPath,
        ["-e", childSource],
        {
          env: { ...process.env, CODA_TEST_PID_PATH: pidPath },
          stdio: "ignore",
        },
        signalSource,
        {
          isGroveManaged: true,
          parentPollIntervalMs: 10,
          readParentPid: () => currentParentPid,
          readProcessGroupId: () => originalGroveProcessGroupId,
          signalProcessGroup: (processGroupId, signal) => {
            signaledGroups.push(processGroupId);
            if (processGroupId !== originalGroveProcessGroupId) {
              process.kill(-processGroupId, signal);
            }
          },
        },
      );
      completion.catch(() => {});
      pids = await waitFor(async () => {
        try {
          return JSON.parse(await readFile(pidPath, "utf8"));
        } catch {
          return undefined;
        }
      });

      currentParentPid = 52;
      await waitFor(
        () => !isRunning(pids.parent) && !isRunning(pids.grandchild),
        500,
      );
      await assert.rejects(completion, /SIGTERM/);

      assert.deepEqual(signaledGroups.slice(0, 2), [
        pids.parent,
        originalGroveProcessGroupId,
      ]);
    } finally {
      for (const pid of [pids?.parent, pids?.grandchild]) {
        if (pid && isRunning(pid)) {
          process.kill(pid, "SIGKILL");
        }
      }
      await unlink(pidPath).catch(() => {});
      await rmdir(fixtureDirectory).catch(() => {});
    }
  },
);

test("stops watching the Grove parent after the managed child exits", async () => {
  const signalSource = new EventEmitter();
  let parentReads = 0;

  assert.equal(
    await runManagedCommand(
      process.execPath,
      ["-e", ""],
      { stdio: "ignore" },
      signalSource,
      {
        parentPollIntervalMs: 10,
        readParentPid: () => {
          parentReads += 1;
          return 41;
        },
      },
    ),
    0,
  );
  const readsAtExit = parentReads;
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(parentReads, readsAtExit);
  assert.equal(signalSource.listenerCount("SIGINT"), 0);
  assert.equal(signalSource.listenerCount("SIGTERM"), 0);
});
