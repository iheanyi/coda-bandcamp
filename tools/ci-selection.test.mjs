import assert from "node:assert/strict";
import test from "node:test";
import { shouldRunMatrix } from "./select-ci.mjs";
import { bundlerCacheRevision } from "./tauri-bundler-cache-key.mjs";

const push = {
  ref: "refs/heads/feature/audio",
  after: "abc123",
  repository: { full_name: "coda/player", owner: { login: "coda" } },
};
const matchingRuns = () => [
  { event: "pull_request", head_sha: "abc123", status: "queued" },
];
const matchingPull = {
  state: "open",
  head: {
    sha: "abc123",
    ref: "feature/audio",
    repo: { full_name: "coda/player" },
  },
};

test("main and PR events always run without consulting PR ownership", () => {
  const unexpectedLookup = () => assert.fail("Unnecessary API request");
  assert.equal(
    shouldRunMatrix(
      "push",
      { ...push, ref: "refs/heads/main" },
      unexpectedLookup,
    ),
    true,
  );
  assert.equal(shouldRunMatrix("pull_request", {}, unexpectedLookup), true);
});

test("only an open PR of the exact branch, repository and revision suppresses a push", () => {
  assert.equal(
    shouldRunMatrix(
      "push",
      push,
      (repository, head) => {
        assert.equal(repository, "coda/player");
        assert.equal(head, "coda:feature/audio");
        return [matchingPull];
      },
      matchingRuns,
    ),
    false,
  );
  for (const pulls of [
    [],
    {},
    [{ ...matchingPull, state: "closed" }],
    [{ ...matchingPull, head: { ...matchingPull.head, sha: "old" } }],
    [{ ...matchingPull, head: { ...matchingPull.head, ref: "other" } }],
    [
      {
        ...matchingPull,
        head: { ...matchingPull.head, repo: { full_name: "fork/player" } },
      },
    ],
  ]) {
    assert.equal(
      shouldRunMatrix("push", push, () => pulls),
      true,
    );
  }
});

test("lookup failures and incomplete events retain full push validation", () => {
  assert.equal(
    shouldRunMatrix("push", push, () => {
      throw new Error("API unavailable");
    }),
    true,
  );
  assert.equal(
    shouldRunMatrix("push", {}, () => assert.fail()),
    true,
  );
});

test("bundler revisions follow only the locked CLI version and explicit tool revision", () => {
  const lockfile = {
    version: "1.0.0",
    packages: { "node_modules/@tauri-apps/cli": { version: "2.8.4" } },
  };
  assert.equal(bundlerCacheRevision(lockfile), "v1-cli-2.8.4");
  assert.equal(
    bundlerCacheRevision({
      ...lockfile,
      version: "2.0.0",
      unrelated: "changed",
    }),
    "v1-cli-2.8.4",
  );
  assert.equal(
    bundlerCacheRevision({
      packages: { "node_modules/@tauri-apps/cli": { version: "2.9.0" } },
    }),
    "v1-cli-2.9.0",
  );
  for (const version of [undefined, 2, "2.0.0\nrevision=bad"]) {
    assert.throws(() =>
      bundlerCacheRevision({
        packages: { "node_modules/@tauri-apps/cli": { version } },
      }),
    );
  }
});

test("an open PR without a live validation run cannot suppress push checks", () => {
  for (const runs of [
    [],
    {},
    [{ event: "push", head_sha: "abc123", status: "queued" }],
    [{ event: "pull_request", head_sha: "old", status: "queued" }],
    [
      {
        event: "pull_request",
        head_sha: "abc123",
        status: "completed",
        conclusion: "cancelled",
      },
    ],
  ]) {
    assert.equal(
      shouldRunMatrix(
        "push",
        push,
        () => [matchingPull],
        () => runs,
      ),
      true,
    );
  }
  assert.equal(
    shouldRunMatrix(
      "push",
      push,
      () => [matchingPull],
      () => {
        throw new Error("API unavailable");
      },
    ),
    true,
  );
  for (const status of ["queued", "in_progress"]) {
    assert.equal(
      shouldRunMatrix(
        "push",
        push,
        () => [matchingPull],
        () => [{ event: "pull_request", head_sha: "abc123", status }],
      ),
      false,
    );
  }
  for (const conclusion of ["success", "failure", "timed_out"]) {
    assert.equal(
      shouldRunMatrix(
        "push",
        push,
        () => [matchingPull],
        () => [
          {
            event: "pull_request",
            head_sha: "abc123",
            status: "completed",
            conclusion,
          },
        ],
      ),
      false,
    );
  }
});
