import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runnerPath = resolve(repositoryRoot, "src-tauri/coda-dev-runner.sh");
const FIRST_CERTIFICATE = "A".repeat(40);
const SECOND_CERTIFICATE = "B".repeat(40);
const skipShellRunner = process.platform === "win32";

function writeExecutable(path, source) {
  writeFileSync(path, source, "utf8");
  chmodSync(path, 0o755);
}

function runRunner({ securityOutput, identity }) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "coda-dev-runner-test-"));
  try {
    const stubDirectory = join(fixtureRoot, "bin");
    const executableDirectory = join(fixtureRoot, "target", "debug");
    const bundledExecutableDirectory = join(
      executableDirectory,
      "bundle",
      "macos",
      "Coda Dev.app",
      "Contents",
      "MacOS",
    );
    const executable = join(executableDirectory, "coda");
    const bundledExecutable = join(bundledExecutableDirectory, "coda");
    const codesignLog = join(fixtureRoot, "codesign.log");
    mkdirSync(stubDirectory, { recursive: true });
    mkdirSync(bundledExecutableDirectory, { recursive: true });

    writeExecutable(executable, "#!/bin/sh\nexit 0\n");
    writeExecutable(bundledExecutable, "#!/bin/sh\nexit 0\n");
    writeExecutable(
      join(stubDirectory, "security"),
      "#!/bin/sh\nprintf '%s\\n' \"$CODA_TEST_SECURITY_OUTPUT\"\n",
    );
    writeExecutable(
      join(stubDirectory, "codesign"),
      "#!/bin/sh\nprintf '%s\\n' \"$*\" >>\"$CODA_TEST_CODESIGN_LOG\"\n",
    );
    writeExecutable(join(stubDirectory, "node"), "#!/bin/sh\nexit 0\n");

    const environment = {
      ...process.env,
      PATH: `${stubDirectory}:${process.env.PATH ?? ""}`,
      CODA_TEST_CODESIGN_LOG: codesignLog,
      CODA_TEST_SECURITY_OUTPUT: securityOutput,
    };
    delete environment.CODA_DEV_CODESIGN_IDENTITY;
    if (identity !== undefined) {
      environment.CODA_DEV_CODESIGN_IDENTITY = identity;
    }

    const result = spawnSync("/bin/sh", [runnerPath, executable], {
      encoding: "utf8",
      env: environment,
    });
    return {
      ...result,
      codesignLog: existsSync(codesignLog)
        ? readFileSync(codesignLog, "utf8")
        : "",
    };
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
}

test(
  "the dev runner selects one exact stable signing identity",
  { skip: skipShellRunner },
  () => {
    const result = runRunner({
      securityOutput: [
        `  1) ${FIRST_CERTIFICATE} "Coda Local Development"`,
        `  2) ${SECOND_CERTIFICATE} "Another Identity"`,
        "     2 valid identities found",
      ].join("\n"),
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.codesignLog, new RegExp(`--sign ${FIRST_CERTIFICATE}`));
    assert.match(
      result.codesignLog,
      new RegExp(`certificate leaf = H"${FIRST_CERTIFICATE}"`),
    );
  },
);

test(
  "the dev runner keeps its zero-setup ad-hoc fallback",
  { skip: skipShellRunner },
  () => {
    const result = runRunner({ securityOutput: "0 valid identities found" });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.codesignLog, /--sign -/u);
    assert.doesNotMatch(result.codesignLog, /certificate leaf/u);
  },
);

test(
  "the dev runner fails when an explicitly requested identity is missing",
  { skip: skipShellRunner },
  () => {
    const result = runRunner({
      securityOutput: "0 valid identities found",
      identity: "Missing Identity",
    });

    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /could not find the requested macOS code-signing identity "Missing Identity"/u,
    );
    assert.equal(result.codesignLog, "");
  },
);

test(
  "the dev runner rejects duplicate exact-match identities",
  { skip: skipShellRunner },
  () => {
    const result = runRunner({
      securityOutput: [
        `  1) ${FIRST_CERTIFICATE} "Coda Local Development"`,
        `  2) ${SECOND_CERTIFICATE} "Coda Local Development"`,
        "     2 valid identities found",
      ].join("\n"),
    });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /more than one macOS code-signing identity/u);
    assert.equal(result.codesignLog, "");
  },
);
