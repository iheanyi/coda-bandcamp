#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolsDirectory, "..");
const nativeBuildEnvironmentPattern =
  /^(AR|CC|CFLAGS|CXX|CXXFLAGS|MACOSX_DEPLOYMENT_TARGET|RUSTC|RUSTC_WRAPPER|RUSTFLAGS|CARGO_BUILD_TARGET|CARGO_ENCODED_RUSTFLAGS|CODA_LASTFM_API_KEY|CODA_LASTFM_SHARED_SECRET|SDKROOT)(_|$)/;
const generatedNativeDirectoryNames = new Set(["dist", "gen", "target"]);
const isCredentialEnvironmentFile = (filename) =>
  filename === ".env" || filename.startsWith(".env.");

function commandVersion(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unavailable";
  }
}

function readPosixProcessGroupId(pid) {
  const value = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  if (!/^\d+$/.test(value)) return undefined;
  return Number(value);
}

export function collectNativeToolchain(repository = repositoryRoot) {
  const tauriExecutable =
    process.platform === "win32"
      ? path.join(repository, "node_modules", ".bin", "tauri.cmd")
      : path.join(repository, "node_modules", ".bin", "tauri");
  return {
    architecture: process.arch,
    cargo: commandVersion("cargo", ["-V"], repository),
    host: commandVersion("uname", ["-srm"], repository),
    node: process.version,
    platform: process.platform,
    rustc: commandVersion("rustc", ["-Vv"], repository),
    sdk:
      process.platform === "darwin"
        ? commandVersion("xcrun", ["--show-sdk-version"], repository)
        : "not-applicable",
    tauri: commandVersion(tauriExecutable, ["-V"], repository),
  };
}

async function collectNativeInputFiles(repository) {
  const files = [];
  const collectDirectory = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      if (cause && typeof cause === "object" && cause.code === "ENOENT") return;
      throw cause;
    }
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      if (
        entry.isDirectory() &&
        generatedNativeDirectoryNames.has(entry.name)
      ) {
        continue;
      }
      if (entry.isFile() && isCredentialEnvironmentFile(entry.name)) {
        continue;
      }
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await collectDirectory(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  };

  await collectDirectory(path.join(repository, "src-tauri"));
  await collectDirectory(path.join(repository, ".cargo"));
  for (const filename of ["rust-toolchain", "rust-toolchain.toml"]) {
    const filePath = path.join(repository, filename);
    try {
      await readFile(filePath);
      files.push(filePath);
    } catch (cause) {
      if (!cause || typeof cause !== "object" || cause.code !== "ENOENT") {
        throw cause;
      }
    }
  }
  return files.sort();
}

export async function computeNativeBuildFingerprint({
  environment = process.env,
  nativeOverride,
  repositoryRoot: repository = repositoryRoot,
  toolchain = collectNativeToolchain(repository),
}) {
  const hash = createHash("sha256");
  const buildEnvironment = Object.fromEntries(
    Object.entries(environment)
      .filter(([key]) => nativeBuildEnvironmentPattern.test(key))
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  hash.update(
    JSON.stringify({
      buildEnvironment,
      nativeOverride,
      schema: 1,
      toolchain,
    }),
  );
  for (const filePath of await collectNativeInputFiles(repository)) {
    const relativePath = path.relative(repository, filePath);
    const contents = await readFile(filePath);
    hash.update(`\0${relativePath}\0${contents.byteLength}\0`);
    hash.update(contents);
  }
  return hash.digest("hex");
}

export function parseNativeOverride(value) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Coda's native development override is missing.");
  }
  if (value.length > 128 * 1024) {
    throw new Error("Coda's native development override is too large.");
  }
  let nativeOverride;
  try {
    nativeOverride = JSON.parse(value);
  } catch {
    throw new Error("Coda's native development override is invalid.");
  }
  if (
    !nativeOverride ||
    typeof nativeOverride !== "object" ||
    Array.isArray(nativeOverride)
  ) {
    throw new Error("Coda's native development override is invalid.");
  }
  return nativeOverride;
}

export async function computeCurrentNativeBuildFingerprint(
  environment = process.env,
  {
    repository = repositoryRoot,
    toolchain = collectNativeToolchain(repository),
  } = {},
) {
  return await computeNativeBuildFingerprint({
    environment,
    nativeOverride: parseNativeOverride(environment.CODA_DEV_NATIVE_OVERRIDE),
    repositoryRoot: repository,
    toolchain,
  });
}

