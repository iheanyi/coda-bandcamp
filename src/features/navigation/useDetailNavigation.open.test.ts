import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getMotionDiagnostic } from "@/motionDiagnostics";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
} from "@/routing/routeContracts";
import type { CodaViewTransitionKind } from "@/viewTransitions";

import {
  albumCard,
  artistCard,
  cleanupControllerHarness,
  controllerHarness,
  controllerMocks,
  controllerRuntime,
  destination,
  emitRenderedLocation,
  latestViewTransition,
  libraryScrollSurface,
  resetControllerHarness,
} from "./detailNavigationControllerTestHarness";
import {
  type DetailNavigationController,
  useDetailNavigationWithRuntime,
} from "./useDetailNavigation";

let captureTransition: ((kind: CodaViewTransitionKind) => void) | undefined;

beforeEach(() => {
  resetControllerHarness();
  captureTransition = undefined;
  controllerHarness.captureTransition = (kind) => captureTransition?.(kind);
});

afterEach(cleanupControllerHarness);

describe("detail navigation opening", () => {
  it("marks only a validated album entity and role for a shared transition", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const captures: Array<{
      artwork: boolean;
      kind: string;
      titleIdentity: string | null;
    }> = [];
    captureTransition = (kind) => {
      captures.push({
        artwork: source.cover.classList.contains("coda-album-artwork-source"),
        kind,
        titleIdentity: source.title.getAttribute("data-coda-album-title-source"),
      });
    };
    const { result } = renderHook(() =>
      useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      ),
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
    const { result } = renderHook(() =>
      useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      ),
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.playButton,
      }),
    );

    expect(getMotionDiagnostic()?.kind).toBe("page-forward");
    expect(source.cover).not.toHaveClass("coda-album-artwork-source");
  });

  it("uses page motion when only a disabled title identity is available", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    source.cover.remove();
    source.artworkLink.remove();
    const kinds: string[] = [];
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.titleLink,
      }),
    );
    kinds.push(getMotionDiagnostic()?.kind ?? "");
    rerender({ route: destination({ kind: "album", albumId }, "entry-2") });
    await act(() => result.current.back({ restoreFocus: false }));
    kinds.push(getMotionDiagnostic()?.kind ?? "");

    expect(kinds).toEqual(["page-forward", "page-back"]);
    expect(source.title).not.toHaveAttribute("data-coda-album-title-source");
  });

  it("uses live page motion for a cold album shell", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const kinds: string[] = [];
    captureTransition = (kind) => kinds.push(kind);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        albumId,
        coldLoad: true,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    kinds.unshift(getMotionDiagnostic()?.kind ?? "");
    rerender({ route: destination({ kind: "album", albumId }, "entry-2") });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds).toEqual(["page-forward", "album-detail-close"]);
    expect(source.cover).not.toHaveClass("coda-album-artwork-source");
  });

  it("keeps album cover and title identity through an async transition finish", async () => {
    cleanupControllerHarness();
    resetControllerHarness(false);
    controllerHarness.captureTransition = (kind) => captureTransition?.(kind);
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const { result } = renderHook(() =>
      useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      ),
    );
    let opening!: ReturnType<DetailNavigationController["open"]>;

    act(() => {
      opening = result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      });
    });
    await waitFor(() => expect(controllerMocks.navigate).toHaveBeenCalled());

    expect(source.cover).toHaveClass("coda-album-artwork-source");
    expect(source.title).toHaveAttribute("data-coda-album-title-source", albumId);

    await act(async () => {
      latestViewTransition()?.resolve();
      await opening;
    });
    expect(source.cover).not.toHaveClass("coda-album-artwork-source");
    expect(source.title).not.toHaveAttribute("data-coda-album-title-source");
  });

  it("lets only the latest concurrent detail activation own source markers", async () => {
    cleanupControllerHarness();
    resetControllerHarness(false);
    controllerHarness.captureTransition = (kind) => captureTransition?.(kind);
    const firstAlbumId = parseAlbumIdParam("album-1");
    const secondAlbumId = parseAlbumIdParam("album-2");
    const firstSource = albumCard(firstAlbumId);
    const secondSource = albumCard(secondAlbumId);
    const { result } = renderHook(() =>
      useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      ),
    );
    let firstOpening!: ReturnType<DetailNavigationController["open"]>;
    let secondOpening!: ReturnType<DetailNavigationController["open"]>;

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
    expect(firstSource.title).not.toHaveAttribute("data-coda-album-title-source");
    expect(secondSource.title).toHaveAttribute(
      "data-coda-album-title-source",
      secondAlbumId,
    );

    await act(async () => {
      controllerHarness.viewTransition?.transitions[0]?.resolve();
      await firstOpening;
    });
    expect(secondSource.cover).toHaveClass("coda-album-artwork-source");

    await act(async () => {
      latestViewTransition()?.resolve();
      await secondOpening;
    });
    expect(secondSource.cover).not.toHaveClass("coda-album-artwork-source");
    expect(secondSource.title).not.toHaveAttribute("data-coda-album-title-source");
  });

  it("keeps the album transition update pending until the detail route renders", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    controllerMocks.navigate.mockReset().mockResolvedValue(undefined);
    let destinationPresentWhenUpdateSettled = false;
    const { result } = renderHook(() =>
      useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      ),
    );
    let opening!: ReturnType<DetailNavigationController["open"]>;

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
    destinationPresentWhenUpdateSettled = Boolean(
      document.querySelector(
        "[data-coda-album-detail-surface] .album-detail__artwork [data-slot='cover']",
      ),
    );

    await act(async () => {
      emitRenderedLocation("entry-2");
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
    captureTransition = (kind) => {
      kinds.push(kind);
      if (kinds.length === 1) {
        artistNameSources.push({
          inner: artistName.dataset.codaArtistNameSource,
          link: artistLink.dataset.codaArtistNameSource,
        });
      }
    };
    const { result } = renderHook(() =>
      useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      ),
    );

    await act(() =>
      result.current.open({
        artistKey,
        kind: "artist",
        sourceTrigger: artistLink,
      }),
    );
    artistNameSources.push({
      inner: artistName.dataset.codaArtistNameSource,
      link: artistLink.dataset.codaArtistNameSource,
    });
    if (getMotionDiagnostic()?.kind === "page-forward") {
      kinds.unshift("page-forward");
    }
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
    expect(artistNameSources).toEqual([{ inner: undefined, link: undefined }]);
    expect(kinds).not.toContain("page-crossfade");
  });

  it("pairs Now Playing artwork open and close transitions", async () => {
    const playerArtwork = document.createElement("a");
    playerArtwork.href = "#/now-playing";
    playerArtwork.className = "player__art-link";
    playerArtwork.dataset.codaTrackId = "track-1";
    document.body.append(playerArtwork);
    const kinds: string[] = [];
    captureTransition = (kind) => kinds.push(kind);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({ kind: "now-playing", trackId: "track-1" }),
    );
    rerender({ route: destination({ kind: "now-playing" }, "entry-2") });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds).toEqual(["now-playing-open", "now-playing-close"]);
  });

  it("pairs Now Playing without artwork with page transitions", async () => {
    const kinds: string[] = [];
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({ kind: "now-playing", trackId: "track-1" }),
    );
    kinds.push(getMotionDiagnostic()?.kind ?? "");
    rerender({ route: destination({ kind: "now-playing" }, "entry-2") });
    await act(() => result.current.back({ restoreFocus: false }));
    kinds.push(getMotionDiagnostic()?.kind ?? "");

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
      useDetailNavigationWithRuntime(route, controllerRuntime),
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
  });

  it("propagates a failed open commit instead of claiming navigation", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    controllerMocks.navigate.mockRejectedValueOnce(new Error("route failed"));
    const { result } = renderHook(() =>
      useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      ),
    );

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      });
    });

    expect(outcome).toBe("failed");
  });

  it("reports a rendered open commit", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const { result } = renderHook(() =>
      useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      ),
    );

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      });
    });

    expect(outcome).toBe("rendered");
  });

  it("drops a manual refocus request after an unrelated route commit", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const sentinel = document.createElement("button");
    document.body.append(sentinel);
    sentinel.focus();
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
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
    rerender({ route: destination({ kind: "now-playing" }, "entry-2") });
    const heading = document.createElement("h1");
    heading.id = "album-detail-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    rerender({ route: destination({ kind: "album", albumId }, "entry-3") });

    expect(sentinel).toHaveFocus();
  });

  it("opens a fresh destination without rerendering the source route", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useDetailNavigationWithRuntime(
        destination(undefined, "entry-1"),
        controllerRuntime,
      );
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
    const scrollRoot = libraryScrollSurface(184);
    const failure = new Error("open failed");
    controllerMocks.navigate.mockRejectedValueOnce(failure);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(async () => {
      await result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      });
    });
    scrollRoot.scrollTop = 93;
    rerender({ route: destination({ kind: "now-playing" }, "entry-2") });

    expect(scrollRoot.scrollTop).toBe(93);
  });

  it("drops forward scroll restoration when no scroll root applies", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    rerender({ route: destination({ kind: "album", albumId }, "entry-2") });
    const lateScrollRoot = libraryScrollSurface(73);
    rerender({ route: destination({ kind: "now-playing" }, "entry-3") });

    expect(lateScrollRoot.scrollTop).toBe(73);
  });

  it("clears superseded forward scroll before a refocus request", async () => {
    resetControllerHarness(false);
    controllerHarness.captureTransition = (kind) => captureTransition?.(kind);
    const albumId = parseAlbumIdParam("album-1");
    const artistKey = parseArtistKeyParam("night archive");
    const artistSource = artistCard(artistKey);
    const heading = document.createElement("h1");
    heading.id = "album-detail-heading";
    heading.tabIndex = -1;
    const scrollRoot = libraryScrollSurface(88);
    document.body.append(heading);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      {
        initialProps: {
          route: destination({ kind: "album", albumId }, "entry-1"),
        },
      },
    );

    let firstOpen!: ReturnType<DetailNavigationController["open"]>;
    act(() => {
      firstOpen = result.current.open({
        artistKey,
        kind: "artist",
        sourceTrigger: artistSource.link,
      });
    });
    await waitFor(() =>
      expect(controllerMocks.navigate).toHaveBeenCalledOnce(),
    );
    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
      }),
    );
    scrollRoot.scrollTop = 88;
    rerender({ route: destination({ kind: "now-playing" }, "entry-2") });

    expect(scrollRoot.scrollTop).toBe(88);

    latestViewTransition()?.resolve();
    await act(() => firstOpen);
  });
});
