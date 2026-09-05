import assert from "node:assert/strict";
import test from "node:test";
import { requiredChecks, waitForGreenCi } from "./require-green-ci.mjs";

const green = () =>
  requiredChecks.map((name) => ({
    name,
    status: "completed",
    conclusion: "success",
  }));
const quiet = { log() {} };

test("accepts all six successful checks without waiting", async () => {
  assert.equal(
    await waitForGreenCi({
      ...quiet,
      commit: "release",
      readChecks: () => green(),
      sleep: () => assert.fail("must not wait"),
    }),
    "release",
  );
});

test("waits for missing and pending checks on the same commit", async () => {
  let clock = 0;
  const observed = [];
  assert.equal(
    await waitForGreenCi({
      ...quiet,
      commit: "release",
      readChecks: (sha) => {
        observed.push(sha);
        return clock === 0
          ? []
          : clock === 10
            ? [{ name: requiredChecks[0], status: "in_progress" }]
            : green();
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      intervalMs: 10,
      timeoutMs: 30,
    }),
    "release",
  );
  assert.deepEqual(observed, ["release", "release", "release"]);
});

test("completed failures cannot use a successful parent or wait", async () => {
  for (const conclusion of [
    "failure",
    "cancelled",
    "timed_out",
    "action_required",
    "skipped",
    "neutral",
    null,
  ]) {
    await assert.rejects(
      waitForGreenCi({
        ...quiet,
        commit: "release",
        parent: "parent",
        readChecks: (sha) => {
          assert.equal(sha, "release");
          return [
            { name: requiredChecks.at(-1), status: "completed", conclusion },
          ];
        },
        sleep: () => assert.fail("must fail immediately"),
      }),
      /Required check/,
    );
  }
});

test("allows a verified version-only parent while exact checks are missing", async () => {
  assert.equal(
    await waitForGreenCi({
      ...quiet,
      commit: "release",
      parent: "parent",
      readChecks: (sha) => (sha === "parent" ? green() : []),
    }),
    "parent",
  );
});

test("bounds waiting and stops on a failed parent", async () => {
  let clock = 0;
  await assert.rejects(
    waitForGreenCi({
      ...quiet,
      commit: "release",
      readChecks: () => [],
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      timeoutMs: 25,
      intervalMs: 10,
    }),
    /Timed out/,
  );
  assert.equal(clock, 25);
  await assert.rejects(
    waitForGreenCi({
      ...quiet,
      commit: "release",
      parent: "parent",
      readChecks: (sha) =>
        sha === "parent"
          ? [
              {
                name: requiredChecks[0],
                status: "completed",
                conclusion: "failure",
              },
            ]
          : [],
    }),
    /Required check/,
  );
});

test("fails closed on API errors", async () => {
  await assert.rejects(
    waitForGreenCi({
      ...quiet,
      commit: "release",
      readChecks: () => {
        throw new Error("API unavailable");
      },
    }),
    /API unavailable/,
  );
});
