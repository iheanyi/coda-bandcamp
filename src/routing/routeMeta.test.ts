import { describe, expect, expectTypeOf, it } from "vitest";
import {
  codaRouteMeta,
  type CodaPrimaryView,
  type CodaScreen,
} from "./routeMeta";

describe("Coda route metadata", () => {
  it("describes a primary destination without mutable route state", () => {
    const metadata = codaRouteMeta("collection", "library");

    expect(metadata).toEqual({
      coda: { screen: "collection", primaryView: "library" },
    });
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.coda)).toBe(true);
    expectTypeOf(metadata.coda.screen).toEqualTypeOf<CodaScreen>();
    expectTypeOf(metadata.coda.primaryView).toEqualTypeOf<
      CodaPrimaryView | undefined
    >();
  });

  it("keeps Now Playing independent from primary sidebar state", () => {
    expect(codaRouteMeta("now-playing")).toEqual({
      coda: { screen: "now-playing" },
    });
  });
});
