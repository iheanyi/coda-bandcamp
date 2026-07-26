import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  libraryQueryKey,
  mergeLibraryProgress,
  updateLibraryData,
} from "./libraryQueries";
import type { Album } from "./types";

const album = (id: string, title = id): Album => ({
  id,
  title,
  artist: "Night Archive",
  songCount: 1,
  duration: 120,
  palette: ["#777", "#222"],
});

describe("library query helpers", () => {
  it("supports React-style value and functional library updates", () => {
    const client = new QueryClient();
    updateLibraryData(client, [album("one")]);
    updateLibraryData(client, (current) => [...current, album("two")]);

    expect(client.getQueryData(libraryQueryKey)).toEqual([
      expect.objectContaining({ id: "one" }),
      expect.objectContaining({ id: "two" }),
    ]);
  });

  it("merges progressive pages without duplicating cached albums", () => {
    const current = [album("one", "Old"), album("two")];
    const merged = mergeLibraryProgress(current, {
      pageIndex: 0,
      loaded: 2,
      albums: [album("one", "Fresh"), album("three")],
    });

    expect(merged.map((item) => [item.id, item.title])).toEqual([
      ["one", "Fresh"],
      ["two", "two"],
      ["three", "three"],
    ]);
  });
});
