import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveLibraryRouteInput } from "@/routing/libraryRouteInput";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
  validateCollectionSearch,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import type { CodaScreen } from "@/routing/routeMeta";

const controllerMocks = vi.hoisted(() => ({
  afterUpdate: undefined as (() => void) | undefined,
  capture: undefined as ((kind: string) => void) | undefined,
  navigate: vi.fn(),
  nextRenderKey: 2,
  onRendered: undefined as
    | ((
        event: Readonly<{ toLocation: { state: { __TSR_key: string } } }>,
      ) => void)
    | undefined,
  router: {
    history: {
      back: vi.fn(),
      canGoBack: vi.fn(() => false),
    },
    state: {
      location: { state: { __TSR_key: "entry-1" } },
    },
    subscribe: vi.fn(),
  },
  transition: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => controllerMocks.navigate,
  useRouter: () => controllerMocks.router,
}));

vi.mock("@/viewTransitions", () => ({
  transitionCodaView: controllerMocks.transition,
}));

import type {
  CodaDetailDestination,
  CodaRouteDestination,
} from "./useRouteDestination";
import { useDetailNavigationController } from "./useDetailNavigationController";

const collectionSearch = validateCollectionSearch({});
const discoverSearch = validateDiscoverSearch({});

function destination(
  detail: CodaDetailDestination | undefined,
  locationKey: string,
): CodaRouteDestination {
  let screen: CodaScreen = "collection";
  if (detail) screen = detail.kind;
  const libraryRouteInput = deriveLibraryRouteInput({
    albumId: detail?.kind === "album" ? detail.albumId : undefined,
    artistKey: detail?.kind === "artist" ? detail.artistKey : undefined,
    screen,
    search: collectionSearch,
    sourceAlbumId: detail?.kind === "artist" ? detail.sourceAlbumId : undefined,
  });

  return {
    collectionSearch,
    ...(detail ? { detail } : {}),
    discoverSearch,
    libraryRouteInput,
    locationKey,
    nowPlayingOpen: detail?.kind === "now-playing",
    primaryView:
      detail?.kind === "discover-release"
        ? "discover"
        : detail?.kind === "playlist"
          ? "playlists"
          : detail?.kind === "radio-series" || detail?.kind === "radio-show"
            ? "radio"
            : "library",
    screen,
  };
}

function albumCard(albumId: string) {
  const card = document.createElement("article");
  card.dataset.albumCard = albumId;
  const cover = document.createElement("div");
  cover.dataset.slot = "cover";
  const artworkLink = document.createElement("a");
  artworkLink.href = `#/collection/albums/${albumId}`;
  artworkLink.dataset.albumOpen = albumId;
  artworkLink.dataset.navigationSlot = "artwork";
  const playButton = document.createElement("button");
  playButton.textContent = "Play";
  const titleLink = document.createElement("a");
  titleLink.href = `#/collection/albums/${albumId}`;
  titleLink.dataset.albumOpen = albumId;
  titleLink.dataset.navigationSlot = "title";
  const titleTarget = document.createElement("span");
  titleTarget.dataset.codaAlbumTitleTarget = albumId;
  const title = document.createElement("span");
  title.dataset.slot = "overflow-marquee-text";
  title.textContent = "Soft Focus";
  titleTarget.append(title);
  titleLink.append(titleTarget);
  card.append(cover, artworkLink, playButton, titleLink);
  document.body.append(card);
  return { artworkLink, card, cover, playButton, title, titleLink };
}

function artistCard(artistKey: string) {
  const link = document.createElement("a");
  link.href = `#/collection/artists/${artistKey}`;
  link.dataset.artistOpen = artistKey;
  link.dataset.codaArtistCard = "";
  link.dataset.navigationSlot = `artist-card:${artistKey}`;
  const cover = document.createElement("div");
  cover.dataset.slot = "cover";
  const name = document.createElement("span");
  name.dataset.codaArtistNameTarget = artistKey;
  name.textContent = "Night Archive";
  link.append(cover, name);
  document.body.append(link);
  return { cover, link, name };
}