export function parsePort(value) {
  if (value === undefined || value === "") {
    throw new Error("PORT is missing. Launch this command with grove start.");
  }
  if (!/^\d+$/.test(value)) {
    throw new Error("PORT must be an integer.");
  }
  const port = Number(value);
  if (port < 1 || port > 65535) {
    throw new Error("PORT must be between 1 and 65535.");
  }
  return port;
}

export function resolveDevPort({ baseDevUrl, grovePort, portValue }) {
  if (portValue !== undefined && portValue !== "") {
    return parsePort(portValue);
  }
  if (grovePort !== undefined) {
    return parsePort(String(grovePort));
  }
  if (typeof baseDevUrl !== "string") {
    throw new Error("Coda's Tauri configuration has no development URL.");
  }
  let configuredUrl;
  try {
    configuredUrl = new URL(baseDevUrl);
  } catch {
    throw new Error("Coda's Tauri development URL is invalid.");
  }
  if (!configuredUrl.port) {
    throw new Error("Coda's Tauri development URL must include a port.");
  }
  return parsePort(configuredUrl.port);
}

export function readRegisteredGroveServer(
  repository = repositoryRoot,
  readCommand = execFileSync,
) {
  let output;
  try {
    output = readCommand("grove", ["url", "--json"], {
      cwd: repository,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }

  let server;
  try {
    server = JSON.parse(String(output));
  } catch {
    return undefined;
  }
  if (
    !server ||
    typeof server !== "object" ||
    (server.path !== undefined &&
      (typeof server.path !== "string" ||
        path.resolve(server.path) !== path.resolve(repository)))
  ) {
    return undefined;
  }

  let port;
  try {
    port = parsePort(String(server.port));
  } catch {
    return undefined;
  }
  return {
    port,
    running: server.status === "running",
  };
}

export function normalizeInstanceSlug(value) {
  const branchLeaf = value.trim().split("/").filter(Boolean).at(-1) ?? "";
  const slug = branchLeaf
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  if (!slug) {
    throw new Error("The Coda development instance needs a usable name.");
  }
  return slug;
}

export function displayNameForSlug(slug) {
  const words = slug
    .split("-")
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`);
  return `Coda ${words.join(" ")}`;
}

export function resolveDevIdentity({
  branch,
  instanceOverride,
  portValue,
  worktreeName,
}) {
  const worktreeIdentity = branch && branch !== "HEAD" ? branch : worktreeName;
  const rawName = instanceOverride?.trim() || worktreeIdentity;
  const slug = normalizeInstanceSlug(rawName);
  return {
    displayName: displayNameForSlug(slug),
    executableSlug: normalizeInstanceSlug(worktreeName),
    port: parsePort(portValue),
    slug,
  };
}

export function buildTauriOverride(baseConfig, identity) {
  if (!Array.isArray(baseConfig.app?.windows)) {
    throw new Error("Coda's Tauri configuration has no window definitions.");
  }
  if (baseConfig.identifier !== "com.coda.bandcamp") {
    throw new Error("Coda's stable native identifier is unavailable.");
  }
  const nativeDisplayName = displayNameForSlug(identity.executableSlug);
  return {
    productName: nativeDisplayName,
    identifier: baseConfig.identifier,
    build: {
      devUrl: `http://127.0.0.1:${identity.port}`,
    },
    app: {
      windows: baseConfig.app.windows.map((window) => ({
        ...window,
        title:
          window.label === "mini-player"
            ? `${nativeDisplayName} Mini Player`
            : nativeDisplayName,
      })),
    },
  };
}

export function buildDevEnvironment(environment, identity, nativeOverride) {
  return {
    ...environment,
    CODA_DEV_EXECUTABLE_SLUG: identity.executableSlug,
    CODA_DEV_INSTANCE_SLUG: identity.slug,
    ...(nativeOverride
      ? { CODA_DEV_NATIVE_OVERRIDE: JSON.stringify(nativeOverride) }
      : {}),
    PORT: String(identity.port),
    VITE_CODA_APP_NAME: identity.displayName,
  };
}

