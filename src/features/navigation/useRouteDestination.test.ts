import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
  parsePlaylistIdParam,
} from "@/routing/routeContracts";
import type { CodaRouteMeta } from "@/routing/routeMeta";

const routeMocks = vi.hoisted(() => ({
  location: {
    href: "/collection",
    search: {} as unknown,
    state: { __TSR_key: "entry-1" as string | undefined },
  },
  matches: new Map<string, unknown>(),
  meta: undefined as CodaRouteMeta | undefined,
}));

vi.mock("@tanstack/react-router", () => ({
  useMatch: ({ from }: Readonly<{ from: string }>) =>
    routeMocks.matches.get(from),
  useRouterState: ({
    select,
  }: Readonly<{ select: (state: unknown) => unknown }>) =>
    select({ location: routeMocks.location }),
}));

vi.mock("@/routing/useCodaRouteMeta", () => ({
  useCodaRouteMeta: () => routeMocks.meta,
}));

import {
  detailDestinationKey,
  useRouteDestination,
} from "./useRouteDestination";

beforeEach(() => {
  routeMocks.location = {
    href: "/collection",
    search: {},
    state: { __TSR_key: "entry-1" },
  };
  routeMocks.matches.clear();
  routeMocks.meta = undefined;
});

describe("useRouteDestination", () => {
  it("derives an artist destination and bounded collection input from typed matches", () => {
    const artistKey = parseArtistKeyParam("night archive");
    const sourceAlbumId = parseAlbumIdParam("compilation-1");
    const artistSearch = {
      albumId: sourceAlbumId,
      genre: "Ambient",
      mode: "artists" as const,
      q: "night",
      sort: "artist" as const,
    };
    routeMocks.meta = { screen: "artist", primaryView: "library" };
    routeMocks.location.search = artistSearch;
    routeMocks.matches.set("/collection/artists/$artistKey", {
      params: { artistKey },
      search: artistSearch,
    });

    const { result } = renderHook(() => useRouteDestination());

    expect(result.current.detail).toEqual({
      kind: "artist",
      artistKey,
      sourceAlbumId,
    });
    expect(result.current.libraryRouteInput).toEqual({
      kind: "artist",
      screen: "artist",
      artistKey,
      sourceAlbumId,
      collectionSearch: {
        genre: "Ambient",
        mode: "artists",
        q: "night",
        sort: "artist",
      },
    });
    expect(result.current.primaryView).toBe("library");
  });

  it("does not leak a stale typed match into a different active screen", () => {
    routeMocks.meta = { screen: "playlist", primaryView: "playlists" };
    routeMocks.matches.set("/collection/albums/$albumId", {
      params: { albumId: parseAlbumIdParam("stale-album") },
      search: {},
    });
    routeMocks.matches.set("/discover/releases/$releaseId", {
      params: {
        releaseId: parseDiscoverReleaseIdParam("discover:stale-release"),
      },
      search: {},
    });
    const playlistId = parsePlaylistIdParam("playlist-1");
    routeMocks.matches.set("/playlists/$playlistId", {
      params: { playlistId },
      search: {},
    });

    const { result } = renderHook(() => useRouteDestination());

    expect(result.current.detail).toEqual({ kind: "playlist", playlistId });
    expect(result.current.libraryRouteInput).toEqual({
      kind: "inactive",
      reason: "non-library-screen",
      screen: "playlist",
    });
  });

  it("uses the href as a stable render key when history state has no key", () => {
    routeMocks.meta = { screen: "now-playing" };
    routeMocks.location = {
      href: "/now-playing",
      search: {},
      state: { __TSR_key: undefined },
    };

    const { result } = renderHook(() => useRouteDestination());

    expect(result.current.locationKey).toBe("/now-playing");
    expect(result.current.nowPlayingOpen).toBe(true);
    expect(detailDestinationKey(result.current.detail)).toBe("now-playing");
  });
});
