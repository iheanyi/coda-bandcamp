import { describe, expect, expectTypeOf, it } from "vitest";
import {
  type AlbumId,
  type ArtistKey,
  DEFAULT_COLLECTION_ROUTE_SEARCH,
  DEFAULT_DAILY_ROUTE_SEARCH,
  DEFAULT_DISCOVER_ROUTE_SEARCH,
  type DiscoverReleaseId,
  MAX_ARTIST_KEY_BYTES,
  MAX_DISCOVER_RELEASE_ID_BYTES,
  MAX_DISCOVER_TAG_BYTES,
  MAX_RADIO_SHOW_ID,
  MAX_ROUTE_SEARCH_TEXT_BYTES,
  MAX_SUBSONIC_ROUTE_ID_BYTES,
  type PlaylistId,
  isDiscoverReleaseId,
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
  parsePlaylistIdParam,
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
  parseRouteSearchAlbumId,
  type RadioSeriesId,
  type RadioShowId,
  stringifyAlbumIdParam,
  stringifyArtistKeyParam,
  stringifyDiscoverReleaseIdParam,
  stringifyPlaylistIdParam,
  stringifyRadioSeriesIdParam,
  stringifyRadioShowIdParam,
  validateCollectionSearch,
  validateDailySearch,
  validateDiscoverSearch,
} from "./routeContracts";

describe("collection route search", () => {
  it.each([undefined, null, [], "search", 12])(
    "uses deterministic defaults for a malformed root value (%j)",
    (value) => {
      expect(validateCollectionSearch(value)).toEqual(
        DEFAULT_COLLECTION_ROUTE_SEARCH,
      );
    },
  );

  it("normalizes bounded text and preserves valid domain values", () => {
    expect(
      validateCollectionSearch({
        q: "  deep house  ",
        genre: "  Ambient  ",
        sort: "artist",
        mode: "albums",
      }),
    ).toEqual({
      q: "deep house",
      genre: "Ambient",
      sort: "artist",
      mode: "albums",
    });
    expect(validateCollectionSearch({ genre: "all" }).genre).toBe("All");
  });

  it("defaults malformed field containers and enum values independently", () => {
    expect(
      validateCollectionSearch({
        q: ["drone"],
        genre: { name: "Ambient" },
        sort: ["year"],
        mode: { value: "artists" },
      }),
    ).toEqual(DEFAULT_COLLECTION_ROUTE_SEARCH);

    expect(
      validateCollectionSearch({ sort: "newest", mode: "tracks" }),
    ).toMatchObject({ sort: "recent", mode: "releases" });
  });

  it("does not coerce nested route fields into primitive owner values", () => {
    expect(
      validateCollectionSearch({
        q: { value: "drone" },
        genre: ["Ambient"],
        sort: { value: "year" },
        mode: ["artists"],
      }),
    ).toEqual(DEFAULT_COLLECTION_ROUTE_SEARCH);
    expect(
      parseRouteSearchAlbumId({ albumId: { value: "album-1" } }),
    ).toBeUndefined();
  });

  it("rejects controls and text beyond the native metadata byte bound", () => {
    expect(validateCollectionSearch({ q: "ambient\u0000" }).q).toBe("");
    expect(validateCollectionSearch({ genre: "Jazz\n" }).genre).toBe("All");
    expect(
      validateCollectionSearch({
        q: "x".repeat(MAX_ROUTE_SEARCH_TEXT_BYTES + 1),
        genre: "😀".repeat(MAX_ROUTE_SEARCH_TEXT_BYTES / 4 + 1),
      }),
    ).toMatchObject({ q: "", genre: "All" });
  });
});

describe("Discover route search", () => {
  it("uses deterministic defaults for absent or malformed values", () => {
    expect(validateDiscoverSearch(undefined)).toEqual(
      DEFAULT_DISCOVER_ROUTE_SEARCH,
    );
    expect(validateDiscoverSearch([])).toEqual(DEFAULT_DISCOVER_ROUTE_SEARCH);
    expect(validateDiscoverSearch({ tag: ["jazz"], sort: {} })).toEqual(
      DEFAULT_DISCOVER_ROUTE_SEARCH,
    );
  });

  it("normalizes a valid tag and sort", () => {
    expect(
      validateDiscoverSearch({ tag: "  acid jazz  ", sort: "new" }),
    ).toEqual({ tag: "acid jazz", sort: "new" });
  });

  it("defaults controls, overlong tags, and invalid sort values", () => {
    expect(
      validateDiscoverSearch({ tag: "metal\u007f", sort: "popular" }),
    ).toEqual(DEFAULT_DISCOVER_ROUTE_SEARCH);
    expect(
      validateDiscoverSearch({
        tag: "😀".repeat(MAX_DISCOVER_TAG_BYTES / 4 + 1),
        sort: "top",
      }),
    ).toEqual(DEFAULT_DISCOVER_ROUTE_SEARCH);
  });
});

