import { describe, expect, it } from "vitest";

import { tryParseRouteId } from "./tryParseRouteId";

describe("tryParseRouteId", () => {
  it("returns undefined for missing values or thrown parsers", () => {
    expect(tryParseRouteId(undefined, Number)).toBeUndefined();
    expect(
      tryParseRouteId("bad", () => {
        throw new Error("invalid");
      }),
    ).toBeUndefined();
  });

  it("returns a parsed identity", () => {
    expect(tryParseRouteId("42", Number)).toBe(42);
  });
});
