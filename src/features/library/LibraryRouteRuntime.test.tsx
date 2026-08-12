import { createRef, type ReactNode } from "react";
import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ArtistGroup } from "@/libraryBrowse";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
} from "@/routing/routeContracts";
import {
  missingRouteResource,
  pendingRouteResource,
  readyRouteResource,
  type RouteResource,
} from "@/routing/routeResource";
import type { Album, Track } from "@/types";
import { AlbumRouteScreen } from "./AlbumRouteScreen";
import type { AlbumScreenProps } from "./AlbumScreen";
import { ArtistRouteScreen } from "./ArtistRouteScreen";
import type { ArtistScreenProps } from "./ArtistScreen";
import { CollectionRouteScreen } from "./CollectionRouteScreen";
import type { CollectionScreenProps } from "./CollectionScreen";
import {
  type LibraryRouteRuntime,
  useAlbumRouteScreenResource,
  useArtistRouteScreenResource,
  useCollectionRouteScreenProps,
  useRecentRouteScreenProps,
} from "./LibraryRouteRuntime";
import { LibraryRouteRuntimeProvider } from "./LibraryRouteRuntimeProvider";
import type {
  ArtistResultsActions,
  LibraryAvailabilityActions,
  LibraryAvailabilityModel,
  ReleaseResultsActions,
  ReleaseResultsModel,
} from "./LibraryResults";
import { RecentRouteScreen } from "./RecentRouteScreen";
import type { RecentScreenProps } from "./RecentScreen";

vi.mock("./AlbumScreen", () => ({
  AlbumScreen: ({ className, model }: AlbumScreenProps) => (
    <div className={className} data-testid="album-screen">
      {model.detail.album.id}
    </div>
  ),
}));

vi.mock("./ArtistScreen", () => ({
  ArtistScreen: ({ className, model }: ArtistScreenProps) => (
    <div className={className} data-testid="artist-screen">
      {model.artist.group?.key}
    </div>
  ),
}));

vi.mock("./CollectionScreen", () => ({
  CollectionScreen: ({ className, model }: CollectionScreenProps) => (
    <div className={className} data-testid="collection-screen">
      {model.content.kind}
    </div>
  ),
}));

vi.mock("./RecentScreen", () => ({
  RecentScreen: ({ className, model }: RecentScreenProps) => (
    <div className={className} data-testid="recent-screen">
      {model.results.title}
    </div>
  ),
}));

const track: Track = {
  id: "track-1",
  title: "Glass Lines",
  artist: "Signal Garden",
  album: "Blue Hours",
  albumId: "album-1",
  duration: 201,
  track: 1,
  palette: ["#777", "#222"],
};

const album: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  songCount: 1,
  duration: 201,
  tracks: [track],
  palette: ["#777", "#222"],
};

const artist: ArtistGroup = {
  key: "signal garden",
  name: "Signal Garden",
  albums: [album],
  releaseCount: 1,
  trackCount: 1,
  duration: 201,
  representative: album,
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
  playing: false,
  hasSearchQuery: false,
  browseMode: "releases",
  hasActiveFilters: false,
};

const releaseResultsActions: ReleaseResultsActions = {
  onOpen: vi.fn(),
  onPlay: vi.fn(),
  onQueue: vi.fn(),
  onArtist: vi.fn(),
  onTogglePlayback: vi.fn(),
  onQueueSearchResults: vi.fn(),
  onClearFilters: vi.fn(),
};

const artistResultsActions: ArtistResultsActions = {
  onOpen: vi.fn(),
  onClearFilters: vi.fn(),
};

const libraryPane = createRef<HTMLElement>();

const collectionProps: CollectionScreenProps = {
  model: {
    availability: availabilityModel,
    content: { kind: "releases", results: releaseResultsModel },
  },
  actions: {
    availability: availabilityActions,
    artists: artistResultsActions,
    releases: releaseResultsActions,
  },
  refs: { libraryPane },
  className: "runtime-collection",
};

const recentProps: RecentScreenProps = {
  model: {
    availability: availabilityModel,
    results: { ...releaseResultsModel, title: "Recently added" },
  },
  actions: {
    availability: availabilityActions,
    releases: releaseResultsActions,
  },
  refs: { libraryPane },
  className: "runtime-recent",
};

const albumProps: AlbumScreenProps = {
  model: {
    detail: {
      album,
      loading: false,
      favoriteAlbum: false,
      favoriteTrackIds: new Set<string>(),
      playing: false,
    },
  },
  actions: {
    detail: {
      onBack: vi.fn(),
      onPlayAlbum: vi.fn(),
      onQueueAlbum: vi.fn(),
      onPlayTrack: vi.fn(),
      onQueueTrack: vi.fn(),
      onArtist: vi.fn(),
      onToggleFavoriteAlbum: vi.fn(),
      onToggleFavoriteTrack: vi.fn(),
      onAddToPlaylist: vi.fn(),
      onTogglePlayback: vi.fn(),
    },
  },
  className: "runtime-album",
};

