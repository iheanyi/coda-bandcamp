import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveLibraryRouteInput } from "@/routing/libraryRouteInput";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
  validateCollectionSearch,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import type { Album, DiscoverRelease, RadioChapter, Track } from "@/types";

import type {
  DetailNavigationController,
  DetailNavigationRequest,
} from "./useDetailNavigationController";
import {
  type CodaNavigationControllerOptions,
  useCodaNavigationController,
} from "./useCodaNavigationController";
import type { CodaRouteDestination } from "./useRouteDestination";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return { ...actual, useNavigate: () => navigate };
});

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

const discoverRelease: DiscoverRelease = {
  id: "discover:release-1",
  title: "Soft Focus",
  artist: "Signal Garden",
  itemUrl: "https://signal-garden.bandcamp.com/album/soft-focus",
  featuredTrack: {
    id: "discover:preview-1",
    title: "Soft Focus",
    duration: 180,
    streamUrl: "https://t4.bcbits.com/stream/soft-focus",
  },
};

function routeDestination(
  overrides: Partial<CodaRouteDestination> = {},
): CodaRouteDestination {
  return {
    collectionSearch: validateCollectionSearch(undefined),
    discoverSearch: validateDiscoverSearch(undefined),
    libraryRouteInput: deriveLibraryRouteInput({
      screen: "collection",
      search: undefined,
    }),
    locationKey: "collection",
    nowPlayingOpen: false,
    primaryView: "library",
    screen: "collection",
    ...overrides,
  };
}

function createDetailNavigation() {
  const scrollRootRef = createRef<HTMLElement>();
  const scrollRoot = document.createElement("main");
  scrollRoot.scrollTop = 84;
  scrollRootRef.current = scrollRoot;
  const open = vi.fn(async (request: DetailNavigationRequest) => {
    request.beforeCommit?.();
    return "navigated" as const;
  });
  const back = vi.fn(async () => undefined);
  const transitionPrimary = vi.fn(async (update) => {
    await update();
  });
  const controller = {
    back,
    open,
    scrollRootRef,
    transitionPrimary,
  } satisfies DetailNavigationController;
  return { back, controller, open, scrollRootRef, transitionPrimary };
}

function wrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

function renderController(
  optionOverrides: Partial<CodaNavigationControllerOptions> = {},
) {
  const queryClient = new QueryClient();
  const detail = createDetailNavigation();
  const notify = vi.fn();
  const clearSelectedAlbum = vi.fn();
  const openAlbum = vi.fn();
  const commitDeferredReset = vi.fn();
  const prepareArtistSearch = vi.fn(() => ({
    commitDeferredReset,
    search: validateCollectionSearch({
      genre: "All",
      mode: "artists",
      q: "",
    }),
  }));
  const initialOptions: CodaNavigationControllerOptions = {
    albums: [album],
    clearSelectedAlbum,
    destination: routeDestination(),
    detailNavigation: detail.controller,
    notify,
    openAlbum,
    prepareArtistSearch,
    queue: [],
    ...optionOverrides,
  };
  const rendered = renderHook(
    ({ options }: { options: CodaNavigationControllerOptions }) =>
      useCodaNavigationController(options),
    {
      initialProps: { options: initialOptions },
      wrapper: wrapper(queryClient),
    },
  );
  return {
    ...rendered,
    clearSelectedAlbum,
    commitDeferredReset,
    detail,
    initialOptions,
    notify,
    openAlbum,
    prepareArtistSearch,
    queryClient,
  };
}

beforeEach(() => {
  navigate.mockReset();
  navigate.mockResolvedValue(undefined);
});