describe("Bandcamp Daily route search", () => {
  it("preserves the six supported categories", () => {
    expect(validateDailySearch({ category: "essential-releases" })).toEqual({
      category: "essential-releases",
    });
  });

  it.each([undefined, null, [], "lists", { category: "latest" }])(
    "defaults a malformed category search (%j)",
    (value) => {
      expect(validateDailySearch(value)).toEqual(DEFAULT_DAILY_ROUTE_SEARCH);
    },
  );
});

describe("Radio route parameters", () => {
  it("models the exact supported Radio series catalog", () => {
    expectTypeOf<RadioSeriesId>().toEqualTypeOf<1 | 2 | 4 | 5 | 6 | 7>();
  });

  it.each([1, 2, 4, 5, 6, 7] as const)(
    "round-trips supported Radio series ID %i",
    (value) => {
      const seriesId = parseRadioSeriesIdParam(String(value));
      expect(stringifyRadioSeriesIdParam(seriesId)).toBe(String(value));
      expectTypeOf(seriesId).toEqualTypeOf<RadioSeriesId>();
    },
  );

  it("keeps bounded show IDs distinct from the series catalog", () => {
    const showId = parseRadioShowIdParam("979");

    expect(stringifyRadioShowIdParam(showId)).toBe("979");
    expect(parseRadioShowIdParam(String(MAX_RADIO_SHOW_ID))).toBe(
      MAX_RADIO_SHOW_ID,
    );
    expectTypeOf(showId).toEqualTypeOf<RadioShowId>();
    expectTypeOf<RadioSeriesId>().not.toEqualTypeOf<RadioShowId>();
  });

  it.each([3, 8, 979, MAX_RADIO_SHOW_ID])(
    "rejects unsupported positive series ID %i",
    (value) => {
      expect(() => parseRadioSeriesIdParam(value)).toThrow(TypeError);
      expect(() => {
        // @ts-expect-error Verify runtime hardening against an unbranded ID.
        stringifyRadioSeriesIdParam(value);
      }).toThrow(TypeError);
    },
  );

  it("rejects a show ID beyond the native maximum", () => {
    const value = MAX_RADIO_SHOW_ID + 1;
    expect(() => parseRadioShowIdParam(value)).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error Verify runtime hardening against an unbranded ID.
      stringifyRadioShowIdParam(value);
    }).toThrow(TypeError);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    "0",
    "01",
    "+1",
    "1.0",
    "1e3",
    " 1",
    String(MAX_RADIO_SHOW_ID + 1),
    "https://bandcamp.com/radio/979",
  ])("rejects an invalid numeric ID (%j)", (value) => {
    expect(() => parseRadioSeriesIdParam(value)).toThrow(TypeError);
    expect(() => parseRadioShowIdParam(value)).toThrow(TypeError);
  });

  it.each([[979], { id: 979 }])(
    "rejects a non-scalar numeric ID (%j)",
    (value) => {
      expect(() => {
        parseRadioSeriesIdParam(value);
      }).toThrow(TypeError);
      expect(() => {
        parseRadioShowIdParam(value);
      }).toThrow(TypeError);
    },
  );
});

