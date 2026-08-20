import { describe, expect, it } from "vitest";

import { formatTime, initials } from "./formatting";

describe("formatTime", () => {
  it("formats bounded playback times", () => {
    expect(formatTime(-1)).toBe("0:00");
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3_661)).toBe("1:01:01");
  });
});

describe("initials", () => {
  it("keeps the first two letters of a name", () => {
    expect(initials("soft focus extra")).toBe("SF");
  });
});
