#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(toolsDirectory, "..");

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
  const rawName =
    instanceOverride?.trim() ||
    (branch && branch !== "HEAD" ? branch : worktreeName);
  const slug = normalizeInstanceSlug(rawName);
  return {
    displayName: displayNameForSlug(slug),
    port: parsePort(portValue),
    slug,
  };
}

export function buildTauriOverride(baseConfig, identity) {
  if (!Array.isArray(baseConfig.app?.windows)) {
    throw new Error("Coda's Tauri configuration has no window definitions.");
  }
  return {
    productName: identity.displayName,
    identifier: `com.coda.bandcamp.dev.${identity.slug}`,
    build: {
      devUrl: `http://127.0.0.1:${identity.port}`,
    },
    app: {
      windows: baseConfig.app.windows.map((window) => ({
        ...window,
        title:
          window.label === "mini-player"
            ? `${identity.displayName} Mini Player`
            : identity.displayName,
      })),
    },
  };
}

export function buildDevEnvironment(environment, identity) {
  return {
    ...environment,
    CODA_DEV_INSTANCE_SLUG: identity.slug,
    PORT: String(identity.port),
    VITE_CODA_APP_NAME: identity.displayName,
  };
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
  const identity = resolveDevIdentity({
    branch: gitOutput(["rev-parse", "--abbrev-ref", "HEAD"]),
    instanceOverride: environment.CODA_DEV_INSTANCE,
    portValue: environment.PORT,
    worktreeName: path.basename(repositoryRoot),
  });
  const override = buildTauriOverride(baseConfig, identity);
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(
    npmExecutable,
    ["run", "tauri", "--", "dev", "--config", JSON.stringify(override)],
    {
      cwd: repositoryRoot,
      env: buildDevEnvironment(environment, identity),
      stdio: "inherit",
    },
  );

  const forwardInterrupt = () => {
    if (!child.killed) child.kill("SIGINT");
  };
  const forwardTermination = () => {
    if (!child.killed) child.kill("SIGTERM");
  };
  process.once("SIGINT", forwardInterrupt);
  process.once("SIGTERM", forwardTermination);

  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", forwardInterrupt);
      process.removeListener("SIGTERM", forwardTermination);
      if (signal) {
        reject(new Error(`Coda development instance exited with ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}

const launchedDirectly =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (launchedDirectly) {
  runDevInstance()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause) => {
      console.error(cause instanceof Error ? cause.message : String(cause));
      process.exitCode = 1;
    });
}
