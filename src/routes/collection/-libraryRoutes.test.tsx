import { render, screen } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { LibrarySessionRouteReader } from "@/features/library-session";
import {
  AlbumRouteNotFound,
  AlbumRoutePending,
  ArtistRouteNotFound,
  ArtistRoutePending,
} from "@/features/library/LibraryDetailRouteStatus";
import {
  type AlbumId,
  type ArtistKey,
  DEFAULT_COLLECTION_ROUTE_SEARCH,
  parseAlbumIdParam,
  parseArtistKeyParam,
  validateCollectionSearch,
} from "@/routing/routeContracts";
import { Route as RecentRoute } from "@/routes/recent";
import { loadAlbumRouteIdentity, Route as AlbumRoute } from "./albums/$albumId";
import {
  loadArtistRouteIdentity,
  Route as ArtistRoute,
  validateArtistRouteSearch,
} from "./artists/$artistKey";
import { Route as CollectionRoute } from "./route";

describe("library route identities", () => {
  it("keeps the album loader identity-only while starting a nonblocking preload", () => {
    const albumId = parseAlbumIdParam("album-1");
    const preloadAlbum = vi.fn();
    const librarySession: LibrarySessionRouteReader = {
      findCachedAlbum: () => undefined,
      findCachedAlbumTracks: () => undefined,
      getSnapshot: () => ({
        canPreloadAuthenticatedRoute: true,
        connection: "connected",
        ready: true,
      }),
      preloadAlbum,
    };
    const loaded = loadAlbumRouteIdentity({
      librarySession,
      params: { albumId },
    });

    expect(loaded).toEqual({ albumId });
    expect(loaded).not.toBeInstanceOf(Promise);
    expect(preloadAlbum).toHaveBeenCalledWith(albumId);
    expectTypeOf(loaded.albumId).toEqualTypeOf<AlbumId>();
  });

  it("keeps the artist loader synchronous and identity-only", () => {
    const artistKey = parseArtistKeyParam("signal garden");
    const loaded = loadArtistRouteIdentity({ params: { artistKey } });

    expect(loaded).toEqual({ artistKey });
    expect(loaded).not.toBeInstanceOf(Promise);
    expectTypeOf(loaded.artistKey).toEqualTypeOf<ArtistKey>();
  });
});

describe("artist route search", () => {
  it("preserves collection search and brands an optional source album", () => {
    const search = validateArtistRouteSearch({
      albumId: "album-1",
      genre: " Ambient ",
      mode: "artists",
      q: " Signal Garden ",
      sort: "artist",
    });

    expect(search).toEqual({
      albumId: "album-1",
      genre: "Ambient",
      mode: "artists",
      q: "Signal Garden",
      sort: "artist",
    });
    expectTypeOf(search.albumId).toEqualTypeOf<AlbumId | undefined>();
  });

  it("drops a malformed source album without discarding valid filters", () => {
    expect(
      validateArtistRouteSearch({
        albumId: "https://bandcamp.com/album/unsafe",
        genre: "Jazz",
        mode: "artists",
        q: "Signal",
        sort: "title",
      }),
    ).toEqual({
      genre: "Jazz",
      mode: "artists",
      q: "Signal",
      sort: "title",
    });
    expect(validateArtistRouteSearch(undefined)).toEqual(
      DEFAULT_COLLECTION_ROUTE_SEARCH,
    );
  });
});

describe("library route boundaries", () => {
  it("keeps collection and Recent URL state on the collection schema", () => {
    expect(CollectionRoute.options.validateSearch).toBe(
      validateCollectionSearch,
    );
    expect(RecentRoute.options.validateSearch).toBe(validateCollectionSearch);
  });

  it("registers explicit pending and not-found boundaries for details", () => {
    expect(AlbumRoute.options.pendingComponent).toBe(AlbumRoutePending);
    expect(AlbumRoute.options.notFoundComponent).toBeDefined();
    expect(ArtistRoute.options.pendingComponent).toBe(ArtistRoutePending);
    expect(ArtistRoute.options.notFoundComponent).toBeDefined();
    expect(AlbumRouteNotFound).toBeTypeOf("function");
    expect(ArtistRouteNotFound).toBeTypeOf("function");
  });

  it("announces pending album and artist identities", () => {
    const view = render(<AlbumRoutePending />);
    expect(screen.getByRole("status")).toHaveTextContent("Opening album…");

    view.rerender(<ArtistRoutePending />);
    expect(screen.getByRole("status")).toHaveTextContent("Opening artist…");
  });
});
