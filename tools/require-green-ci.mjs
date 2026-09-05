#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { setTimeout } from "node:timers/promises";

export const requiredChecks = [
  "ubuntu-22.04",
  "windows-latest",
  "macos-latest",
  "Frontend ubuntu-22.04",
  "Frontend windows-latest",
  "Frontend macos-latest",
];

export function checkState(checks) {
  const states = requiredChecks.map((name) => {
    const check = checks.find((candidate) => candidate.name === name);
    return {
      name,
      state: !check
        ? "missing"
        : check.status === "completed"
          ? check.conclusion
          : "pending",
    };
  });
  const failed = states.find(
    ({ state }) =>
      state !== "success" && state !== "pending" && state !== "missing",
  );
  if (failed)
    throw new Error(
      `Required check '${failed.name}' concluded ${failed.state}.`,
    );
  return states.filter(({ state }) => state !== "success");
}

// Only pending/missing checks are retryable. A completed failure on the release
// commit must never be bypassed using green checks on its version-only parent.
export async function waitForGreenCi({
  commit,
  parent,
  readChecks,
  now = Date.now,
  sleep = setTimeout,
  log = console.log,
  timeoutMs = 20 * 60_000,
  intervalMs = 15_000,
}) {
  const deadline = now() + timeoutMs;
  while (true) {
    const pending = checkState(await readChecks(commit));
    if (pending.length === 0) return commit;
    if (parent && checkState(await readChecks(parent)).length === 0)
      return parent;
    if (now() >= deadline)
      throw new Error(
        `Timed out waiting for cross-platform CI for ${commit}. Retry after CI succeeds.`,
      );
    log(
      `Waiting for CI: ${pending.map(({ name, state }) => `${name}: ${state}`).join(", ")}`,
    );
    await sleep(Math.min(intervalMs, deadline - now()));
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [commit, repositoryRoot, ...extra] = process.argv.slice(2);
    if (!/^[0-9a-f]{40}$/.test(commit ?? "") || !repositoryRoot || extra.length)
      throw new Error("Expected a full commit SHA and repository root.");
    const repository = process.env.GITHUB_REPOSITORY;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? ""))
      throw new Error("Expected GITHUB_REPOSITORY.");
    const commandOptions = {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    };
    const verified = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("verify-version-only-bump.mjs", import.meta.url)),
        commit,
        repositoryRoot,
      ],
      commandOptions,
    );
    const parent =
      verified.status === 0
        ? execFileSync(
            "git",
            ["rev-parse", `${commit}^`],
            commandOptions,
          ).trim()
        : undefined;
    const accepted = await waitForGreenCi({
      commit,
      parent,
      readChecks: (sha) =>
        JSON.parse(
          execFileSync(
            "gh",
            [
              "api",
              `repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100`,
              "--jq",
              ".check_runs",
            ],
            commandOptions,
          ),
        ),
    });
    console.log(
      `Cross-platform CI is green for ${accepted}${accepted === commit ? "" : " (verified version-only parent)"}.`,
    );
  } catch (error) {
    console.error(`Release blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
