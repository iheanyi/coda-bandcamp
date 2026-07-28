import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, test } from "vitest";

const scriptPath = join(process.cwd(), "tools", "verify-release-draft.mjs");
const temporaryDirectories = [];
const tag = "v1.2.3";
const runId = "987654";
const commitSha = "0123456789abcdef0123456789abcdef01234567";
const marker =
  `<!-- coda-release-run:${runId} coda-release-commit:${commitSha} -->`;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function runVerifier(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "coda-release-draft-"));
  temporaryDirectories.push(root);
  const releasePath = join(root, "release.json");
  writeFileSync(
    releasePath,
    JSON.stringify({
      body: `Generated notes\n\n${marker}`,
      isDraft: true,
      tagName: tag,
      ...overrides,
    }),
  );

  return spawnSync(
    process.execPath,
    [scriptPath, tag, commitSha, runId, releasePath],
    { encoding: "utf8" },
  );
}

test("accepts a draft owned by the exact workflow run and commit", () => {
  const result = runVerifier();

  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/Verified draft ownership for v1\.2\.3/);
});

test.each([
  ["published release", { isDraft: false }, /must still be a draft/i],
  ["different tag", { tagName: "v1.2.2" }, /tag must be v1\.2\.3/i],
  [
    "different run",
    {
      body:
        `Generated notes\n\n` +
        `<!-- coda-release-run:111111 coda-release-commit:${commitSha} -->`,
    },
    /does not belong to workflow run/i,
  ],
  [
    "different commit",
    {
      body:
        `Generated notes\n\n` +
        `<!-- coda-release-run:${runId} ` +
        "coda-release-commit:ffffffffffffffffffffffffffffffffffffffff -->",
    },
    /does not belong to workflow run/i,
  ],
])("rejects a %s", (_name, overrides, expectedError) => {
  const result = runVerifier(overrides);

  expect(result.status).not.toBe(0);
  expect(result.stderr).toMatch(expectedError);
});
