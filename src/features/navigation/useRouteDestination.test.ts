import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { createCodaMemoryRouter } from "@/router";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
  parsePlaylistIdParam,
} from "@/routing/routeContracts";

import {
  detailDestinationKey,
  projectRouteDestination,
  useRouteDestination,
} from "./useRouteDestination";

function createHookHarness(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createCodaMemoryRouter(queryClient, [initialEntry]);
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(RouterContextProvider, { router, children });
  return { router, wrapper };
}

describe("projectRouteDestination", () => {
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

    const destination = projectRouteDestination({
      artistMatch: {
        params: { artistKey },
        search: artistSearch,
      },
      meta: { screen: "artist", primaryView: "library" },
      routeLocation: {
        key: "entry-1",
        search: artistSearch,
      },
    });

    expect(destination.detail).toEqual({
      kind: "artist",
      artistKey,
      sourceAlbumId,
    });
    expect(destination.libraryRouteInput).toEqual({
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
    expect(destination.primaryView).toBe("library");
  });

  it("does not leak a stale typed match into a different active screen", () => {
    const playlistId = parsePlaylistIdParam("playlist-1");
    const destination = projectRouteDestination({
      albumMatch: {
        params: { albumId: parseAlbumIdParam("stale-album") },
      },
      discoverReleaseMatch: {
        params: {
          releaseId: parseDiscoverReleaseIdParam("discover:stale-release"),
        },
      },
      meta: { screen: "playlist", primaryView: "playlists" },
      playlistMatch: { params: { playlistId } },
      routeLocation: {
        key: "entry-1",
        search: {},
      },
    });

    expect(destination.detail).toEqual({ kind: "playlist", playlistId });
    expect(destination.libraryRouteInput).toEqual({
      kind: "inactive",
      reason: "non-library-screen",
      screen: "playlist",
    });
  });

  it("uses the href as a stable render key when history state has no key", () => {
    const destination = projectRouteDestination({
      meta: { screen: "now-playing" },
      routeLocation: {
        key: "/now-playing",
        search: {},
      },
    });

    expect(destination.locationKey).toBe("/now-playing");
    expect(destination.nowPlayingOpen).toBe(true);
    expect(detailDestinationKey(destination.detail)).toBe("now-playing");
  });
});

describe("useRouteDestination with the generated router", () => {
  it("projects the active artist match, metadata, search, and history key", async () => {
    const { router, wrapper } = createHookHarness(
      "/collection/artists/night%20archive?albumId=compilation-1&q=night&genre=Ambient&sort=artist&mode=artists",
    );
    await router.load();

    const { result } = renderHook(() => useRouteDestination(), { wrapper });
    const historyKey = router.state.location.state.__TSR_key;

    expect(historyKey).toBeDefined();
    expect(result.current.locationKey).toBe(historyKey);
    expect(result.current.meta).toEqual({
      primaryView: "library",
      screen: "artist",
    });
    expect(result.current.detail).toEqual({
      artistKey: parseArtistKeyParam("night archive"),
      kind: "artist",
      sourceAlbumId: parseAlbumIdParam("compilation-1"),
    });
    expect(result.current.collectionSearch).toEqual({
      genre: "Ambient",
      mode: "artists",
      q: "night",
      sort: "artist",
    });
    expect(result.current.libraryRouteInput).toMatchObject({
      kind: "artist",
      screen: "artist",
    });
  });

  it("tracks Discover search and a new history location through navigation", async () => {
    const { router, wrapper } = createHookHarness(
      "/collection?q=drone&genre=Ambient&sort=year&mode=albums",
    );
    await router.load();

    const { result } = renderHook(() => useRouteDestination(), { wrapper });
    const collectionLocationKey = result.current.locationKey;

    expect(result.current.meta).toEqual({
      primaryView: "library",
      screen: "collection",
    });
    expect(result.current.collectionSearch).toEqual({
      genre: "Ambient",
      mode: "albums",
      q: "drone",
      sort: "year",
    });

    await act(async () => {
      await router.navigate({
        search: { sort: "new", tag: "acid jazz" },
        to: "/discover",
      });
    });

    await waitFor(() => {
      expect(result.current.screen).toBe("discover");
    });
    expect(result.current.meta).toEqual({
      primaryView: "discover",
      screen: "discover",
    });
    expect(result.current.discoverSearch).toEqual({
      sort: "new",
      tag: "acid jazz",
    });
    expect(result.current.locationKey).toBe(
      router.state.location.state.__TSR_key,
    );
    expect(result.current.locationKey).not.toBe(collectionLocationKey);
  });
});
