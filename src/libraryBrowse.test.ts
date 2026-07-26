import { describe, expect, it } from "vitest";
import { groupAlbumsByArtist, matchesBrowseMode } from "./libraryBrowse";
import type { Album } from "./types";

const album = (
  id: string,
  artist: string,
  songCount: number,
  addedAt?: string,
): Album => ({
  id,
  title: `Release ${id}`,
  artist,
  songCount,
  duration: songCount * 180,
  addedAt,
  palette: ["#777", "#222"],
});

describe("library browsing", () => {
  it("classifies one-track purchases as singles and multi-track purchases as albums", () => {
    expect(matchesBrowseMode(album("single", "Artist", 1), "singles")).toBe(true);
    expect(matchesBrowseMode(album("single", "Artist", 1), "albums")).toBe(false);
    expect(matchesBrowseMode(album("ep", "Artist", 4), "albums")).toBe(true);
    expect(matchesBrowseMode(album("ep", "Artist", 4), "releases")).toBe(true);
  });

  it("groups artist names case-insensitively and collapses whitespace", () => {
    const groups = groupAlbumsByArtist([
      album("older", "Night  Archive", 2, "2025-01-01"),
      album("newer", " night archive ", 1, "2026-01-01"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      name: "Night Archive",
      releaseCount: 2,
      trackCount: 3,
      duration: 540,
    });
    expect(groups[0].representative.id).toBe("newer");
  });

  it("sorts the artist index alphabetically", () => {
    expect(
      groupAlbumsByArtist([
        album("z", "Zulu", 1),
        album("a", "Alpha", 1),
      ]).map((group) => group.name),
    ).toEqual(["Alpha", "Zulu"]);
  });
});
