#!/usr/bin/env node

import {
  execFileSync,
  spawn,
  spawnSync,
} from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";

export const AUTOMATION_APP_IDENTIFIER = "com.coda.bandcamp.dev";
export const AUTOMATION_APP_NAME = "Coda Dev";
export const DEFAULT_AUTOMATION_SIGNING_IDENTITY = "Coda Local Development";

const CERTIFICATE_HASH_PATTERN = /^[0-9A-F]{40}$/;
const SIGNING_IDENTITY_ENV = "CODA_AUTOMATION_CODESIGN_IDENTITY";
const AUTOMATION_ENVIRONMENT_PREFIXES_TO_REMOVE = ["APPLE_", "TAURI_"];
const AUTOMATION_OUTPUT_OVERRIDE_KEYS = [
  "CARGO_BUILD_TARGET",
  "CARGO_BUILD_TARGET_DIR",
  "CARGO_TARGET_DIR",
];

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const automationConfigPath = resolve(
  repositoryRoot,
  "src-tauri/tauri.dev.conf.json",
);
const devCapabilityPath = resolve(
  repositoryRoot,
  "src-tauri/capabilities/dev.json",
);
const appBundlePath = resolve(
  repositoryRoot,
  "src-tauri/target/release/bundle/macos/Coda Dev.app",
);
const requirementRecordPath = resolve(
  repositoryRoot,
  "src-tauri/target/coda-automation-signing-requirement.json",
);
const tauriCliPath = resolve(
  repositoryRoot,
  "node_modules/@tauri-apps/cli/tauri.js",
);

function isString(value) {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    value === String(value)
  );
}

function isRecord(value) {
  return (
    value !== null &&
    value !== undefined &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function containsControlCharacter(value) {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function validIdentityName(value) {
  return (
    isString(value) &&
    value.length > 0 &&
    value.length <= 256 &&
    !containsControlCharacter(value)
  );
}

export function parseCodeSigningIdentities(output) {
  if (!isString(output)) return [];

  const identities = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(
      /^\s*\d+\)\s+([0-9A-F]{40})\s+"([^"\r\n]+)"\s*$/u,
    );
    if (match) {
      identities.push({ certificateHash: match[1], name: match[2] });
    }
  }
  return identities;
}

export function selectCodeSigningIdentity(output, requestedIdentity) {
  if (!validIdentityName(requestedIdentity)) {
    throw new Error(
      `${SIGNING_IDENTITY_ENV} must name one macOS code-signing identity.`,
    );
  }

  const matches = parseCodeSigningIdentities(output).filter(
    ({ name }) => name === requestedIdentity,
  );
  if (matches.length === 0) {
    throw new Error(
      `Coda could not find the requested macOS code-signing identity "${requestedIdentity}". Install it or choose another identity with ${SIGNING_IDENTITY_ENV}.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Coda found more than one macOS code-signing identity named "${requestedIdentity}". Remove the duplicate or select a unique identity.`,
    );
  }
  return matches[0];
}

export function expectedDesignatedRequirement(
  appIdentifier,
  certificateHash,
) {
  if (
    appIdentifier !== AUTOMATION_APP_IDENTIFIER ||
    !CERTIFICATE_HASH_PATTERN.test(certificateHash)
  ) {
    throw new Error("Coda cannot construct a safe automation signing requirement.");
  }
  return `=identifier "${appIdentifier}" and certificate leaf = H"${certificateHash}"`;
}

export function redactCertificateHash(output, certificateHash) {
  if (
    !isString(output) ||
    !CERTIFICATE_HASH_PATTERN.test(certificateHash)
  ) {
    throw new Error("Coda cannot safely redact the selected certificate.");
  }
  return output.replaceAll(certificateHash, "[selected certificate]");
}

function permissionIdentifier(permission) {
  if (isString(permission)) return permission;
  if (!isRecord(permission) || !isString(permission.identifier)) {
    return undefined;
  }
  return permission.identifier;
}

export function assertSafeAutomationConfig(config, devCapability) {
  const selectedCapabilities = config?.app?.security?.capabilities;
  const devPermissions = devCapability?.permissions;
  if (
    config?.productName !== AUTOMATION_APP_NAME ||
    config?.identifier !== AUTOMATION_APP_IDENTIFIER ||
    config?.build?.beforeDevCommand !==
      "npm run web:dev -- --mode coda-dev" ||
    !Array.isArray(selectedCapabilities) ||
    selectedCapabilities.length !== 1 ||
    selectedCapabilities[0] !== "dev" ||
    config?.bundle?.createUpdaterArtifacts !== false ||
    !Array.isArray(config?.bundle?.targets) ||
    config.bundle.targets.length !== 1 ||
    config.bundle.targets[0] !== "app" ||
    config?.plugins?.updater !== null ||
    devCapability?.identifier !== "dev" ||
    !Array.isArray(devPermissions) ||
    devPermissions.some((permission) =>
      permissionIdentifier(permission)?.startsWith("updater:"),
    )
  ) {
    throw new Error(
      "The macOS automation build must use the isolated Coda Dev app-only profile without updater configuration, permissions, or artifacts.",
    );
  }
}

export function createAutomationBuildEnvironment(
  sourceEnvironment,
  certificateHash,
) {
  if (!CERTIFICATE_HASH_PATTERN.test(certificateHash)) {
    throw new Error("Coda cannot build with an invalid signing certificate.");
  }
  const environment = {};
  for (const [key, value] of Object.entries(sourceEnvironment)) {
    if (
      AUTOMATION_ENVIRONMENT_PREFIXES_TO_REMOVE.some((prefix) =>
        key.startsWith(prefix)
      ) || AUTOMATION_OUTPUT_OVERRIDE_KEYS.includes(key)
    ) {
      continue;
    }
    environment[key] = value;
  }
  environment.APPLE_SIGNING_IDENTITY = certificateHash;
  environment.VITE_CODA_UPDATER_ENABLED = "0";
  return environment;
}

