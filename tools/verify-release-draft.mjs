#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const exactTagPattern =
  /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const commitPattern = /^[0-9a-f]{40}$/;
const runIdPattern = /^\d+$/;
const maximumBodyLength = 1_000_000;
const [, , tag, commitSha, runId, releaseArgument, ...extraArguments] =
  process.argv;

if (
  !exactTagPattern.test(tag ?? "") ||
  !commitPattern.test(commitSha ?? "") ||
  !runIdPattern.test(runId ?? "") ||
  !releaseArgument ||
  extraArguments.length > 0
) {
  console.error(
    "Expected a vX.Y.Z tag, 40-character commit SHA, decimal run ID, and release metadata path.\n" +
      "Usage: node tools/verify-release-draft.mjs v1.2.3 <commit> <run-id> release.json",
  );
  process.exitCode = 1;
} else {
  try {
    const release = readJson(releaseArgument);
    const errors = verifyDraft(release);

    if (errors.length > 0) {
      console.error(
        `Release draft ${tag} failed ownership verification:\n${errors.join("\n")}`,
      );
      process.exitCode = 1;
    } else {
      console.log(`Verified draft ownership for ${tag}.`);
    }
  } catch (error) {
    console.error(
      `Release draft verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(
      `Could not read ${basename(path)}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function verifyDraft(release) {
  if (!isRecord(release)) {
    return ["- release metadata must contain a JSON object"];
  }

  const errors = [];

  if (release.tagName !== tag) {
    errors.push(`- release tag must be ${tag}`);
  }

  if (release.isDraft !== true) {
    errors.push("- release must still be a draft");
  }

  const marker =
    `<!-- coda-release-run:${runId} ` +
    `coda-release-commit:${commitSha} -->`;
  if (
    typeof release.body !== "string" ||
    release.body.length > maximumBodyLength ||
    !release.body.split(/\r?\n/).includes(marker)
  ) {
    errors.push(
      `- release does not belong to workflow run ${runId} and commit ${commitSha}`,
    );
  }

  return errors;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