function discoverCard(releaseId: string) {
  const card = document.createElement("article");
  card.dataset.discoverReleaseCard = releaseId;
  const artwork = document.createElement("div");
  artwork.dataset.codaDiscoverArtwork = releaseId;
  const artworkLink = document.createElement("a");
  artworkLink.href = `#/discover/releases/${encodeURIComponent(releaseId)}`;
  artwork.append(artworkLink);
  const titleLink = document.createElement("a");
  titleLink.href = `#/discover/releases/${encodeURIComponent(releaseId)}`;
  const title = document.createElement("span");
  title.dataset.codaDiscoverTitle = releaseId;
  title.textContent = "Blue Hours";
  titleLink.append(title);
  card.append(artwork, titleLink);
  document.body.append(card);
  return { artwork, artworkLink, card, title, titleLink };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

beforeEach(() => {
  controllerMocks.afterUpdate = undefined;
  controllerMocks.capture = undefined;
  controllerMocks.nextRenderKey = 2;
  controllerMocks.onRendered = undefined;
  controllerMocks.router.state.location.state.__TSR_key = "entry-1";
  controllerMocks.navigate.mockReset().mockImplementation(async () => {
    const nextKey = `entry-${controllerMocks.nextRenderKey++}`;
    controllerMocks.router.state.location.state.__TSR_key = nextKey;
    controllerMocks.onRendered?.({
      toLocation: { state: { __TSR_key: nextKey } },
    });
  });
  controllerMocks.router.history.back.mockReset();
  controllerMocks.router.history.canGoBack.mockReset().mockReturnValue(false);
  controllerMocks.router.subscribe
    .mockReset()
    .mockImplementation(
      (event: string, listener: typeof controllerMocks.onRendered) => {
        if (event === "onRendered") controllerMocks.onRendered = listener;
        return () => {
          if (controllerMocks.onRendered === listener) {
            controllerMocks.onRendered = undefined;
          }
        };
      },
    );
  controllerMocks.transition
    .mockReset()
    .mockImplementation(
      async (update: () => void | Promise<void>, kind: string) => {
        controllerMocks.capture?.(kind);
        await update();
        controllerMocks.afterUpdate?.();
      },
    );
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("useDetailNavigationController", () => {
  it("marks only a validated album entity and role for a shared transition", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const captures: Array<{
      artwork: boolean;
      kind: string;
      titleIdentity: string | null;
    }> = [];
    controllerMocks.capture = (kind) => {
      captures.push({
        artwork: source.cover.classList.contains("coda-album-artwork-source"),
        kind,
        titleIdentity: source.title.getAttribute(
          "data-coda-album-title-source",
        ),
      });
    };
    const { result } = renderHook(() =>
      useDetailNavigationController(destination(undefined, "entry-1")),
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );

    expect(captures).toEqual([
      { artwork: true, kind: "album-detail", titleIdentity: albumId },
    ]);
    expect(source.cover).not.toHaveClass("coda-album-artwork-source");
    expect(source.title).not.toHaveAttribute("data-coda-album-title-source");
    expect(controllerMocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { albumId },
        to: "/collection/albums/$albumId",
        viewTransition: false,
      }),
    );
  });

  it("never promotes an album play button to shared artwork identity", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    source.playButton.dataset.albumOpen = albumId;
    const captures: Array<{ artwork: boolean; kind: string }> = [];
    controllerMocks.capture = (kind) => {
      captures.push({
        artwork: source.cover.classList.contains("coda-album-artwork-source"),
        kind,
      });
    };
    const { result } = renderHook(() =>
      useDetailNavigationController(destination(undefined, "entry-1")),
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.playButton,
      }),
    );

    expect(captures).toEqual([{ artwork: false, kind: "page-forward" }]);
  });

  it("uses page motion when only a disabled title identity is available", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    source.cover.remove();
    source.artworkLink.remove();
    const captures: Array<{ kind: string; titleIdentity: string | null }> = [];
    controllerMocks.capture = (kind) => {
      captures.push({
        kind,
        titleIdentity: source.title.getAttribute(
          "data-coda-album-title-source",
        ),
      });
    };
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      {
        initialProps: { route: destination(undefined, "entry-1") },
      },
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.titleLink,
      }),
    );
    rerender({
      route: destination({ kind: "album", albumId }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(captures).toEqual([
      { kind: "page-forward", titleIdentity: null },
      { kind: "page-back", titleIdentity: null },
    ]);
  });

  it("uses live page motion for a cold album shell", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const captures: Array<{
      artwork: boolean;
      kind: string;
      titleIdentity: string | null;
    }> = [];
    controllerMocks.capture = (kind) => {
      captures.push({
        artwork: source.cover.classList.contains("coda-album-artwork-source"),
        kind,
        titleIdentity: source.title.getAttribute(
          "data-coda-album-title-source",
        ),
      });
    };
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      {
        initialProps: { route: destination(undefined, "entry-1") },
      },
    );

    await act(() =>
      result.current.open({
        albumId,
        coldLoad: true,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    rerender({
      route: destination({ kind: "album", albumId }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(captures).toEqual([
      {
        artwork: false,
        kind: "page-forward",
        titleIdentity: null,
      },
      {
        artwork: false,
        kind: "album-detail-close",
        titleIdentity: null,
      },
    ]);
  });

  it("keeps album cover and title identity through an async transition finish", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const animationFinished = deferred();
    controllerMocks.transition.mockImplementationOnce(
      async (update: () => void | Promise<void>, kind: string) => {
        expect(kind).toBe("album-detail");
        await update();
        await animationFinished.promise;
      },
    );
    const { result } = renderHook(() =>
      useDetailNavigationController(destination(undefined, "entry-1")),
    );
    let opening!: Promise<unknown>;

    act(() => {
      opening = result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      });
    });
    await waitFor(() => expect(controllerMocks.navigate).toHaveBeenCalled());

    expect(source.cover).toHaveClass("coda-album-artwork-source");
    expect(source.title).toHaveAttribute(
      "data-coda-album-title-source",
      albumId,
    );

    await act(async () => {
      animationFinished.resolve();
      await opening;
    });
    expect(source.cover).not.toHaveClass("coda-album-artwork-source");
    expect(source.title).not.toHaveAttribute("data-coda-album-title-source");
  });

  it("lets only the latest concurrent detail activation own source markers", async () => {
    const firstAlbumId = parseAlbumIdParam("album-1");
    const secondAlbumId = parseAlbumIdParam("album-2");
    const firstSource = albumCard(firstAlbumId);
    const secondSource = albumCard(secondAlbumId);
    const firstFinished = deferred();
    const secondFinished = deferred();
    const finishes = [firstFinished, secondFinished];
    controllerMocks.transition.mockImplementation(
      async (update: () => void | Promise<void>) => {
        const finish = finishes.shift();
        await update();
        await finish?.promise;
      },
    );
    const { result } = renderHook(() =>
      useDetailNavigationController(destination(undefined, "entry-1")),
    );
    let firstOpening!: Promise<unknown>;
    let secondOpening!: Promise<unknown>;

    act(() => {
      firstOpening = result.current.open({
        albumId: firstAlbumId,
        kind: "album",
        sourceTrigger: firstSource.artworkLink,
      });
    });
    await waitFor(() =>
      expect(firstSource.cover).toHaveClass("coda-album-artwork-source"),
    );

    act(() => {
      secondOpening = result.current.open({
        albumId: secondAlbumId,
        kind: "album",
        sourceTrigger: secondSource.artworkLink,
      });
    });
    await waitFor(() =>
      expect(secondSource.cover).toHaveClass("coda-album-artwork-source"),
    );

    expect(firstSource.cover).not.toHaveClass("coda-album-artwork-source");
    expect(firstSource.title).not.toHaveAttribute(
      "data-coda-album-title-source",
    );
    expect(secondSource.title).toHaveAttribute(
      "data-coda-album-title-source",
      secondAlbumId,
    );

    await act(async () => {
      firstFinished.resolve();
      await firstOpening;
    });
    expect(secondSource.cover).toHaveClass("coda-album-artwork-source");
    expect(secondSource.title).toHaveAttribute(
      "data-coda-album-title-source",
      secondAlbumId,
    );

    await act(async () => {
      secondFinished.resolve();
      await secondOpening;
    });
    expect(secondSource.cover).not.toHaveClass("coda-album-artwork-source");
    expect(secondSource.title).not.toHaveAttribute(
      "data-coda-album-title-source",
    );
  });

  it("keeps the album transition update pending until the detail route renders", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    controllerMocks.navigate.mockReset().mockResolvedValue(undefined);
    let destinationPresentWhenUpdateSettled = false;
    controllerMocks.transition.mockImplementationOnce(
      async (update: () => void | Promise<void>, kind: string) => {
        expect(kind).toBe("album-detail");
        await update();
        destinationPresentWhenUpdateSettled = Boolean(
          document.querySelector(
            "[data-coda-album-detail-surface] .album-detail__artwork [data-slot='cover']",
          ),
        );
      },
    );
    const { result } = renderHook(() =>
      useDetailNavigationController(destination(undefined, "entry-1")),
    );
    let opening!: Promise<unknown>;

    act(() => {
      opening = result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      });
    });
    await waitFor(() => expect(controllerMocks.navigate).toHaveBeenCalled());
    await Promise.resolve();
    expect(destinationPresentWhenUpdateSettled).toBe(false);
    expect(source.cover).toHaveClass("coda-album-artwork-source");

    const detail = document.createElement("article");
    detail.dataset.codaAlbumDetailSurface = "";
    const artwork = document.createElement("div");
    artwork.className = "album-detail__artwork";
    const destinationCover = document.createElement("div");
    destinationCover.dataset.slot = "cover";
    artwork.append(destinationCover);
    detail.append(artwork);
    document.body.append(detail);
    controllerMocks.router.state.location.state.__TSR_key = "entry-2";

    await act(async () => {
      controllerMocks.onRendered?.({
        toLocation: { state: { __TSR_key: "entry-2" } },
      });
      await opening;
    });

    expect(destinationPresentWhenUpdateSettled).toBe(true);
    expect(source.cover).not.toHaveClass("coda-album-artwork-source");
  });

  it("preserves targeted shared kinds for artist, Discover, and Now Playing", async () => {
    const artistKey = parseArtistKeyParam("night archive");
    const artistLink = document.createElement("a");
    artistLink.href = "#/collection/artists/night%20archive";
    artistLink.dataset.artistOpen = artistKey;
    const artistCover = document.createElement("div");
    artistCover.dataset.slot = "cover";
    const artistName = document.createElement("span");
    artistName.dataset.codaArtistNameTarget = artistKey;
    artistLink.append(artistCover, artistName);

    const releaseId = parseDiscoverReleaseIdParam("discover:blue-hours");
    const releaseCard = document.createElement("article");
    releaseCard.dataset.discoverReleaseCard = releaseId;
    const releaseArtwork = document.createElement("div");
    releaseArtwork.dataset.codaDiscoverArtwork = releaseId;
    const releaseLink = document.createElement("a");
    releaseLink.href = "#/discover/releases/discover%3Ablue-hours";
    releaseArtwork.append(releaseLink);
    const releaseTitle = document.createElement("span");
    releaseTitle.dataset.codaDiscoverTitle = releaseId;
    releaseTitle.textContent = "Blue Hours";
    releaseCard.append(releaseArtwork, releaseTitle);

    const playerArtwork = document.createElement("a");
    playerArtwork.href = "#/now-playing";
    playerArtwork.className = "player__art-link";
    playerArtwork.dataset.codaTrackId = "track-1";
    const playerTitle = document.createElement("span");
    playerTitle.dataset.codaNowPlayingTitleCompact = "track-1";
    document.body.append(artistLink, releaseCard, playerArtwork, playerTitle);

    const kinds: string[] = [];
    const artistNameSources: Array<{
      inner: string | undefined;
      link: string | undefined;
    }> = [];
    controllerMocks.capture = (kind) => {
      kinds.push(kind);
      if (kinds.length === 1) {
        artistNameSources.push({
          inner: artistName.dataset.codaArtistNameSource,
          link: artistLink.dataset.codaArtistNameSource,
        });
      }
    };
    const { result } = renderHook(() =>
      useDetailNavigationController(destination(undefined, "entry-1")),
    );

    await act(() =>
      result.current.open({
        artistKey,
        kind: "artist",
        sourceTrigger: artistLink,
      }),
    );
    await act(() =>
      result.current.open({
        kind: "discover-release",
        releaseId,
        releaseTitle: "Blue Hours",
        sourceTrigger: releaseLink,
      }),
    );
    await act(() =>
      result.current.open({ kind: "now-playing", trackId: "track-1" }),
    );

    expect(kinds).toEqual([
      "page-forward",
      "discover-detail",
      "now-playing-open",
    ]);
    expect(artistNameSources).toEqual([
      { inner: undefined, link: undefined },
    ]);
    expect(kinds).not.toContain("page-crossfade");
  });

  it("pairs Now Playing artwork open and close transitions", async () => {
    const playerArtwork = document.createElement("a");
    playerArtwork.href = "#/now-playing";
    playerArtwork.className = "player__art-link";
    playerArtwork.dataset.codaTrackId = "track-1";
    document.body.append(playerArtwork);
    const kinds: string[] = [];
    controllerMocks.capture = (kind) => kinds.push(kind);
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({ kind: "now-playing", trackId: "track-1" }),
    );
    rerender({
      route: destination({ kind: "now-playing" }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds).toEqual(["now-playing-open", "now-playing-close"]);
  });

  it("pairs Now Playing without artwork with page transitions", async () => {
    const kinds: string[] = [];
    controllerMocks.capture = (kind) => kinds.push(kind);
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({ kind: "now-playing", trackId: "track-1" }),
    );
    rerender({
      route: destination({ kind: "now-playing" }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds).toEqual(["page-forward", "page-back"]);
  });

  it("refocuses an already-active destination without adding history", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const heading = document.createElement("h1");
    heading.id = "album-detail-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    const beforeCommit = vi.fn();
    const route = destination({ kind: "album", albumId }, "entry-2");
    const { result } = renderHook(() =>
      useDetailNavigationController(route),
    );
    const controller = result.current;

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.open({
        albumId,
        beforeCommit,
        kind: "album",
      });
    });

    await waitFor(() => expect(heading).toHaveFocus());
    expect(outcome).toBe("refocused");
    expect(beforeCommit).toHaveBeenCalledOnce();
    expect(result.current).toBe(controller);
    expect(controllerMocks.navigate).not.toHaveBeenCalled();
    expect(controllerMocks.transition).not.toHaveBeenCalled();
  });

  it("drops a manual refocus request after an unrelated route commit", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const sentinel = document.createElement("button");
    document.body.append(sentinel);
    sentinel.focus();
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      {
        initialProps: {
          route: destination({ kind: "album", albumId }, "entry-1"),
        },
      },
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
      }),
    );
    rerender({
      route: destination({ kind: "now-playing" }, "entry-2"),
    });
    const heading = document.createElement("h1");
    heading.id = "album-detail-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    rerender({
      route: destination({ kind: "album", albumId }, "entry-3"),
    });

    expect(sentinel).toHaveFocus();
  });

  it("opens a fresh destination without rerendering the source route", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useDetailNavigationController(destination(undefined, "entry-1"));
    });
    const renderCountBeforeOpen = renderCount;

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );

    expect(renderCount).toBe(renderCountBeforeOpen);
  });

  it("clears pending scroll when a forward open fails before commit", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const scrollRoot = document.createElement("main");
    scrollRoot.scrollTop = 184;
    document.body.append(scrollRoot);
    const failure = new Error("open failed");
    controllerMocks.transition.mockRejectedValueOnce(failure);
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );
    result.current.scrollRootRef.current = scrollRoot;

    await act(async () => {
      await expect(
        result.current.open({
          albumId,
          kind: "album",
          sourceTrigger: source.artworkLink,
        }),
      ).rejects.toBe(failure);
    });
    scrollRoot.scrollTop = 93;
    rerender({
      route: destination({ kind: "now-playing" }, "entry-2"),
    });

    expect(scrollRoot.scrollTop).toBe(93);
  });

  it("drops forward scroll restoration when no scroll root applies", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    rerender({
      route: destination({ kind: "album", albumId }, "entry-2"),
    });
    const lateScrollRoot = document.createElement("main");
    lateScrollRoot.scrollTop = 73;
    document.body.append(lateScrollRoot);
    result.current.scrollRootRef.current = lateScrollRoot;
    rerender({
      route: destination({ kind: "now-playing" }, "entry-3"),
    });

    expect(lateScrollRoot.scrollTop).toBe(73);
  });

  it("clears superseded forward scroll before a refocus request", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const artistKey = parseArtistKeyParam("night archive");
    const artistSource = artistCard(artistKey);
    const heading = document.createElement("h1");
    heading.id = "album-detail-heading";
    heading.tabIndex = -1;
    const scrollRoot = document.createElement("main");
    scrollRoot.scrollTop = 88;
    document.body.append(heading, scrollRoot);
    const firstTransitionFinished = deferred();
    controllerMocks.transition.mockImplementationOnce(async (update) => {
      await update();
      await firstTransitionFinished.promise;
    });
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      {
        initialProps: {
          route: destination({ kind: "album", albumId }, "entry-1"),
        },
      },
    );
    result.current.scrollRootRef.current = scrollRoot;

    let firstOpen!: Promise<unknown>;
    act(() => {
      firstOpen = result.current.open({
        artistKey,
        kind: "artist",
        sourceTrigger: artistSource.link,
      });
    });
    await waitFor(() => expect(controllerMocks.navigate).toHaveBeenCalledOnce());
    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
      }),
    );
    scrollRoot.scrollTop = 88;
    rerender({
      route: destination({ kind: "now-playing" }, "entry-2"),
    });

    expect(scrollRoot.scrollTop).toBe(88);

    firstTransitionFinished.resolve();
    await act(() => firstOpen);
  });

  it("starts Back without rerendering the outgoing detail route", async () => {
    const navigation = deferred();
    controllerMocks.navigate.mockReturnValueOnce(navigation.promise);
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useDetailNavigationController(
        destination({ kind: "now-playing" }, "entry-2"),
      );
    });
    const renderCountBeforeBack = renderCount;
    let back!: Promise<void>;

    act(() => {
      back = result.current.back();
    });
    await waitFor(() => expect(controllerMocks.navigate).toHaveBeenCalledOnce());

    expect(renderCount).toBe(renderCountBeforeBack);

    navigation.resolve();
    await act(() => back);
  });

  it("coalesces Back using the first caller's focus preference", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const sentinel = document.createElement("button");
    document.body.append(sentinel);
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );
    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    rerender({
      route: destination({ kind: "album", albumId }, "entry-2"),
    });
    sentinel.focus();
    controllerMocks.navigate.mockClear();
    controllerMocks.transition.mockClear();
    const closeStarted = deferred();
    const closeFinished = deferred();
    controllerMocks.transition.mockImplementationOnce(async (update) => {
      await update();
      closeStarted.resolve();
      await closeFinished.promise;
    });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.back({ restoreFocus: false });
      second = result.current.back();
    });
    await closeStarted.promise;

    expect(controllerMocks.transition).toHaveBeenCalledOnce();
    expect(controllerMocks.navigate).toHaveBeenCalledOnce();

    rerender({ route: destination(undefined, "entry-3") });
    closeFinished.resolve();
    await act(() => Promise.all([first, second]));

    expect(sentinel).toHaveFocus();
  });

  it("clears failed Back restoration without discarding its transaction", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const scrollRoot = document.createElement("main");
    scrollRoot.scrollTop = 312;
    const sentinel = document.createElement("button");
    document.body.append(scrollRoot, sentinel);
    const failure = new Error("transition failed");
    const kinds: string[] = [];
    controllerMocks.capture = (kind) => kinds.push(kind);
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );
    result.current.scrollRootRef.current = scrollRoot;
    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    rerender({
      route: destination({ kind: "album", albumId }, "entry-2"),
    });
    scrollRoot.scrollTop = 77;
    controllerMocks.transition.mockImplementationOnce(
      async (_update, kind: string) => {
        kinds.push(kind);
        throw failure;
      },
    );

    await act(async () => {
      await expect(result.current.back()).rejects.toBe(failure);
    });
    sentinel.focus();
    scrollRoot.scrollTop = 91;
    rerender({
      route: destination({ kind: "now-playing" }, "entry-3"),
    });

    expect(sentinel).toHaveFocus();
    expect(scrollRoot.scrollTop).toBe(91);

    rerender({
      route: destination({ kind: "album", albumId }, "entry-4"),
    });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds).toEqual([
      "album-detail",
      "album-detail-close",
      "album-detail-close",
    ]);
  });

  it("allows Back from a newly committed location while the prior transition settles", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const firstTransition = deferred();
    let transitionCount = 0;
    controllerMocks.transition.mockImplementation(
      async (update: () => void | Promise<void>) => {
        transitionCount += 1;
        await update();
        if (transitionCount === 1) await firstTransition.promise;
      },
    );
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      {
        initialProps: {
          route: destination({ kind: "album", albumId }, "entry-2"),
        },
      },
    );

    let first!: Promise<void>;
    act(() => {
      first = result.current.back();
    });
    await waitFor(() =>
      expect(controllerMocks.navigate).toHaveBeenCalledOnce(),
    );

    rerender({
      route: destination({ kind: "now-playing" }, "entry-3"),
    });
    let second!: Promise<void>;
    act(() => {
      second = result.current.back();
    });

    expect(second).not.toBe(first);
    await waitFor(() =>
      expect(controllerMocks.transition).toHaveBeenCalledTimes(2),
    );
    expect(controllerMocks.navigate).toHaveBeenCalledTimes(2);

    firstTransition.resolve();
    await act(() => Promise.all([first, second]));
  });

  it("does not let an older real Back transaction steal focus", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const albumSource = albumCard(albumId);
    const playerArtwork = document.createElement("a");
    playerArtwork.className = "player__art-link";
    playerArtwork.dataset.codaTrackId = "track-1";
    playerArtwork.href = "#/now-playing";
    document.body.append(playerArtwork);
    const firstBackReady = deferred();
    const firstBackFinished = deferred();
    controllerMocks.transition.mockImplementation(
      async (update: () => void | Promise<void>, kind: string) => {
        await update();
        if (kind === "album-detail-close") {
          firstBackReady.resolve();
          await firstBackFinished.promise;
        }
      },
    );
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: albumSource.artworkLink,
      }),
    );
    rerender({
      route: destination({ kind: "album", albumId }, "entry-2"),
    });
    let firstBack!: Promise<void>;
    act(() => {
      firstBack = result.current.back();
    });
    await firstBackReady.promise;

    rerender({ route: destination(undefined, "entry-3") });
    await act(() =>
      result.current.open({ kind: "now-playing", trackId: "track-1" }),
    );
    rerender({
      route: destination({ kind: "now-playing" }, "entry-4"),
    });
    await act(() => result.current.back());
    rerender({ route: destination(undefined, "entry-5") });
    expect(playerArtwork).toHaveFocus();

    firstBackFinished.resolve();
    await act(() => firstBack);

    expect(playerArtwork).toHaveFocus();
  });

  it("restores virtualized source focus and scroll after fallback Back", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const kinds: string[] = [];
    const returnMarkers: Array<{
      artwork: string | undefined;
      title: string | undefined;
    }> = [];
    controllerMocks.capture = (kind) => kinds.push(kind);
    const scrollRoot = document.createElement("main");
    scrollRoot.scrollTop = 312;
    document.body.append(scrollRoot);
    const initialDestination = destination(undefined, "entry-1");
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: initialDestination } },
    );
    result.current.scrollRootRef.current = scrollRoot;

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    const heading = document.createElement("h1");
    heading.id = "album-detail-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    rerender({
      route: destination({ kind: "album", albumId }, "entry-2"),
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(scrollRoot.scrollTop).toBe(0);

    source.card.remove();
    let replacementCard: ReturnType<typeof albumCard> | undefined;
    window.requestAnimationFrame(() => {
      replacementCard = albumCard(albumId);
    });
    controllerMocks.afterUpdate = () => {
      returnMarkers.push({
        artwork: replacementCard?.cover.dataset.codaAlbumArtworkReturn,
        title: replacementCard?.title.dataset.codaAlbumTitleReturn,
      });
    };
    await act(() => result.current.back());
    rerender({ route: destination(undefined, "entry-3") });

    await waitFor(() => expect(replacementCard?.artworkLink).toHaveFocus());
    expect(scrollRoot.scrollTop).toBe(312);
    expect(kinds).toEqual(["album-detail", "album-detail-close"]);
    expect(returnMarkers.at(-1)).toEqual({
      artwork: albumId,
      title: albumId,
    });
    expect(replacementCard?.cover).not.toHaveAttribute(
      "data-coda-album-artwork-return",
    );
    expect(replacementCard?.title).not.toHaveAttribute(
      "data-coda-album-title-return",
    );
    expect(controllerMocks.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        replace: true,
        to: "/collection",
        viewTransition: false,
      }),
    );
  });

  it("uses page Back when an artist transaction has no artwork owner", async () => {
    const artistKey = parseArtistKeyParam("night archive");
    const source = artistCard(artistKey);
    source.cover.remove();
    const kinds: string[] = [];
    controllerMocks.capture = (kind) => kinds.push(kind);
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        artistKey,
        kind: "artist",
        sourceTrigger: source.link,
      }),
    );
    rerender({
      route: destination({ artistKey, kind: "artist" }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds).toEqual(["page-forward", "page-back"]);
  });

  it("reverse-morphs an artist name and artwork into the exact source card", async () => {
    const artistKey = parseArtistKeyParam("night archive");
    const source = artistCard(artistKey);
    const kinds: string[] = [];
    const returnMarkers: Array<{
      artwork: string | undefined;
      name: string | undefined;
    }> = [];
    controllerMocks.capture = (kind) => kinds.push(kind);
    controllerMocks.afterUpdate = () => {
      returnMarkers.push({
        artwork: source.cover.dataset.codaArtistArtworkReturn,
        name: source.name.dataset.codaArtistNameReturn,
      });
    };
    const initialDestination = destination(undefined, "entry-1");
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: initialDestination } },
    );

    await act(() =>
      result.current.open({
        artistKey,
        kind: "artist",
        sourceTrigger: source.link,
      }),
    );
    rerender({
      route: destination({ artistKey, kind: "artist" }, "entry-2"),
    });

    await act(() => result.current.back());

    expect(kinds).toEqual(["artist-detail", "artist-detail-close"]);
    expect(returnMarkers.at(-1)).toEqual({
      artwork: artistKey,
      name: artistKey,
    });
    expect(source.cover).not.toHaveAttribute("data-coda-artist-artwork-return");
    expect(source.name).not.toHaveAttribute("data-coda-artist-name-return");
  });

  it("uses page Back when a Discover transaction has no artwork owner", async () => {
    const releaseId = parseDiscoverReleaseIdParam("discover:blue-hours");
    const source = discoverCard(releaseId);
    source.artwork.remove();
    const kinds: string[] = [];
    controllerMocks.capture = (kind) => kinds.push(kind);
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        kind: "discover-release",
        releaseId,
        releaseTitle: "Blue Hours",
        sourceTrigger: source.titleLink,
      }),
    );
    rerender({
      route: destination({ kind: "discover-release", releaseId }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds).toEqual(["page-forward", "page-back"]);
  });

  it("reverse-morphs Discover artwork and title into the exact originating slot", async () => {
    const releaseId = parseDiscoverReleaseIdParam("discover:blue-hours");
    const source = discoverCard(releaseId);
    const kinds: string[] = [];
    const returnMarkers: Array<{
      artwork: string | undefined;
      title: string | undefined;
    }> = [];
    const scrollRoot = document.createElement("main");
    scrollRoot.scrollTop = 428;
    document.body.append(scrollRoot);
    controllerMocks.capture = (kind) => kinds.push(kind);
    const initialDestination = destination(undefined, "entry-1");
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: initialDestination } },
    );
    result.current.scrollRootRef.current = scrollRoot;

    await act(() =>
      result.current.open({
        kind: "discover-release",
        releaseId,
        releaseTitle: "Blue Hours",
        sourceTrigger: source.titleLink,
      }),
    );
    const heading = document.createElement("h1");
    heading.id = "discover-release-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    rerender({
      route: destination({ kind: "discover-release", releaseId }, "entry-2"),
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(scrollRoot.scrollTop).toBe(0);

    source.card.remove();
    let replacement: ReturnType<typeof discoverCard> | undefined;
    window.requestAnimationFrame(() => {
      replacement = discoverCard(releaseId);
    });
    controllerMocks.afterUpdate = () => {
      returnMarkers.push({
        artwork: replacement?.artwork.dataset.codaDiscoverArtworkReturn,
        title: replacement?.title.dataset.codaDiscoverTitleReturn,
      });
    };

    await act(() => result.current.back());
    rerender({ route: destination(undefined, "entry-3") });

    await waitFor(() => expect(replacement?.titleLink).toHaveFocus());
    expect(scrollRoot.scrollTop).toBe(428);
    expect(kinds).toEqual(["discover-detail", "discover-detail-close"]);
    expect(returnMarkers.at(-1)).toEqual({
      artwork: releaseId,
      title: releaseId,
    });
    expect(replacement?.artwork).not.toHaveAttribute(
      "data-coda-discover-artwork-return",
    );
    expect(replacement?.title).not.toHaveAttribute(
      "data-coda-discover-title-return",
    );
    expect(controllerMocks.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        replace: true,
        to: "/discover",
        viewTransition: false,
      }),
    );
  });

  it("keeps non-card Discover returns on the directional page transition", async () => {
    const releaseId = parseDiscoverReleaseIdParam("discover:blue-hours");
    const playerAlbumLink = document.createElement("a");
    playerAlbumLink.href = `#/discover/releases/${encodeURIComponent(releaseId)}`;
    playerAlbumLink.dataset.playerAlbumLink = "";
    const playerTitle = document.createElement("span");
    playerTitle.dataset.slot = "overflow-marquee-text";
    playerTitle.textContent = "Blue Hours";
    playerAlbumLink.append(playerTitle);
    document.body.append(playerAlbumLink);
    const kinds: string[] = [];
    controllerMocks.capture = (kind) => {
      kinds.push(kind);
    };
    const { result, rerender } = renderHook(
      ({ route }) => useDetailNavigationController(route),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        kind: "discover-release",
        releaseId,
        releaseTitle: "Blue Hours",
        sourceTrackId: "track-1",
        sourceTrigger: playerAlbumLink,
      }),
    );
    rerender({
      route: destination({ kind: "discover-release", releaseId }, "entry-2"),
    });

    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds).toEqual(["page-forward", "page-back"]);
    expect(playerAlbumLink).not.toHaveAttribute(
      "data-coda-discover-title-return",
    );
  });
});
