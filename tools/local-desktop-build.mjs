#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const requiredLocalBuildVariables = Object.freeze([
  "CODA_LASTFM_API_KEY",
  "CODA_LASTFM_SHARED_SECRET",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
]);

export function findMissingLocalBuildVariables(environment) {
  return requiredLocalBuildVariables.filter(
    (name) => !environment[name]?.trim(),
  );
}

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[1] === scriptPath) {
  const missingVariables = findMissingLocalBuildVariables(process.env);

  if (missingVariables.length > 0) {
    console.error(
      "The local desktop build is missing required values from .env.local:\n" +
        missingVariables.map((name) => `- ${name}`).join("\n"),
    );
    process.exitCode = 1;
  } else {
    const tauriCliPath = fileURLToPath(
      new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url),
    );
    const result = spawnSync(
      process.execPath,
      [tauriCliPath, "build", ...process.argv.slice(2)],
      {
        env: process.env,
        stdio: "inherit",
      },
    );

    if (result.error) {
      console.error(`Could not start the Tauri build: ${result.error.message}`);
      process.exitCode = 1;
    } else {
      process.exitCode = result.status ?? 1;
    }
  }
}
