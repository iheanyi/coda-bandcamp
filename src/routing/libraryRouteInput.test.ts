import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  AlbumId,
  ArtistKey,
  CollectionRouteSearch,
} from "./routeContracts";
import {
  deriveLibraryRouteInput,
  libraryRouteChromeVisibility,
} from "./libraryRouteInput";

describe("library route input", () => {
  it.each([
    ["collection", { browse: true, filter: true }],
    ["recent", { browse: false, filter: true }],
    ["album", { browse: false, filter: false }],
    ["artist", { browse: false, filter: false }],
  ] as const)("selects only the chrome owned by %s routes", (screen, expected) => {
    const input = deriveLibraryRouteInput({
      albumId: screen === "album" ? "album-1" : undefined,
      artistKey: screen === "artist" ? "artist" : undefined,
      screen,
      search: undefined,
    });

    expect(libraryRouteChromeVisibility(input)).toEqual(expected);
  });

  it.each([undefined, "favorites", "discover", "now-playing"] as const)(
    "keeps the non-library screen %s inactive",
    (screen) => {
      expect(
        deriveLibraryRouteInput({
          screen,
          search: { q: "ignored" },
        }),
      ).toEqual({
        kind: "inactive",
        reason: "non-library-screen",
        screen,
      });
    },
  );

  it("normalizes collection search synchronously", () => {
    const input = deriveLibraryRouteInput({
      screen: "collection",
      search: {
        genre: "  Ambient  ",
        mode: "albums",
        q: "  drone  ",
        sort: "artist",
      },
    });

    expect(input).toEqual({
      kind: "collection",
      screen: "collection",
      collectionSearch: {
        genre: "Ambient",
        mode: "albums",
        q: "drone",
        sort: "artist",
      },
    });
    if (input.kind === "collection") {
      expectTypeOf(
        input.collectionSearch,
      ).toEqualTypeOf<CollectionRouteSearch>();
    }
  });

  it("preserves Recent as its own library route kind", () => {
    expect(
      deriveLibraryRouteInput({
        screen: "recent",
        search: { q: "new", sort: "year" },
      }),
    ).toEqual({
      kind: "recent",
      screen: "recent",
      collectionSearch: {
        genre: "All",
        mode: "releases",
        q: "new",
        sort: "year",
      },
    });
  });

  it("exposes a validated, branded album identity", () => {
    const input = deriveLibraryRouteInput({
      albumId: "album-42",
      screen: "album",
      search: { genre: "Jazz", mode: "singles" },
    });

    expect(input).toEqual({
      kind: "album",
      screen: "album",
      albumId: "album-42",
      collectionSearch: {
        genre: "Jazz",
        mode: "singles",
        q: "",
        sort: "recent",
      },
    });
    if (input.kind === "album") {
      expectTypeOf(input.albumId).toEqualTypeOf<AlbumId>();
    }
  });

  it.each([
    [undefined, "missing-album-id"],
    ["https://example.com/album", "invalid-album-id"],
    [" album-42", "invalid-album-id"],
  ] as const)(
    "makes an unusable album identity inactive (%s)",
    (albumId, reason) => {
      expect(
        deriveLibraryRouteInput({
          albumId,
          screen: "album",
          search: { q: "kept" },
        }),
      ).toEqual({
        kind: "inactive",
        reason,
        screen: "album",
        collectionSearch: {
          genre: "All",
          mode: "releases",
          q: "kept",
          sort: "recent",
        },
      });
    },
  );

  it("exposes branded artist and optional source-album identities", () => {
    const input = deriveLibraryRouteInput({
      artistKey: "boards of canada",
      screen: "artist",
      search: { mode: "artists", q: "boards" },
      sourceAlbumId: "source-album",
    });

    expect(input).toEqual({
      kind: "artist",
      screen: "artist",
      artistKey: "boards of canada",
      sourceAlbumId: "source-album",
      collectionSearch: {
        genre: "All",
        mode: "artists",
        q: "boards",
        sort: "recent",
      },
    });
    if (input.kind === "artist") {
      expectTypeOf(input.artistKey).toEqualTypeOf<ArtistKey>();
      expectTypeOf(input.sourceAlbumId).toEqualTypeOf<AlbumId | undefined>();
    }
  });

  it.each([
    [undefined, "missing-artist-key"],
    ["Boards of Canada", "invalid-artist-key"],
    ["https://example.com/artist", "invalid-artist-key"],
  ] as const)(
    "makes an unusable artist identity inactive (%s)",
    (artistKey, reason) => {
      expect(
        deriveLibraryRouteInput({
          artistKey,
          screen: "artist",
          search: undefined,
        }),
      ).toEqual({
        kind: "inactive",
        reason,
        screen: "artist",
        collectionSearch: {
          genre: "All",
          mode: "releases",
          q: "",
          sort: "recent",
        },
      });
    },
  );

  it("drops an invalid optional source album without invalidating the artist", () => {
    expect(
      deriveLibraryRouteInput({
        artistKey: "four tet",
        screen: "artist",
        search: undefined,
        sourceAlbumId: "//example.com/album",
      }),
    ).toEqual({
      kind: "artist",
      screen: "artist",
      artistKey: "four tet",
      collectionSearch: {
        genre: "All",
        mode: "releases",
        q: "",
        sort: "recent",
      },
    });
  });

  it("ignores detail identities when the current screen is the collection", () => {
    expect(
      deriveLibraryRouteInput({
        albumId: "https://example.com/not-used",
        artistKey: "Not Canonical",
        screen: "collection",
        search: undefined,
      }).kind,
    ).toBe("collection");
  });
});
