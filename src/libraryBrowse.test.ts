import { describe, expect, it } from "vitest";
import {
  groupAlbumsByArtist,
  matchesBrowseMode,
  resolveAlbumSummary,
  summarizeLibraryCatalog,
  tracksForArtistGroupAlbum,
  tracksForScopeAlbum,
} from "./libraryBrowse";
import type { Album, Track } from "./types";

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
      album("older", "Night  Archive", 2, "30 Jun 2025 12:00:00 GMT"),
      album("newer", " night archive ", 1, "02 Jul 2025 12:00:00 GMT"),
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

  it("filters only the selected compilation while preserving an artist's own releases", () => {
    const ownTrack = {
      id: "own",
      title: "Own track",
      artist: "Night Archive",
      album: "Own release",
      albumId: "own-release",
      duration: 180,
      track: 1,
      palette: ["#777", "#222"],
    } satisfies Track;
    const compilationTracks = [
      { ...ownTrack, id: "appearance", albumId: "compilation" },
      {
        ...ownTrack,
        id: "other",
        artist: "Other Artist",
        albumId: "compilation",
      },
    ];
    const scope = {
      trackFilterAlbumId: "compilation",
      trackFilterArtistKey: "night archive",
    };

    expect(tracksForArtistGroupAlbum(scope, "own-release", [ownTrack]))
      .toEqual([ownTrack]);
    expect(
      tracksForArtistGroupAlbum(scope, "compilation", compilationTracks),
    ).toEqual([compilationTracks[0]]);
    expect(tracksForScopeAlbum(undefined, "own-release", [ownTrack])).toEqual([
      ownTrack,
    ]);
    expect(tracksForScopeAlbum(scope, "compilation", compilationTracks)).toEqual(
      [compilationTracks[0]],
    );
  });

  it("tallies collection counts and ordered genre tabs in one pass", () => {
    expect(
      summarizeLibraryCatalog([
        album("ambient-1", "A", 1),
        album("ambient-2", "A", 4),
        album("jazz", "B", 2),
        album("rock", "C", 1),
      ]),
    ).toEqual({
      counts: { albums: 2, artists: 3, singles: 2 },
      orderedGenreTabs: [],
    });
    expect(
      summarizeLibraryCatalog([
        { ...album("ambient-1", "A", 1), genre: "ambient" },
        { ...album("ambient-2", "A", 4), genre: "Ambient" },
        { ...album("jazz", "B", 2), genre: "Jazz" },
        { ...album("rock", "C", 1), genre: "Rock" },
        { ...album("folk", "D", 2), genre: "Folk" },
        { ...album("metal", "E", 2), genre: "Metal" },
        { ...album("blues", "F", 1), genre: "Blues" },
      ]).orderedGenreTabs,
    ).toEqual(["Ambient", "Blues", "Folk", "Jazz", "Metal", "Rock"]);
  });

  it("prefers the first matching source in call order", () => {
    const snapshot = album("kept", "A", 2);
    const catalogs = [album("other", "B", 1), { ...snapshot, title: "stale" }];
    expect(resolveAlbumSummary("kept", snapshot, catalogs)).toBe(snapshot);
    expect(resolveAlbumSummary("kept", catalogs, snapshot)?.title).toBe(
      "stale",
    );
    expect(resolveAlbumSummary("other", undefined, catalogs)?.id).toBe("other");
    expect(resolveAlbumSummary("missing", snapshot, catalogs)).toBeUndefined();
  });
});
