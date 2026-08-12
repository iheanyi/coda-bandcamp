import { createRef } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { deriveLibraryRouteInput } from "@/routing/libraryRouteInput";
import { validateCollectionSearch } from "@/routing/routeContracts";
import type { Album } from "@/types";
import type { LibraryRouteSearchController } from "./useLibraryRouteSearchController";
import {
  useLibraryWorkspaceController,
  type LibraryWorkspaceControllerOptions,
} from "./useLibraryWorkspaceController";

function album(
  id: string,
  artist: string,
  songCount: number,
  overrides: Partial<Album> = {},
): Album {
  return {
    artist,
    duration: songCount * 180,
    id,
    palette: ["#777", "#222"],
    songCount,
    title: `Release ${id}`,
    ...overrides,
  };
}

function searchController(
  searchValue: unknown,
  deferredQuery?: string,
): LibraryRouteSearchController {
  const search = validateCollectionSearch(searchValue);
  return {
    commands: {
      changeGenre: vi.fn(),
      changeQuery: vi.fn(),
      changeSort: vi.fn(),
      chooseBrowseMode: vi.fn(),
      clearFilters: vi.fn(),
      prepareArtistSearch: vi.fn(() => ({
        commitDeferredReset: vi.fn(),
        search: validateCollectionSearch({
          ...search,
          genre: "All",
          mode: "artists",
          q: "",
        }),
      })),
      replace: vi.fn(),
    },
    refs: { search: createRef<HTMLInputElement>() },
    state: {
      deferredQuery: deferredQuery ?? search.q.toLocaleLowerCase(),
      ignoreDeferredArtistQuery: false,
      search,
    },
  };
}

function workspaceOptions(
  albums: readonly Album[],
  routeInput: LibraryWorkspaceControllerOptions["routeInput"],
  search: LibraryRouteSearchController,
  overrides: Partial<LibraryWorkspaceControllerOptions> = {},
): LibraryWorkspaceControllerOptions {
  return {
    albums,
    availability: {
      commands: {
        connect: vi.fn(),
        retryStartup: vi.fn(),
        sync: vi.fn(),
      },
      state: {
        artworkRefreshing: false,
        connected: true,
        libraryError: "",
        syncState: "idle",
      },
    },
    fallbackAlbumCandidateTracks: [],
    libraryActions: {
      commands: {
        openAlbum: vi.fn(async () => undefined),
        playAlbum: vi.fn(async () => undefined),
        playSurprise: vi.fn(async () => undefined),
        queueAlbum: vi.fn(async () => true),
        queueAlbums: vi.fn(async () => undefined),
        refreshArtwork: vi.fn(async () => undefined),
      },
      state: {
        loadingAlbumId: undefined,
        queueSearchProgress: undefined,
        randomPickLoading: false,
        selectedAlbum: undefined,
      },
    },
    libraryPaneRef: createRef<HTMLElement>(),
    navigation: {
      openArtist: vi.fn(),
      openArtistFromMetadata: vi.fn(),
    },
    playback: {
      currentAlbumId: undefined,
      playing: false,
      shuffleInProgress: false,
      toggle: vi.fn(),
    },
    routeInput,
    search,
    ...overrides,
  };
}