export async function runManagedCommand(
  command,
  args,
  spawnOptions,
  signalSource = process,
  {
    isGroveManaged = Boolean(process.env.GROVE_URL),
    parentPollIntervalMs = 250,
    readParentPid = () => process.ppid,
    readProcessGroupId = readPosixProcessGroupId,
    signalProcessGroup = (processGroupId, signal) =>
      process.kill(-processGroupId, signal),
  } = {},
) {
  const usesProcessGroup = process.platform !== "win32";
  const originalParentPid = readParentPid();
  let originalGroveProcessGroupId;
  if (usesProcessGroup && isGroveManaged) {
    try {
      const parentProcessGroupId = readProcessGroupId(originalParentPid);
      if (
        parentProcessGroupId === originalParentPid &&
        parentProcessGroupId > 1
      ) {
        originalGroveProcessGroupId = parentProcessGroupId;
      }
    } catch {
      originalGroveProcessGroupId = undefined;
    }
  }
  const child = spawn(command, args, {
    ...spawnOptions,
    detached: usesProcessGroup,
  });
  let parentWatcher;
  const stopParentWatcher = () => {
    if (parentWatcher === undefined) return;
    clearInterval(parentWatcher);
    parentWatcher = undefined;
  };
  const forwardSignal = (signal) => {
    if (child.killed) return;
    if (usesProcessGroup && child.pid) {
      try {
        signalProcessGroup(child.pid, signal);
        return;
      } catch {
        // Fall back to the direct child if the process group already exited.
      }
    }
    child.kill(signal);
  };
  const forwardInterrupt = () => {
    forwardSignal("SIGINT");
  };
  const forwardTermination = () => {
    forwardSignal("SIGTERM");
  };
  signalSource.once("SIGINT", forwardInterrupt);
  signalSource.once("SIGTERM", forwardTermination);
  parentWatcher = setInterval(() => {
    let currentParentPid;
    try {
      currentParentPid = readParentPid();
    } catch {
      currentParentPid = undefined;
    }
    if (currentParentPid === originalParentPid) return;
    stopParentWatcher();
    forwardSignal("SIGTERM");
    if (originalGroveProcessGroupId !== undefined) {
      try {
        signalProcessGroup(originalGroveProcessGroupId, "SIGTERM");
      } catch {
        // The Grove shell and its process group may already be gone.
      }
    }
  }, parentPollIntervalMs);
  parentWatcher.unref();

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      signalSource.removeListener("SIGINT", forwardInterrupt);
      signalSource.removeListener("SIGTERM", forwardTermination);
      stopParentWatcher();
    };
    child.once("error", (cause) => {
      cleanup();
      reject(cause);
    });
    child.once("exit", (code, signal) => {
      cleanup();
      if (signal) {
        reject(new Error(`Coda development instance exited with ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

function gitOutput(args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

export async function runDevInstance(environment = process.env) {
  const configPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
  const baseConfig = JSON.parse(await readFile(configPath, "utf8"));
  const groveServer =
    environment.PORT === undefined
      ? readRegisteredGroveServer(repositoryRoot)
      : undefined;
  if (groveServer?.running) {
    throw new Error(
      "Grove is already running Coda for this worktree. Run `grove stop` before `npm run dev`.",
    );
  }
  const port = resolveDevPort({
    baseDevUrl: baseConfig.build?.devUrl,
    grovePort: groveServer?.port,
    portValue: environment.PORT,
  });
  const identity = resolveDevIdentity({
    branch: gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]),
    instanceOverride: environment.CODA_DEV_INSTANCE,
    portValue: String(port),
    worktreeName: path.basename(repositoryRoot),
  });
  const override = buildTauriOverride(baseConfig, identity);
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  return await runManagedCommand(
    npmExecutable,
    ["run", "tauri", "--", "dev", "--config", JSON.stringify(override)],
    {
      cwd: repositoryRoot,
      env: buildDevEnvironment(environment, identity, override),
      stdio: "inherit",
    },
  );
}

const launchedDirectly =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (launchedDirectly) {
  const command =
    process.argv[2] === "native-fingerprint"
      ? computeCurrentNativeBuildFingerprint().then((fingerprint) => {
          process.stdout.write(`${fingerprint}\n`);
          return 0;
        })
      : runDevInstance();
  command
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause) => {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exitCode = 1;
    });
}
