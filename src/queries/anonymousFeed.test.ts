import { describe, expect, it } from "vitest";
import {
  cursorNextPageParam,
  sequentialNextPageParam,
} from "./anonymousFeed";

describe("anonymous feed pagination", () => {
  it("returns a cursor only when the page says more results exist", () => {
    expect(
      cursorNextPageParam({ hasMore: true, cursor: "next" }),
    ).toBe("next");
    expect(
      cursorNextPageParam({ hasMore: false, cursor: "next" }),
    ).toBeUndefined();
    expect(cursorNextPageParam({ hasMore: true })).toBeUndefined();
  });

  it("increments a page number only when more results exist", () => {
    expect(sequentialNextPageParam({ hasMore: true, page: 2 })).toBe(3);
    expect(sequentialNextPageParam({ hasMore: false, page: 2 })).toBeUndefined();
  });
});