const artistProps: ArtistScreenProps = {
  model: {
    availability: availabilityModel,
    artist: {
      group: artist,
      active: false,
      playing: false,
    },
    results: releaseResultsModel,
  },
  actions: {
    availability: availabilityActions,
    artist: {
      onBack: vi.fn(),
      onPlay: vi.fn(),
      onShuffle: vi.fn(),
      onQueue: vi.fn(),
      onTogglePlayback: vi.fn(),
    },
    releases: releaseResultsActions,
  },
  refs: { libraryPane },
  className: "runtime-artist",
};

function libraryRouteRuntime(
  overrides: Partial<LibraryRouteRuntime> = {},
): LibraryRouteRuntime {
  return {
    getCollectionScreenProps: () => collectionProps,
    getRecentScreenProps: () => recentProps,
    resolveAlbumScreen: () => readyRouteResource(albumProps),
    resolveArtistScreen: () => readyRouteResource(artistProps),
    ...overrides,
  };
}

function runtimeWrapper(runtime: LibraryRouteRuntime) {
  return function RuntimeWrapper({ children }: { children: ReactNode }) {
    return (
      <LibraryRouteRuntimeProvider runtime={runtime}>
        {children}
      </LibraryRouteRuntimeProvider>
    );
  };
}

describe("LibraryRouteRuntimeProvider", () => {
  it("provides the collection and Recent screen prop factories", () => {
    const { result } = renderHook(
      () => ({
        collection: useCollectionRouteScreenProps(),
        recent: useRecentRouteScreenProps(),
      }),
      { wrapper: runtimeWrapper(libraryRouteRuntime()) },
    );

    expect(result.current.collection).toBe(collectionProps);
    expect(result.current.recent).toBe(recentProps);
  });

  it("requires route screens to live below the runtime provider", () => {
    expect(() => renderHook(useCollectionRouteScreenProps)).toThrow(
      "Library route screens must be rendered inside LibraryRouteRuntimeProvider",
    );
  });
});

describe("library detail route resources", () => {
  it.each([
    ["pending", pendingRouteResource()],
    ["not-found", missingRouteResource()],
    ["ready", readyRouteResource(albumProps)],
  ] as const)("preserves the %s album resource", (_, resource) => {
    const albumId = parseAlbumIdParam("album-1");
    const resolveAlbumScreen = vi.fn(
      (): RouteResource<AlbumScreenProps> => resource,
    );
    const { result } = renderHook(() => useAlbumRouteScreenResource(albumId), {
      wrapper: runtimeWrapper(libraryRouteRuntime({ resolveAlbumScreen })),
    });

    expect(result.current).toBe(resource);
    expect(resolveAlbumScreen).toHaveBeenCalledWith(albumId);
  });

  it.each([
    ["pending", pendingRouteResource()],
    ["not-found", missingRouteResource()],
    ["ready", readyRouteResource(artistProps)],
  ] as const)("preserves the %s artist resource", (_, resource) => {
    const artistKey = parseArtistKeyParam("signal garden");
    const sourceAlbumId = parseAlbumIdParam("album-1");
    const resolveArtistScreen = vi.fn(
      (): RouteResource<ArtistScreenProps> => resource,
    );
    const { result } = renderHook(
      () => useArtistRouteScreenResource(artistKey, sourceAlbumId),
      {
        wrapper: runtimeWrapper(libraryRouteRuntime({ resolveArtistScreen })),
      },
    );

    expect(result.current).toBe(resource);
    expect(resolveArtistScreen).toHaveBeenCalledWith(artistKey, sourceAlbumId);
  });
});

describe("library route screen adapters", () => {
  it("renders collection and Recent props from the runtime", () => {
    const runtime = libraryRouteRuntime();
    const { rerender } = render(
      <LibraryRouteRuntimeProvider runtime={runtime}>
        <CollectionRouteScreen className="route-collection" />
      </LibraryRouteRuntimeProvider>,
    );

    expect(screen.getByTestId("collection-screen")).toHaveClass(
      "runtime-collection",
      "route-collection",
    );

    rerender(
      <LibraryRouteRuntimeProvider runtime={runtime}>
        <RecentRouteScreen className="route-recent" />
      </LibraryRouteRuntimeProvider>,
    );
    expect(screen.getByTestId("recent-screen")).toHaveClass(
      "runtime-recent",
      "route-recent",
    );
  });

  it("accepts only narrowed ready detail resources", () => {
    const albumResource = readyRouteResource(albumProps);
    const artistResource = readyRouteResource(artistProps);
    if (albumResource.status !== "ready") {
      throw new Error("Expected the album fixture to be ready");
    }
    if (artistResource.status !== "ready") {
      throw new Error("Expected the artist fixture to be ready");
    }

    render(
      <>
        <AlbumRouteScreen className="route-album" resource={albumResource} />
        <ArtistRouteScreen className="route-artist" resource={artistResource} />
      </>,
    );

    expect(screen.getByTestId("album-screen")).toHaveTextContent("album-1");
    expect(screen.getByTestId("album-screen")).toHaveClass(
      "runtime-album",
      "route-album",
    );
    expect(screen.getByTestId("artist-screen")).toHaveTextContent(
      "signal garden",
    );
    expect(screen.getByTestId("artist-screen")).toHaveClass(
      "runtime-artist",
      "route-artist",
    );
  });
});
