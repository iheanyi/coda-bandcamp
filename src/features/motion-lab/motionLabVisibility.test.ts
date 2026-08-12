import { beforeEach, expect, it } from "vitest";

import { readMotionLabOpen, writeMotionLabOpen } from "./motionLabVisibility";

beforeEach(() => window.localStorage.clear());

it("persists Motion Lab visibility across renderer restarts", () => {
  expect(readMotionLabOpen()).toBe(false);

  writeMotionLabOpen(true);
  expect(readMotionLabOpen()).toBe(true);

  writeMotionLabOpen(false);
  expect(readMotionLabOpen()).toBe(false);
});
