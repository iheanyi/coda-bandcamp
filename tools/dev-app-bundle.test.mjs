import { execFileSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("uses an isolated Tauri identity for the bundled development app", async () => {
  const productionConfig = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "src-tauri", "tauri.conf.json"),
      "utf8",
    ),
  );
  const developmentConfig = JSON.parse(
    await readFile(
      path.join(repositoryRoot, "src-tauri", "tauri.dev.conf.json"),
      "utf8",
    ),
  );

  expect(developmentConfig.productName).toBe("Coda Dev");
  expect(developmentConfig.identifier).toBe("com.coda.bandcamp.dev");
  expect(developmentConfig.identifier).not.toBe(productionConfig.identifier);
  expect(developmentConfig.bundle).toMatchObject({
    targets: ["app"],
    createUpdaterArtifacts: false,
  });
});

test("routes the default desktop dev command through the development flavor", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, "package.json"), "utf8"),
  );

  expect(packageJson.scripts.dev).toBe(
    "tauri dev --config src-tauri/tauri.dev.conf.json",
  );
  expect(packageJson.scripts["desktop:dev"]).toBe(packageJson.scripts.dev);
});

test("bundles and signs the macOS development app before launching it", async () => {
  const runner = await readFile(
    path.join(repositoryRoot, "src-tauri", "coda-dev-runner.sh"),
    "utf8",
  );

  expect(runner).toContain('signing_identifier="com.coda.bandcamp.dev"');
  expect(runner).toContain(
    'set -- bundle --debug --bundles app --config "$dev_configuration" --no-sign',
  );
  expect(runner).toContain(
    'app_bundle="$executable_directory/bundle/macos/Coda Dev.app"',
  );
  expect(runner).toContain('exec "$bundled_executable" "$@"');
});

test("falls back to ad-hoc signing when no local development identity exists", async () => {
  const fixtureDirectory = await mkdtemp(
    path.join(tmpdir(), "coda-dev-signing-"),
  );
  const targetDirectory = path.join(fixtureDirectory, "target", "debug");
  const fakeBinDirectory = path.join(fixtureDirectory, "bin");
  const executable = path.join(targetDirectory, "coda");
  const bundledExecutable = path.join(
    targetDirectory,
    "bundle",
    "macos",
    "Coda Dev.app",
    "Contents",
    "MacOS",
    "coda",
  );
  const codesignLog = path.join(fixtureDirectory, "codesign.log");
  const runner = path.join(
    repositoryRoot,
    "src-tauri",
    "coda-dev-runner.sh",
  );

  try {
    await mkdir(targetDirectory, { recursive: true });
    await mkdir(fakeBinDirectory);
    await writeFile(executable, "#!/bin/sh\nprintf 'fixture launched\\n'\n");
    await writeFile(
      path.join(fakeBinDirectory, "security"),
      "#!/bin/sh\nprintf '     0 valid identities found\\n'\n",
    );
    await writeFile(
      path.join(fakeBinDirectory, "codesign"),
      '#!/bin/sh\nprintf \'%s\\n\' "$*" >> "$CODA_TEST_CODESIGN_LOG"\n',
    );
    await writeFile(
      path.join(fakeBinDirectory, "node"),
      '#!/bin/sh\nmkdir -p "$(dirname "$CODA_TEST_BUNDLED_EXECUTABLE")"\nprintf \'#!/bin/sh\\n\' > "$CODA_TEST_BUNDLED_EXECUTABLE"\nchmod +x "$CODA_TEST_BUNDLED_EXECUTABLE"\n',
    );
    await Promise.all([
      chmod(executable, 0o755),
      chmod(path.join(fakeBinDirectory, "security"), 0o755),
      chmod(path.join(fakeBinDirectory, "codesign"), 0o755),
      chmod(path.join(fakeBinDirectory, "node"), 0o755),
    ]);

    const output = execFileSync(runner, [executable], {
      encoding: "utf8",
      env: {
        ...process.env,
        CODA_DEV_CODESIGN_IDENTITY: "",
        CODA_TEST_BUNDLED_EXECUTABLE: bundledExecutable,
        CODA_TEST_CODESIGN_LOG: codesignLog,
        PATH: `${fakeBinDirectory}:${process.env.PATH}`,
      },
    });
    const codesignCalls = await readFile(codesignLog, "utf8");

    expect(output).toBe("fixture launched\n");
    expect(codesignCalls.match(/--sign -/g)).toHaveLength(2);
    expect(codesignCalls).toContain(
      '--verify --strict -R =identifier "com.coda.bandcamp.dev"',
    );
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
});
