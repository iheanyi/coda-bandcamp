import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Album, Track } from "@/types";
import {
  deriveLibraryBrowseController,
  useLibraryBrowseController,
  type LibraryBrowseControllerInput,
} from "./useLibraryBrowseController";

function album(
  id: string,
  artist: string,
  songCount: number,
  overrides: Partial<Album> = {},
): Album {
  return {
    id,
    title: `Release ${id}`,
    artist,
    songCount,
    duration: songCount * 180,
    palette: ["#777", "#222"],
    ...overrides,
  };
}

function derive(
  albums: readonly Album[],
  overrides: Partial<LibraryBrowseControllerInput> = {},
) {
  return deriveLibraryBrowseController({
    albums,
    browseMode: "releases",
    deferredQuery: "",
    fallbackAlbumCandidateTracks: [],
    genre: "All",
    ignoreDeferredArtistQuery: false,
    sort: "title",
    view: "library",
    ...overrides,
  });
}

describe("library browse controller", () => {
  it("orders featured genres first and derives collection counts", () => {
    const albums = [
      album("ambient-1", "A", 1, { genre: "ambient" }),
      album("ambient-2", "A", 4, { genre: "Ambient" }),
      album("jazz", "B", 2, { genre: "Jazz" }),
      album("rock", "C", 1, { genre: "Rock" }),
      album("folk", "D", 2, { genre: "Folk" }),
      album("metal", "E", 2, { genre: "Metal" }),
      album("blues", "F", 1, { genre: "Blues" }),
    ];

    const result = derive(albums);

    expect(result.orderedGenreTabs.slice(0, 5)).toEqual([
      "Ambient",
      "Blues",
      "Folk",
      "Jazz",
      "Metal",
    ]);
    expect(result.orderedGenreTabs.at(-1)).toBe("Rock");
    expect(result.counts).toEqual({ albums: 4, artists: 6, singles: 3 });
  });

  it("filters the search index and genre before applying the requested sort", () => {
    const albums = [
      album("z", "Alpha", 3, {
        genre: "Ambient",
        title: "Zulu Signal",
      }),
      album("a", "Zulu", 2, {
        genre: "Ambient",
        title: "Alpha Signal",
      }),
      album("other", "Alpha", 2, {
        genre: "Rock",
        title: "Other Signal",
      }),
    ];

    expect(
      derive(albums, {
        deferredQuery: "signal",
        genre: "Ambient",
        sort: "artist",
      }).visibleAlbums.map((item) => item.id),
    ).toEqual(["z", "a"]);
    expect(
      derive(albums, {
        browseMode: "artists",
        deferredQuery: "missing",
        ignoreDeferredArtistQuery: true,
        selectedArtist: "alpha",
      }).visibleAlbums.map((item) => item.id),
    ).toEqual(["other", "z"]);
  });

  it("forces Recent to release mode, newest-first, and twelve results", () => {
    const albums = Array.from({ length: 14 }, (_, index) =>
      album(String(index), "Artist", 1, {
        addedAt: `${String(index + 1).padStart(2, "0")} Jul 2025 12:00:00 GMT`,
      }),
    );

    const result = derive(albums, {
      browseMode: "artists",
      view: "recent",
    });

    expect(result.effectiveBrowseMode).toBe("releases");
    expect(result.visibleAlbums).toHaveLength(12);
    expect(result.visibleAlbums[0]?.id).toBe("13");
  });

  it("composes a guest artist's own releases with the selected compilation", () => {
    const ownRelease = album("own", "Guest Voice", 2, {
      addedAt: "02 Jul 2025 12:00:00 GMT",
    });
    const compilation = album("compilation", "Various Artists", 8, {
      addedAt: "01 Jul 2025 12:00:00 GMT",
    });
    const guestTracks: Track[] = [
      {
        id: "guest-1",
        title: "Glass Lines",
        artist: "Guest Voice",
        album: compilation.title,
        albumId: compilation.id,
        duration: 205,
        track: 1,
        palette: compilation.palette,
      },
      {
        id: "other-1",
        title: "Elsewhere",
        artist: "Other Voice",
        album: compilation.title,
        albumId: compilation.id,
        duration: 180,
        track: 2,
        palette: compilation.palette,
      },
    ];

    const result = derive([ownRelease, compilation], {
      browseMode: "artists",
      fallbackAlbumCandidateTracks: guestTracks,
      selectedArtist: "guest voice",
      selectedArtistFallback: {
        albumId: compilation.id,
        key: "guest voice",
        name: "Guest Voice",
      },
      sort: "recent",
    });

    expect(result.visibleAlbums.map((item) => item.id)).toEqual([
      "own",
      "compilation",
    ]);
    expect(result.activeArtist).toMatchObject({
      albums: [ownRelease, compilation],
      duration: ownRelease.duration + 205,
      key: "guest voice",
      releaseCount: 2,
      trackCount: ownRelease.songCount + 1,
      trackFilterAlbumId: "compilation",
      trackFilterArtistKey: "guest voice",
    });
  });

  it("keeps catalog totals through filtering and refreshes them when albums change", () => {
    const albums = [
      album("ambient", "Alpha", 2, { genre: "Ambient" }),
      album("rock", "Beta", 1, { genre: "Rock" }),
    ];
    const input: LibraryBrowseControllerInput = {
      albums,
      browseMode: "releases",
      deferredQuery: "",
      fallbackAlbumCandidateTracks: [],
      genre: "All",
      ignoreDeferredArtistQuery: false,
      sort: "title",
      view: "library",
    };
    const { result, rerender } = renderHook(useLibraryBrowseController, {
      initialProps: input,
    });
    const initialCounts = result.current.counts;
    const initialGenres = result.current.orderedGenreTabs;

    rerender({ ...input, genre: "  AMBIENT  ", deferredQuery: "ambient" });
    expect(result.current.visibleAlbums.map(({ id }) => id)).toEqual([
      "ambient",
    ]);
    expect(result.current.counts).toBe(initialCounts);
    expect(result.current.orderedGenreTabs).toBe(initialGenres);

    rerender({
      ...input,
      albums: [...albums, album("jazz", "Gamma", 3, { genre: "Jazz" })],
    });
    expect(result.current.counts).toEqual({
      albums: 2,
      artists: 3,
      singles: 1,
    });
    expect(result.current.orderedGenreTabs).toEqual([
      "Ambient",
      "Jazz",
      "Rock",
    ]);
    expect(result.current.visibleAlbums).toHaveLength(3);
  });

  it("groups only the selected artist instead of the full catalog", () => {
    const albums = [
      album("a", "Alpha", 2),
      album("b", "Beta", 1),
      album("c", "Gamma", 3),
    ];

    expect(
      derive(albums, {
        browseMode: "artists",
        selectedArtist: "beta",
      }).artistGroups.map((group) => group.key),
    ).toEqual(["beta"]);
  });
});