export function assertNoAutomationBuildArguments(arguments_) {
  if (!Array.isArray(arguments_) || arguments_.length > 0) {
    throw new Error(
      "The macOS automation build does not accept extra arguments or target overrides.",
    );
  }
}

function redactingLineStream(value, destination) {
  let pending = "";
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString();
      const lastNewline = pending.lastIndexOf("\n");
      if (lastNewline >= 0) {
        const completeLines = pending.slice(0, lastNewline + 1);
        pending = pending.slice(lastNewline + 1);
        callback(null, redactCertificateHash(completeLines, value));
      } else {
        callback();
      }
    },
    flush(callback) {
      callback(null, redactCertificateHash(pending, value));
    },
  });
  stream.pipe(destination, { end: false });
  return stream;
}

function runBuild(certificateHash) {
  return new Promise((resolveBuild, rejectBuild) => {
    const environment = createAutomationBuildEnvironment(
      process.env,
      certificateHash,
    );

    const child = spawn(
      process.execPath,
      [
        tauriCliPath,
        "build",
        "--config",
        automationConfigPath,
        "--bundles",
        "app",
        "--ci",
      ],
      {
        cwd: repositoryRoot,
        env: environment,
        stdio: ["inherit", "pipe", "pipe"],
      },
    );
    child.stdout.pipe(redactingLineStream(certificateHash, process.stdout));
    child.stderr.pipe(redactingLineStream(certificateHash, process.stderr));
    child.once("error", rejectBuild);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolveBuild();
      } else {
        rejectBuild(
          new Error(
            `The Coda automation build failed${signal ? ` after signal ${signal}` : ` with exit code ${code ?? "unknown"}`}.`,
          ),
        );
      }
    });
  });
}

function readDesignatedRequirement(appPath) {
  const result = spawnSync("codesign", ["-d", "-r-", appPath], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("Coda could not inspect the automation app signature.");
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const requirement = output
    .split(/\r?\n/u)
    .find((line) => line.startsWith("designated => "))
    ?.slice("designated => ".length)
    .trim();
  if (!requirement) {
    throw new Error("Coda could not read the automation app requirement.");
  }
  return requirement;
}

function verifyStableRequirement(identityName, requirement) {
  let matchedPreviousBuild = false;
  if (existsSync(requirementRecordPath)) {
    let previous;
    try {
      previous = JSON.parse(readFileSync(requirementRecordPath, "utf8"));
    } catch {
      throw new Error(
        `Coda could not read its prior automation signature record. Move ${relative(repositoryRoot, requirementRecordPath)} to Trash and rebuild.`,
      );
    }
    if (previous?.identityName === identityName) {
      if (previous.requirement !== requirement) {
        throw new Error(
          `The Coda automation app requirement changed while using the same signing identity. Verify the certificate change, then move ${relative(repositoryRoot, requirementRecordPath)} to Trash and rebuild.`,
        );
      }
      matchedPreviousBuild = true;
    }
  }

  const temporaryRecordPath = `${requirementRecordPath}.tmp.${process.pid}`;
  writeFileSync(
    temporaryRecordPath,
    `${JSON.stringify({ identityName, requirement })}\n`,
    { mode: 0o600 },
  );
  renameSync(temporaryRecordPath, requirementRecordPath);
  return matchedPreviousBuild;
}

export async function main(arguments_ = process.argv.slice(2)) {
  assertNoAutomationBuildArguments(arguments_);
  if (process.platform !== "darwin") {
    throw new Error("The Coda automation app can only be built on macOS.");
  }
  if (!existsSync(tauriCliPath)) {
    throw new Error("Coda needs `npm ci` before building the automation app.");
  }

  const automationConfig = JSON.parse(readFileSync(automationConfigPath, "utf8"));
  const devCapability = JSON.parse(readFileSync(devCapabilityPath, "utf8"));
  assertSafeAutomationConfig(automationConfig, devCapability);

  const requestedIdentity =
    process.env[SIGNING_IDENTITY_ENV] ?? DEFAULT_AUTOMATION_SIGNING_IDENTITY;
  const availableIdentities = execFileSync(
    "security",
    ["find-identity", "-v", "-p", "codesigning"],
    { encoding: "utf8" },
  );
  const identity = selectCodeSigningIdentity(
    availableIdentities,
    requestedIdentity,
  );

  console.log(
    `Building the local-only ${AUTOMATION_APP_NAME} automation app with a stable macOS identity.`,
  );
  await runBuild(identity.certificateHash);

  if (!existsSync(appBundlePath)) {
    throw new Error("Coda could not find the built automation app bundle.");
  }
  execFileSync("codesign", ["--verify", "--deep", "--strict", appBundlePath], {
    stdio: "ignore",
  });
  execFileSync(
    "codesign",
    [
      "--verify",
      "--strict",
      "-R",
      expectedDesignatedRequirement(
        AUTOMATION_APP_IDENTIFIER,
        identity.certificateHash,
      ),
      appBundlePath,
    ],
    { stdio: "ignore" },
  );

  const requirement = readDesignatedRequirement(appBundlePath);
  const matchedPreviousBuild = verifyStableRequirement(
    identity.name,
    requirement,
  );
  console.log(
    matchedPreviousBuild
      ? "Verified that the designated requirement matches the previous automation build."
      : "Recorded the designated requirement for comparison with the next automation build.",
  );
  console.log(`Built ${relative(repositoryRoot, appBundlePath)}.`);
  console.log("This local automation artifact is not for distribution.");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedPath === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
