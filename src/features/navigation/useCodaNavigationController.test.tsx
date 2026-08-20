import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getMotionDiagnosticHistory } from "@/motionDiagnostics";
import type { OwnDataValue } from "@/ownData";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import { deriveLibraryRouteInput } from "@/routing/libraryRouteInput";
import {
  DEFAULT_COLLECTION_ROUTE_SEARCH,
  DEFAULT_DAILY_ROUTE_SEARCH,
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
  parseRadioShowIdParam,
  validateCollectionSearch,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import type {
  Album,
  DiscoverRelease,
  RadioChapter,
  RadioShowSummary,
  Track,
} from "@/types";
import { consumePendingPageEntrance } from "@/viewTransitions";

import type {
  DetailNavigationController,
  DetailNavigationRequest,
} from "./useDetailNavigation";
import {
  type CodaNavigationControllerOptions,
  useCodaNavigationControllerWithRuntime,
} from "./useCodaNavigationController";
import type { CodaRouteDestination } from "./useRouteDestination";
import type { RenderedNavigationRouter } from "./routeNavigationAdapters";
import {
  MAX_ROUTE_COMMIT_MS,
  renderedLocationPath,
  type RouteCommitOutcome,
} from "./routeCommit";

const navigate = vi.fn();

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

function discoverReleaseRoute(): CodaRouteDestination {
  return routeDestination({
    detail: {
      kind: "discover-release",
      releaseId: parseDiscoverReleaseIdParam(discoverRelease.id),
    },
    primaryView: "discover",
    screen: "discover-release",
  });
}

function renderFromDiscoverRelease() {
  const rendered = renderController({
    destination: routeDestination({
      primaryView: "discover",
      screen: "discover",
    }),
  });
  act(() => {
    rendered.result.current.commands.discover.openRelease(
      discoverRelease,
      document.createElement("a"),
    );
  });
  rendered.rerender({
    options: {
      ...rendered.initialOptions,
      destination: discoverReleaseRoute(),
    },
  });
  return rendered;
}

function createDetailNavigation() {
  const scrollRootRef = createRef<HTMLElement>();
  const scrollRoot = document.createElement("main");
  scrollRoot.scrollTop = 84;
  scrollRootRef.current = scrollRoot;
  const open = vi.fn(async (request: DetailNavigationRequest) => {
    request.beforeCommit?.();
    return "rendered" as const;
  });
  const back = vi.fn(
    async (): Promise<RouteCommitOutcome | undefined> => "rendered",
  );
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

function createRuntimeRouter(href = "/", search?: OwnDataValue) {
  let locationKey = 1;
  let renderedListener:
    | ((
        event: Readonly<{ toLocation: { state: { __TSR_key: string } } }>,
      ) => void)
    | undefined;
  const locationState = { __TSR_key: "entry-1" };
  const pathname = renderedLocationPath({ href, state: locationState });
  const location = {
    href,
    pathname,
    search,
    state: locationState,
  };
  const router: RenderedNavigationRouter = {
    history: {
      back: vi.fn(),
      canGoBack: vi.fn(() => false),
    },
    state: {
      location,
    },
    subscribe: vi.fn((event, listener) => {
      if (event === "onRendered") renderedListener = listener;
      return () => {
        if (renderedListener === listener) renderedListener = undefined;
      };
    }),
  };
  const emitRendered = () => {
    locationKey += 1;
    const nextKey = `entry-${locationKey}`;
    locationState.__TSR_key = nextKey;
    renderedListener?.({
      toLocation: { state: { __TSR_key: nextKey } },
    });
  };
  navigate.mockImplementation(async () => {
    emitRendered();
  });
  return { emitRendered, router };
}

function renderController(
  optionOverrides: Partial<CodaNavigationControllerOptions> = {},
  runtime?: {
    emitRendered?: () => void;
    href?: string;
    router?: RenderedNavigationRouter;
    search?: OwnDataValue;
  },
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
  const navigationRuntime =
    runtime?.router === undefined
      ? createRuntimeRouter(runtime?.href, runtime?.search)
      : { emitRendered: runtime.emitRendered, router: runtime.router };
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
      useCodaNavigationControllerWithRuntime(options, {
        navigate,
        router: navigationRuntime.router,
      }),
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
    emitRendered: navigationRuntime.emitRendered,
    initialOptions,
    notify,
    openAlbum,
    prepareArtistSearch,
    queryClient,
    router: navigationRuntime.router,
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
      releaseId: discoverRelease.id,
      releaseTitle: discoverRelease.title,
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
        replace: false,
        to: "/radio/series/$seriesId",
        viewTransition: false,
      });
    });

    act(() => {
      rendered.result.current.commands.album.openFromTrack({
        ...track,
        id: "radio:979",
      });
    });
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        params: { showId: "979" },
        to: "/radio/shows/$showId",
        viewTransition: false,
      });
    });

    const localLinks =
      rendered.result.current.commands.radio.chapterLinks(chapter);
    expect(localLinks.album?.albumId).toBe(parseAlbumIdParam(album.id));
    localLinks.album?.onNavigate?.(trigger);
    expect(rendered.openAlbum).toHaveBeenCalledWith(album, trigger);
  });

  it("commits a Radio series page when the show id is unparsable", async () => {
    const rendered = renderController();

    act(() => {
      rendered.result.current.commands.album.openFromTrack({
        ...track,
        album: "The Hip Hop Show",
        albumId: "radio:not-a-show",
        artist: BANDCAMP_RADIO_PROVIDER,
        id: "radio:not-a-show",
      });
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        params: { seriesId: "5" },
        replace: false,
        to: "/radio/series/$seriesId",
        viewTransition: false,
      });
    });
  });

  it("routes Bandcamp Radio artist names through radioRouteNav", async () => {
    const radioTrackWithKnownSeries: Track = {
      ...track,
      album: "The Hip Hop Show",
      albumId: "radio:979",
      artist: BANDCAMP_RADIO_PROVIDER,
      id: "radio:979",
    };
    const seriesRendered = renderController();

    act(() => {
      seriesRendered.result.current.commands.artist.openName(
        BANDCAMP_RADIO_PROVIDER,
        undefined,
        radioTrackWithKnownSeries,
      );
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        params: { seriesId: "5" },
        replace: false,
        to: "/radio/series/$seriesId",
        viewTransition: false,
      });
    });
    expect(seriesRendered.detail.transitionPrimary).not.toHaveBeenCalled();

    navigate.mockClear();
    const archiveRendered = renderController();

    act(() => {
      archiveRendered.result.current.commands.artist.openName(
        BANDCAMP_RADIO_PROVIDER,
      );
    });

    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        replace: false,
        to: "/radio",
        viewTransition: false,
      });
    });
    expect(archiveRendered.detail.transitionPrimary).not.toHaveBeenCalled();
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
    const commitNavigation = vi.fn(async () => {
      rendered.emitRendered?.();
    });

    expect(
      rendered.result.current.commands.sidebar.beforeDiscoverNavigate(),
    ).toBe(false);
    expect(rendered.detail.back).not.toHaveBeenCalled();
    await rendered.result.current.commands.sidebar.navigatePrimary({
      destination: "/collection",
      navigate: commitNavigation,
    });
    expect(commitNavigation).toHaveBeenCalledWith(false);
  });

  it("uses history Back for sidebar Discover only when the previous view is Discover", async () => {
    const fromDiscover = renderFromDiscoverRelease();
    expect(
      fromDiscover.result.current.commands.sidebar.beforeDiscoverNavigate(),
    ).toBe(true);
    expect(fromDiscover.detail.back).toHaveBeenCalledWith({
      restoreFocus: false,
    });

    const fromRadio = renderController({
      destination: routeDestination({
        primaryView: "radio",
        screen: "radio",
      }),
    });
    const radioTrigger = document.createElement("a");
    act(() => {
      fromRadio.result.current.commands.album.openFromTrack(
        {
          ...track,
          id: "discover:preview-1",
          album: discoverRelease.title,
          albumId: discoverRelease.id,
          discoverRelease,
        },
        radioTrigger,
      );
    });
    fromRadio.rerender({
      options: {
        ...fromRadio.initialOptions,
        destination: discoverReleaseRoute(),
      },
    });
    expect(
      fromRadio.result.current.commands.sidebar.beforeDiscoverNavigate(),
    ).toBe(false);
    expect(fromRadio.detail.back).not.toHaveBeenCalled();

    const racedFromRadio = renderController({
      destination: routeDestination({
        primaryView: "radio",
        screen: "radio",
      }),
    });
    racedFromRadio.rerender({
      options: {
        ...racedFromRadio.initialOptions,
        destination: discoverReleaseRoute(),
      },
    });
    act(() => {
      racedFromRadio.result.current.commands.album.openFromTrack(
        {
          ...track,
          id: "discover:preview-1",
          album: discoverRelease.title,
          albumId: discoverRelease.id,
          discoverRelease,
        },
        radioTrigger,
      );
    });
    expect(
      racedFromRadio.result.current.commands.sidebar.beforeDiscoverNavigate(),
    ).toBe(false);
    expect(racedFromRadio.detail.back).not.toHaveBeenCalled();
  });

  it("consumes the page entrance after sidebar navigation renders", async () => {
    const pane = document.createElement("div");
    pane.className = "library-pane";
    pane.dataset.codaTransitionKey = "favorites";
    document.body.append(pane);
    const rendered = renderController({
      destination: routeDestination({
        primaryView: "favorites",
        screen: "favorites",
      }),
    });
    const commitNavigation = vi.fn(async () => {
      pane.dataset.codaTransitionKey = "collection";
      expect(consumePendingPageEntrance(pane, "collection")).toBe(true);
      rendered.emitRendered?.();
    });

    await rendered.result.current.commands.sidebar.navigatePrimary({
      destination: "/collection",
      navigate: commitNavigation,
    });

    expect(commitNavigation).toHaveBeenCalledWith(false);
    pane.remove();
  });

  it("releases sidebar navigation at the route-commit bound", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let renderedListener:
      | ((
          event: Readonly<{ toLocation: { state: { __TSR_key: string } } }>,
        ) => void)
      | undefined;
    const hungRouter: RenderedNavigationRouter = {
      history: {
        back: vi.fn(),
        canGoBack: vi.fn(() => false),
      },
      state: {
        location: { href: "/favorites", state: { __TSR_key: "hung" } },
      },
      subscribe: vi.fn((event, listener) => {
        if (event === "onRendered") renderedListener = listener;
        return () => {
          if (renderedListener === listener) renderedListener = undefined;
        };
      }),
    };
    const rendered = renderController(
      {
        destination: routeDestination({
          primaryView: "favorites",
          screen: "favorites",
        }),
      },
      { router: hungRouter },
    );
    const commitNavigation = vi.fn(() => new Promise<void>(() => {}));

    const navigation = rendered.result.current.commands.sidebar.navigatePrimary(
      {
        destination: "/collection",
        navigate: commitNavigation,
      },
    );
    await vi.advanceTimersByTimeAsync(MAX_ROUTE_COMMIT_MS);
    await navigation;

    expect(commitNavigation).toHaveBeenCalledWith(false);
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
    vi.useRealTimers();
  });

  it("does not animate a sidebar click on the current primary destination", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pane = document.createElement("div");
    pane.className = "library-pane";
    pane.dataset.codaTransitionKey = "favorites";
    pane.style.setProperty("transform", "translateX(-12px)");
    document.body.append(pane);
    const historyBefore = getMotionDiagnosticHistory().length;
    const rendered = renderController(
      {
        destination: routeDestination({
          primaryView: "favorites",
          screen: "favorites",
        }),
      },
      { href: "/favorites" },
    );
    const commitNavigation = vi.fn(() => new Promise<void>(() => {}));

    await rendered.result.current.commands.sidebar.navigatePrimary({
      destination: "/favorites",
      navigate: commitNavigation,
    });

    expect(commitNavigation).not.toHaveBeenCalled();
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
    expect(pane.style.transform).toBe("translateX(-12px)");
    expect(pane).not.toHaveClass("coda-live-page");
    expect(getMotionDiagnosticHistory()).toHaveLength(historyBefore);
    pane.remove();
    vi.useRealTimers();
  });

  it("compares sidebar targets by pathname plus committed search", async () => {
    const hung = vi.fn(() => new Promise<void>(() => {}));
    const lists = renderController(
      {
        destination: routeDestination({
          primaryView: "daily",
          screen: "daily",
        }),
      },
      { href: "/daily?category=lists", search: { category: "lists" } },
    );
    const listsCommit = vi.fn(async () => {
      lists.emitRendered?.();
    });
    await lists.result.current.commands.sidebar.navigatePrimary({
      destination: "/daily",
      navigate: listsCommit,
      search: DEFAULT_DAILY_ROUTE_SEARCH,
    });
    expect(listsCommit).toHaveBeenCalledWith(false);

    const collectionSearch = {
      ...DEFAULT_COLLECTION_ROUTE_SEARCH,
      mode: "artists" as const,
      q: "signal",
    };
    const noops = [
      {
        destination: "/daily" as const,
        href: "/daily?category=album-of-the-day",
        primaryView: "daily" as const,
        screen: "daily" as const,
        search: DEFAULT_DAILY_ROUTE_SEARCH,
      },
      {
        destination: "/radio" as const,
        href: "/radio",
        primaryView: "radio" as const,
        screen: "radio" as const,
        search: undefined,
      },
      {
        destination: "/collection" as const,
        href: "/collection",
        primaryView: "library" as const,
        screen: "collection" as const,
        search: collectionSearch,
      },
      {
        destination: "/recent" as const,
        href: "/recent",
        primaryView: "recent" as const,
        screen: "recent" as const,
        search: collectionSearch,
      },
    ];
    for (const noop of noops) {
      const rendered = renderController(
        {
          destination: routeDestination({
            primaryView: noop.primaryView,
            screen: noop.screen,
          }),
        },
        { href: noop.href, search: noop.search },
      );
      await rendered.result.current.commands.sidebar.navigatePrimary({
        destination: noop.destination,
        navigate: hung,
        search: noop.search,
      });
    }
    expect(hung).not.toHaveBeenCalled();
  });

  it("does not animate an already-current radio destination", async () => {
    const show: RadioShowSummary = {
      description: "A metal hour.",
      id: 979,
      publishedAt: "2026-01-01",
      subtitle: "Episode 979",
    };
    const historyBefore = getMotionDiagnosticHistory().length;
    const rendered = renderController({
      destination: routeDestination({
        detail: {
          kind: "radio-show",
          showId: parseRadioShowIdParam(show.id),
        },
        primaryView: "radio",
        screen: "radio-show",
      }),
    });

    act(() => {
      rendered.result.current.commands.radio.openShow(show);
    });

    expect(navigate).not.toHaveBeenCalled();
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
    expect(getMotionDiagnosticHistory()).toHaveLength(historyBefore);
  });

  it("keeps Discover snapshot when Back does not render", async () => {
    const rendered = renderFromDiscoverRelease();
    expect(rendered.result.current.state.discoverDetail).toEqual({
      releaseId: discoverRelease.id,
      releaseTitle: discoverRelease.title,
    });
    rendered.detail.back.mockResolvedValueOnce("timeout");

    act(() => {
      rendered.result.current.commands.discover.back();
    });

    await waitFor(() => {
      expect(rendered.notify).toHaveBeenCalledWith(
        "Going back took too long. Try again.",
        "bad",
      );
    });
    expect(rendered.result.current.state.discoverDetail).toEqual({
      releaseId: discoverRelease.id,
      releaseTitle: discoverRelease.title,
    });
  });

  it("keeps artist fallback when Back does not render", async () => {
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
    rendered.detail.back.mockResolvedValueOnce("failed");

    act(() => {
      rendered.result.current.commands.artist.back();
    });

    await waitFor(() => {
      expect(rendered.notify).toHaveBeenCalledWith(
        "Could not go back. Try again.",
        "bad",
      );
    });
    expect(rendered.result.current.state.selectedArtistFallback).toEqual({
      albumId: compilation.id,
      key: "guest artist",
      knownTrack: { duration: guestTrack.duration, id: guestTrack.id },
      name: guestTrack.artist,
    });
  });

  it("clears Discover snapshot only after a rendered Back", async () => {
    const rendered = renderFromDiscoverRelease();
    rendered.detail.back.mockResolvedValueOnce("rendered");

    await act(async () => {
      rendered.result.current.commands.discover.back();
    });

    await waitFor(() => {
      expect(rendered.result.current.state.discoverDetail).toBeUndefined();
    });
    expect(rendered.notify).not.toHaveBeenCalled();
  });

  it("falls through to Discover when closing the release does not render", async () => {
    const fromDiscover = renderFromDiscoverRelease();
    fromDiscover.detail.back.mockResolvedValueOnce("failed");

    expect(
      fromDiscover.result.current.commands.sidebar.beforeDiscoverNavigate(),
    ).toBe(true);
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith({
        search: fromDiscover.initialOptions.destination.discoverSearch,
        to: "/discover",
        viewTransition: false,
      });
    });
    expect(fromDiscover.notify).not.toHaveBeenCalled();
    expect(fromDiscover.result.current.state.discoverDetail).toEqual({
      releaseId: discoverRelease.id,
      releaseTitle: discoverRelease.title,
    });
  });

  it("toasts once when Discover close and index fallback both fail", async () => {
    const fromDiscover = renderFromDiscoverRelease();
    fromDiscover.detail.back.mockResolvedValueOnce("timeout");
    navigate.mockRejectedValueOnce(new Error("Discover index failed"));

    expect(
      fromDiscover.result.current.commands.sidebar.beforeDiscoverNavigate(),
    ).toBe(true);
    await waitFor(() => {
      expect(fromDiscover.notify).toHaveBeenCalledOnce();
    });
    expect(fromDiscover.notify).toHaveBeenCalledWith(
      "Discover index failed",
      "bad",
    );
    expect(fromDiscover.notify).not.toHaveBeenCalledWith(
      "Going back took too long. Try again.",
      "bad",
    );
  });
});
