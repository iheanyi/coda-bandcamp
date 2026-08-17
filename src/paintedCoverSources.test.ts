import { describe, expect, it } from "vitest";
import { parsePaintedLocalCoverKeys } from "./paintedCoverSources";

describe("painted cover session persistence", () => {
  it("parses bounded hash keys and removes duplicates", () => {
    expect(parsePaintedLocalCoverKeys([
      "00000001",
      "00000002",
      "00000001",
    ])).toEqual(["00000001", "00000002"]);
    expect(parsePaintedLocalCoverKeys(
      Array.from(
        { length: 512 },
        (_value, index) => index.toString(16).padStart(8, "0"),
      ),
    )).toHaveLength(512);
  });

  it("rejects null, malformed, inherited, accessor, and spoofed entries", () => {
    const inherited: unknown[] = [];
    inherited.length = 1;
    Object.setPrototypeOf(inherited, { 0: "00000001" });
    let reads = 0;
    const accessor = ["00000001"];
    Object.defineProperty(accessor, "0", {
      get() {
        reads += 1;
        return "00000001";
      },
    });
    let coercions = 0;
    const spoofed = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        return "00000001";
      },
    };

    expect(parsePaintedLocalCoverKeys(null)).toBeUndefined();
    expect(parsePaintedLocalCoverKeys(["not-a-key"])).toBeUndefined();
    expect(parsePaintedLocalCoverKeys(inherited)).toBeUndefined();
    expect(parsePaintedLocalCoverKeys(accessor)).toBeUndefined();
    expect(reads).toBe(0);
    expect(parsePaintedLocalCoverKeys([spoofed])).toBeUndefined();
    expect(coercions).toBe(0);
  });

  it("rejects session payloads above the 512-key limit", () => {
    expect(parsePaintedLocalCoverKeys(
      Array.from({ length: 513 }, () => "00000001"),
    )).toBeUndefined();
  });
});
