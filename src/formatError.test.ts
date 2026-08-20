import { describe, expect, it } from "vitest";
import { formatErrorMessage } from "./formatError";

describe("formatErrorMessage", () => {
  it("uses Error.message so subclasses do not leak their constructor name", () => {
    expect(formatErrorMessage(new Error("Could not save."))).toBe(
      "Could not save.",
    );
    expect(
      formatErrorMessage(new TypeError("Unsupported exhaustive variant: x")),
    ).toBe("Unsupported exhaustive variant: x");
  });

  it("stringifies non-Error values", () => {
    expect(formatErrorMessage("Could not save.")).toBe("Could not save.");
  });
});