describe("domain route parameters", () => {
  it("round-trips independently branded album and playlist IDs", () => {
    const albumId = parseAlbumIdParam("album-42");
    const playlistId = parsePlaylistIdParam("playlist-42");

    expect(stringifyAlbumIdParam(albumId)).toBe("album-42");
    expect(stringifyPlaylistIdParam(playlistId)).toBe("playlist-42");
    expectTypeOf(albumId).toEqualTypeOf<AlbumId>();
    expectTypeOf(playlistId).toEqualTypeOf<PlaylistId>();
    expectTypeOf<AlbumId>().not.toEqualTypeOf<PlaylistId>();
    expectTypeOf<
      PlaylistId extends AlbumId ? true : false
    >().toEqualTypeOf<false>();
  });

  it("accepts exact native byte boundaries for Subsonic IDs", () => {
    const albumId = parseAlbumIdParam("a".repeat(MAX_SUBSONIC_ROUTE_ID_BYTES));
    const playlistId = parsePlaylistIdParam(
      "😀".repeat(MAX_SUBSONIC_ROUTE_ID_BYTES / 4),
    );

    expect(stringifyAlbumIdParam(albumId)).toHaveLength(
      MAX_SUBSONIC_ROUTE_ID_BYTES,
    );
    expect(stringifyPlaylistIdParam(playlistId)).toHaveLength(
      MAX_SUBSONIC_ROUTE_ID_BYTES / 2,
    );
  });

  it.each([
    "",
    " album-1",
    "album-1 ",
    "album\u0000-1",
    "https://bandcamp.com/album/one",
    "HTTPS://bandcamp.com/album/one",
    "//bandcamp.com/album/one",
    "x".repeat(MAX_SUBSONIC_ROUTE_ID_BYTES + 1),
    "😀".repeat(MAX_SUBSONIC_ROUTE_ID_BYTES / 4 + 1),
  ])("rejects an invalid Subsonic ID string (%j)", (value) => {
    expect(() => parseAlbumIdParam(value)).toThrow(TypeError);
    expect(() => parsePlaylistIdParam(value)).toThrow(TypeError);
  });

  it.each([42, ["album-1"], { id: "album-1" }])(
    "rejects a non-string Subsonic ID (%j)",
    (value) => {
      expect(() => {
        parseAlbumIdParam(value);
      }).toThrow(TypeError);
      expect(() => {
        parsePlaylistIdParam(value);
      }).toThrow(TypeError);
    },
  );

  it("requires the Discover namespace and includes it in the byte bound", () => {
    const boundary = parseDiscoverReleaseIdParam(
      `discover:${"x".repeat(MAX_DISCOVER_RELEASE_ID_BYTES - "discover:".length)}`,
    );

    expect(stringifyDiscoverReleaseIdParam(boundary)).toHaveLength(
      MAX_DISCOVER_RELEASE_ID_BYTES,
    );
    expectTypeOf(boundary).toEqualTypeOf<DiscoverReleaseId>();
    expectTypeOf<
      DiscoverReleaseId extends AlbumId ? true : false
    >().toEqualTypeOf<false>();
    expect(isDiscoverReleaseId(boundary)).toBe(true);
    expect(isDiscoverReleaseId("release-42")).toBe(false);
  });

  it.each([
    "release-42",
    "Discover:release-42",
    "discover:",
    "discover: release-42",
    "discover:release\u0000-42",
    `discover:${"x".repeat(MAX_DISCOVER_RELEASE_ID_BYTES - "discover:".length + 1)}`,
  ])("rejects an invalid Discover release ID (%s)", (value) => {
    expect(() => parseDiscoverReleaseIdParam(value)).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error Verify runtime hardening against an unbranded ID.
      stringifyDiscoverReleaseIdParam(value);
    }).toThrow(TypeError);
  });

  it("round-trips canonical, bounded artist keys", () => {
    const artist = parseArtistKeyParam("boards of canada");
    const boundary = parseArtistKeyParam("a".repeat(MAX_ARTIST_KEY_BYTES));

    expect(stringifyArtistKeyParam(artist)).toBe("boards of canada");
    expect(stringifyArtistKeyParam(boundary)).toHaveLength(
      MAX_ARTIST_KEY_BYTES,
    );
    expectTypeOf(artist).toEqualTypeOf<ArtistKey>();
    expectTypeOf<
      ArtistKey extends AlbumId ? true : false
    >().toEqualTypeOf<false>();
  });

  it.each([
    "Boards of Canada",
    "boards  of canada",
    " boards of canada",
    "boards of canada ",
    "boards\tof canada",
    "https://bandcamp.com/boards-of-canada",
    "😀".repeat(MAX_ARTIST_KEY_BYTES / 4 + 1),
  ])("rejects a noncanonical artist key (%s)", (value) => {
    expect(() => parseArtistKeyParam(value)).toThrow(TypeError);
    expect(() => {
      // @ts-expect-error Verify runtime hardening against an unbranded key.
      stringifyArtistKeyParam(value);
    }).toThrow(TypeError);
  });
});
