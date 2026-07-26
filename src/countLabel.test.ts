import { describe, expect, it } from "vitest";
import { countLabel } from "./countLabel";

describe("countLabel", () => {
  it("uses the singular form only for exactly one", () => {
    expect(countLabel(1, "track")).toBe("1 track");
    expect(countLabel(0, "track")).toBe("0 tracks");
    expect(countLabel(2, "track")).toBe("2 tracks");
  });

  it("supports irregular plurals", () => {
    expect(countLabel(1, "result", "results")).toBe("1 result");
    expect(countLabel(2, "release", "releases")).toBe("2 releases");
  });
});