describe("library workspace controller", () => {
  it("derives Collection chrome, screen models, and scope-aware commands", () => {
    const albums = [
      album("ambient-album", "Night Archive", 4, {
        genre: "Ambient",
        title: "Soft Focus",
      }),
      album("ambient-single", "Night Archive", 1, {
        genre: "Ambient",
      }),
      album("jazz-album", "Other Artist", 3, { genre: "Jazz" }),
    ];
    const search = searchController({
      genre: "Ambient",
      mode: "albums",
      sort: "title",
    });
    const routeInput = deriveLibraryRouteInput({
      screen: "collection",
      search: search.state.search,
    });
    const options = workspaceOptions(albums, routeInput, search);
    const { result } = renderHook(() => useLibraryWorkspaceController(options));

    expect(result.current.chrome?.model).toMatchObject({
      kind: "collection",
      query: "",
      releaseCount: 3,
      surprise: {
        available: true,
        scopeName: "Ambient",
      },
    });
    expect(result.current.chrome?.browse?.model).toMatchObject({
      mode: "albums",
      releaseCount: 3,
      counts: { albums: 2, artists: 2, singles: 1 },
    });
    expect(result.current.chrome?.filter?.model).toMatchObject({
      genre: "Ambient",
      kind: "collection",
      trailingControl: "sort",
    });
    expect(
      result.current.screens.releaseResultsModel.albums.map((item) => item.id),
    ).toEqual(["ambient-album"]);
    expect(result.current.screens.releaseResultsModel).toMatchObject({
      browseMode: "albums",
      hasActiveFilters: true,
      title: "Albums & EPs · Ambient",
    });

    act(() => result.current.chrome?.actions.onQueryChange("soft"));
    expect(search.commands.changeQuery).toHaveBeenCalledWith("soft");

    act(() =>
      result.current.screens.releaseResultsActions.onQueueSearchResults(),
    );
    expect(options.libraryActions.commands.queueAlbums).toHaveBeenCalledWith([
      albums[0],
    ]);

    act(() => result.current.chrome?.actions.onSurprise());
    expect(options.libraryActions.commands.playSurprise).toHaveBeenCalledWith(
      [albums[0]],
      "Ambient",
      undefined,
    );
  });

  it("keeps Recent release-only, bounded, and free of Collection browse tabs", () => {
    const albums = Array.from({ length: 14 }, (_, index) =>
      album(String(index), "Night Archive", 2, {
        addedAt: `${String(index + 1).padStart(2, "0")} Jul 2025 12:00:00 GMT`,
        genre: index % 2 ? "Ambient" : "Jazz",
      }),
    );
    const search = searchController({ mode: "artists" });
    const routeInput = deriveLibraryRouteInput({
      screen: "recent",
      search: search.state.search,
    });
    const { result } = renderHook(() =>
      useLibraryWorkspaceController(
        workspaceOptions(albums, routeInput, search),
      ),
    );

    expect(result.current.chrome?.model.kind).toBe("recent");
    expect(result.current.chrome?.browse).toBeUndefined();
    expect(result.current.chrome?.filter?.model).toMatchObject({
      kind: "recent",
      trailingControl: "recent",
    });
    expect(result.current.screens.browseMode).toBe("releases");
    expect(result.current.screens.releaseResultsModel.albums).toHaveLength(12);
    expect(result.current.state.surpriseScope.name).toBe("recent additions");
  });

  it("keeps genre and browse controls off album and artist detail routes", () => {
    const albums = [album("album-1", "Night Archive", 4)];
    const search = searchController({ mode: "artists" });
    const artistRoute = deriveLibraryRouteInput({
      artistKey: "night archive",
      screen: "artist",
      search: search.state.search,
    });
    const { result, rerender } = renderHook(
      ({ routeInput }) =>
        useLibraryWorkspaceController(
          workspaceOptions(albums, routeInput, search),
        ),
      { initialProps: { routeInput: artistRoute } },
    );

    expect(result.current.chrome?.browse).toBeUndefined();
    expect(result.current.chrome?.filter).toBeUndefined();
    expect(result.current.browse.activeArtist?.name).toBe("Night Archive");
    expect(result.current.screens.releaseResultsModel.title).toBe("Releases");

    const albumRoute = deriveLibraryRouteInput({
      albumId: "album-1",
      screen: "album",
      search: search.state.search,
    });
    rerender({ routeInput: albumRoute });

    expect(result.current.chrome?.browse).toBeUndefined();
    expect(result.current.chrome?.filter).toBeUndefined();
  });

  it("does not expose library chrome for non-library routes", () => {
    const search = searchController(undefined);
    const inactiveRoute = deriveLibraryRouteInput({
      screen: "discover",
      search: undefined,
    });
    const { result } = renderHook(() =>
      useLibraryWorkspaceController(
        workspaceOptions([], inactiveRoute, search),
      ),
    );

    expect(result.current.chrome).toBeUndefined();
  });
});