describe("useCodaNavigationController", () => {
  it("preserves Discover source identity and return metadata from Now Playing", () => {
    const discoverTrack: Track = {
      ...track,
      id: "discover:preview-1",
      album: discoverRelease.title,
      albumId: discoverRelease.id,
      discoverRelease,
    };
    const sourceTrigger = document.createElement("a");
    const destination = routeDestination({
      detail: { kind: "now-playing" },
      locationKey: "now-playing",
      nowPlayingOpen: true,
      primaryView: "discover",
      screen: "now-playing",
    });
    const rendered = renderController({ destination });

    act(() => {
      rendered.result.current.commands.album.openFromTrack(
        discoverTrack,
        sourceTrigger,
      );
    });

    expect(rendered.detail.open).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "discover-release",
        releaseId: discoverRelease.id,
        releaseTitle: discoverRelease.title,
        sourceTrackId: discoverTrack.id,
        sourceTrigger,
      }),
    );
    expect(rendered.result.current.state.discoverDetail).toBeUndefined();

    const discoverDestination = routeDestination({
      detail: {
        kind: "discover-release",
        releaseId: parseDiscoverReleaseIdParam(discoverRelease.id),
      },
      locationKey: "discover-release",
      primaryView: "discover",
      screen: "discover-release",
    });
    rendered.rerender({
      options: {
        ...rendered.initialOptions,
        destination: discoverDestination,
      },
    });

    expect(rendered.result.current.state.discoverDetail).toEqual({
      previousView: "discover",
      releaseId: discoverRelease.id,
      releaseTitle: discoverRelease.title,
      returnScrollTop: 84,
      returnToNowPlaying: true,
    });
  });

  it("stores a compilation artist fallback only after the typed artist commit", () => {
    const guestTrack: Track = {
      ...track,
      id: "guest-track",
      artist: "Guest Artist",
      albumId: "compilation",
    };
    const compilation: Album = {
      ...album,
      id: "compilation",
      artist: "Various Artists",
      title: "Compilation",
      tracks: [guestTrack],
    };
    const sourceTrigger = document.createElement("a");
    const rendered = renderController({
      albums: [compilation],
      queue: [guestTrack],
    });

    act(() => {
      rendered.result.current.commands.artist.openName(
        guestTrack.artist,
        compilation.id,
        guestTrack,
        sourceTrigger,
      );
    });

    expect(rendered.detail.open).toHaveBeenCalledWith(
      expect.objectContaining({
        artistKey: parseArtistKeyParam("guest artist"),
        collectionSearch: expect.objectContaining({
          genre: "All",
          mode: "artists",
          q: "",
        }),
        kind: "artist",
        sourceAlbumId: parseAlbumIdParam(compilation.id),
        sourceTrigger,
      }),
    );

    const artistDestination = routeDestination({
      collectionSearch: validateCollectionSearch({ mode: "artists", q: "" }),
      detail: {
        artistKey: parseArtistKeyParam("guest artist"),
        kind: "artist",
        sourceAlbumId: parseAlbumIdParam(compilation.id),
      },
      libraryRouteInput: deriveLibraryRouteInput({
        artistKey: "guest artist",
        screen: "artist",
        search: { mode: "artists", q: "" },
        sourceAlbumId: compilation.id,
      }),
      locationKey: "artist",
      screen: "artist",
    });
    rendered.rerender({
      options: { ...rendered.initialOptions, destination: artistDestination },
    });

    expect(rendered.result.current.state.selectedArtistFallback).toEqual({
      albumId: compilation.id,
      key: "guest artist",
      knownTrack: { duration: guestTrack.duration, id: guestTrack.id },
      name: guestTrack.artist,
    });
    expect(rendered.prepareArtistSearch).toHaveBeenCalledOnce();
    expect(rendered.commitDeferredReset).toHaveBeenCalledOnce();
    expect(rendered.clearSelectedAlbum).toHaveBeenCalledOnce();
  });

  it("reconstructs artist fallback identity from a validated deep link", () => {
    const guestTrack: Track = {
      ...track,
      id: "deep-link-track",
      artist: "Guest Artist",
      albumId: "compilation",
    };
    const compilation: Album = {
      ...album,
      id: "compilation",
      artist: "Various Artists",
      tracks: undefined,
    };
    const destination = routeDestination({
      detail: {
        artistKey: parseArtistKeyParam("guest artist"),
        kind: "artist",
        sourceAlbumId: parseAlbumIdParam(compilation.id),
      },
      libraryRouteInput: deriveLibraryRouteInput({
        artistKey: "guest artist",
        screen: "artist",
        search: { mode: "artists" },
        sourceAlbumId: compilation.id,
      }),
      locationKey: "artist-deep-link",
      screen: "artist",
    });
    const { result } = renderController({
      albums: [compilation],
      destination,
      queue: [guestTrack],
    });

    expect(result.current.state.selectedArtistFallback).toEqual({
      albumId: compilation.id,
      key: "guest artist",
      knownTrack: { duration: guestTrack.duration, id: guestTrack.id },
      name: guestTrack.artist,
    });
  });

  it("commits typed Radio destinations and preserves local chapter triggers", async () => {
    const chapter: RadioChapter = {
      title: track.title,
      artist: album.artist,
      album: album.title,
      timecode: 0,
    };
    const trigger = document.createElement("a");
    const rendered = renderController();

    act(() => {
      rendered.result.current.commands.radio.openSeries(7);
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        params: { seriesId: "7" },
        to: "/radio/series/$seriesId",
      });
    });

    act(() => {
      rendered.result.current.commands.album.openFromTrack({
        ...track,
        id: "radio:979",
      });
    });
    expect(navigate).toHaveBeenCalledWith({
      params: { showId: "979" },
      to: "/radio/shows/$showId",
    });

    const localLinks =
      rendered.result.current.commands.radio.chapterLinks(chapter);
    expect(localLinks.album?.albumId).toBe(parseAlbumIdParam(album.id));
    localLinks.album?.onNavigate?.(trigger);
    expect(rendered.openAlbum).toHaveBeenCalledWith(album, trigger);
  });

  it("uses one back interface while applying destination-specific cleanup", async () => {
    const rendered = renderController({ currentTrack: track });

    act(() => {
      rendered.result.current.commands.nowPlaying.open();
      rendered.result.current.commands.discover.back({ restoreFocus: false });
    });

    expect(rendered.detail.open).toHaveBeenCalledWith({
      kind: "now-playing",
      trackId: track.id,
    });
    expect(rendered.detail.back).toHaveBeenCalledWith({ restoreFocus: false });
    await waitFor(() => expect(rendered.detail.back).toHaveBeenCalledOnce());
  });

  it("keeps sidebar destination commits inside the navigation boundary", async () => {
    const rendered = renderController({
      destination: routeDestination({
        detail: {
          kind: "discover-release",
          releaseId: parseDiscoverReleaseIdParam(discoverRelease.id),
        },
        screen: "discover-release",
      }),
    });
    const commitNavigation = vi.fn().mockResolvedValue(undefined);

    expect(
      rendered.result.current.commands.sidebar.beforeDiscoverNavigate(),
    ).toBe(true);
    expect(rendered.detail.back).toHaveBeenCalledWith({ restoreFocus: false });
    await rendered.result.current.commands.sidebar.navigatePrimary({
      destination: "/collection",
      navigate: commitNavigation,
    });
    expect(commitNavigation).toHaveBeenCalledOnce();
  });
});
