import { describe, expect, it } from "vitest";
import { updaterEnabledForFlag } from "./appFlavor";

describe("app build flavor", () => {
  it("enables updates only for the explicit production flag", () => {
    expect(updaterEnabledForFlag("1")).toBe(true);
    expect(updaterEnabledForFlag("0")).toBe(false);
    expect(updaterEnabledForFlag(undefined)).toBe(false);
  });
});
