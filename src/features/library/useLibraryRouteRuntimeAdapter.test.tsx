import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { albumQueryKey } from "@/libraryQueries";
import { deriveLibraryRouteInput } from "@/routing/libraryRouteInput";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
} from "@/routing/routeContracts";
import type { Album, LocalFavoriteCollection, Track } from "@/types";

import type {
  ArtistResultsActions,
  ArtistResultsModel,
  LibraryAvailabilityActions,
  LibraryAvailabilityModel,
  ReleaseResultsActions,
  ReleaseResultsModel,
} from "./LibraryResults";
import {
  type LibraryRouteRuntimeAdapterOptions,
  useLibraryRouteRuntimeAdapter,
} from "./useLibraryRouteRuntimeAdapter";

const track: Track = {
  id: "track-1",
  title: "Glass Lines",
  artist: "Signal Garden",
  album: "Blue Hours",
  albumId: "album-1",
  duration: 201,
  track: 1,
  coverArt: "cover-1",
  palette: ["#777", "#222"],
};

const album: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  songCount: 1,
  duration: 201,
  palette: ["#777", "#222"],
};

const favoriteCollection: LocalFavoriteCollection = {
  albumIds: [],
  songIds: [],
  albums: [],
  tracks: [],
  radioShowIds: [],
  radioShows: [],
};

const availabilityModel: LibraryAvailabilityModel = {
  connected: true,
  releaseCount: 1,
  syncState: "idle",
  libraryError: "",
  isInitialLoading: false,
};

const availabilityActions: LibraryAvailabilityActions = {
  onSync: vi.fn(),
  onRetryStartup: vi.fn(),
  onConnect: vi.fn(),
};

const releaseResultsModel: ReleaseResultsModel = {
  title: "All releases",
  albums: [album],
  playing: true,
  hasSearchQuery: false,
  browseMode: "releases",
  hasActiveFilters: false,
};

function createOptions(): LibraryRouteRuntimeAdapterOptions {
  const releaseResultsActions: ReleaseResultsActions = {
    onOpen: vi.fn(),
    onPlay: vi.fn(),
    onQueue: vi.fn(),
    onArtist: vi.fn(),
    onTogglePlayback: vi.fn(),
    onQueueSearchResults: vi.fn(),
    onClearFilters: vi.fn(),
  };
  const artistResultsModel: ArtistResultsModel = {
    genre: "All",
    groups: [],
    hasActiveFilters: false,
  };
  const artistResultsActions: ArtistResultsActions = {
    onOpen: vi.fn(),
    onClearFilters: vi.fn(),
  };
  const group = {
    key: "signal garden",
    name: "Signal Garden",
    albums: [album],
    releaseCount: 1,
    trackCount: 1,
    duration: 201,
    representative: album,
  };

  return {
    album: {
      loadingAlbumId: album.id,
      onAddToPlaylist: vi.fn(),
      onBack: vi.fn(),
    },
    artist: {
      activeShuffleArtistKey: group.key,
      group,
      onBack: vi.fn(),
      onPlay: vi.fn(),
      onQueue: vi.fn(),
      onShuffle: vi.fn(),
      routeInput: deriveLibraryRouteInput({
        artistKey: group.key,
        screen: "artist",
        search: undefined,
      }),
      shuffleInProgress: true,
    },
    catalog: {
      albums: [album],
    },
    favorites: {
      collection: favoriteCollection,
      favoriteAlbumIds: new Set([album.id]),
      favoriteTrackIds: new Set([track.id]),
      toggleFavorite: vi.fn(),
    },
    initialLoading: false,
    playback: {
      currentTrack: track,
      onPlayTrack: vi.fn(),
      onQueueTrack: vi.fn(),
      onTogglePlayback: vi.fn(),
      playing: true,
    },
    screens: {
      artistResultsActions,
      artistResultsModel,
      availabilityActions,
      availabilityModel,
      browseMode: "releases",
      refs: { libraryPane: createRef<HTMLElement>() },
      releaseResultsActions,
      releaseResultsModel,
    },
  };
}

function queryWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderRuntime(options: LibraryRouteRuntimeAdapterOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = renderHook(() => useLibraryRouteRuntimeAdapter(options), {
    wrapper: queryWrapper(queryClient),
  });
  return { ...rendered, queryClient };
}

describe("useLibraryRouteRuntimeAdapter", () => {
  it("selects the Collection content model without a route mirror", () => {
    const options = createOptions();
    const artistOptions: LibraryRouteRuntimeAdapterOptions = {
      ...options,
      screens: { ...options.screens, browseMode: "artists" },
    };
    const { result } = renderRuntime(artistOptions);

    expect(result.current.getCollectionScreenProps().model.content.kind).toBe(
      "artists",
    );
    expect(result.current.getRecentScreenProps().model.results).toBe(
      releaseResultsModel,
    );
  });

  it("hydrates album resources from Query cache and binds album actions", () => {
    const options = createOptions();
    const queryClient = new QueryClient();
    queryClient.setQueryData(albumQueryKey(album.id), [track]);
    const { result } = renderHook(
      () => useLibraryRouteRuntimeAdapter(options),
      { wrapper: queryWrapper(queryClient) },
    );

    const resource = result.current.resolveAlbumScreen(
      parseAlbumIdParam(album.id),
    );
    expect(resource.status).toBe("ready");
    if (resource.status !== "ready") return;

    expect(resource.value.model.detail).toMatchObject({
      album: { coverArt: track.coverArt, tracks: [track] },
      currentAlbumId: album.id,
      currentTrackId: track.id,
      favoriteAlbum: true,
      loading: true,
      playing: true,
    });
    resource.value.actions.detail.onPlayAlbum();
    resource.value.actions.detail.onQueueAlbum();
    resource.value.actions.detail.onToggleFavoriteTrack(track);

    expect(options.screens.releaseResultsActions.onPlay).toHaveBeenCalledWith(
      expect.objectContaining({ tracks: [track] }),
    );
    expect(options.screens.releaseResultsActions.onQueue).toHaveBeenCalledWith(
      expect.objectContaining({ tracks: [track] }),
    );
    expect(options.favorites.toggleFavorite).toHaveBeenCalledWith(
      track.id,
      "song",
    );
  });

  it("distinguishes pending startup from a missing album", () => {
    const options = createOptions();
    const missingCatalog = { albums: [] };
    const pending = renderRuntime({
      ...options,
      catalog: missingCatalog,
      initialLoading: true,
    });
    const missing = renderRuntime({
      ...options,
      catalog: missingCatalog,
      initialLoading: false,
    });

    expect(
      pending.result.current.resolveAlbumScreen(
        parseAlbumIdParam("missing-album"),
      ).status,
    ).toBe("pending");
    expect(
      missing.result.current.resolveAlbumScreen(
        parseAlbumIdParam("missing-album"),
      ).status,
    ).toBe("not-found");
  });

  it("validates artist route identity and derives active shuffle state", () => {
    const options = createOptions();
    const { result } = renderRuntime(options);
    const artistId = parseArtistKeyParam("signal garden");

    expect(
      result.current.resolveArtistScreen(
        parseArtistKeyParam("different artist"),
      ).status,
    ).toBe("pending");

    const resource = result.current.resolveArtistScreen(artistId);
    expect(resource.status).toBe("ready");
    if (resource.status !== "ready") return;

    expect(resource.value.model.artist).toMatchObject({
      active: true,
      loading: "shuffle",
      playing: true,
    });
    expect(resource.value.model.results).toMatchObject({
      albums: [album],
      title: "Releases",
    });
    const group = resource.value.model.artist.group;
    expect(group).toBeDefined();
    if (!group) return;
    resource.value.actions.artist.onShuffle(group);
    expect(options.artist.onShuffle).toHaveBeenCalledOnce();
  });
});
