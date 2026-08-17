import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { activateDetailDestination } from "@/detailNavigation";
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
  discoverCard,
  latestViewTransition,
  libraryScrollSurface,
  resetControllerHarness,
} from "./detailNavigationControllerTestHarness";
import { useDetailNavigationWithRuntime } from "./useDetailNavigation";

let afterTransitionUpdate: (() => void) | undefined;
let captureTransition: ((kind: CodaViewTransitionKind) => void) | undefined;

beforeEach(() => {
  resetControllerHarness();
  afterTransitionUpdate = undefined;
  captureTransition = undefined;
  controllerHarness.captureTransition = (kind) => captureTransition?.(kind);
  controllerHarness.afterTransitionUpdate = () => afterTransitionUpdate?.();
});

afterEach(cleanupControllerHarness);

describe("detail navigation returns", () => {
  it("starts Back without rerendering the outgoing detail route", async () => {
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return useDetailNavigationWithRuntime(
        destination({ kind: "now-playing" }, "entry-2"),
        controllerRuntime,
      );
    });
    const renderCountBeforeBack = renderCount;
    const back = result.current.back();
    await vi.waitFor(() =>
      expect(controllerMocks.navigate).toHaveBeenCalledOnce(),
    );

    expect(renderCount).toBe(renderCountBeforeBack);

    await act(() => back);
  });

  it("coalesces Back using the first caller's focus preference", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const sentinel = document.createElement("button");
    document.body.append(sentinel);
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
    sentinel.focus();
    controllerMocks.navigate.mockClear();

    const first = result.current.back({ restoreFocus: false });
    const second = result.current.back();
    await waitFor(() => expect(controllerMocks.navigate).toHaveBeenCalledOnce());

    expect(first).toBe(second);

    rerender({ route: destination(undefined, "entry-3") });
    latestViewTransition()?.resolve();
    await act(() => Promise.all([first, second]));

    expect(sentinel).toHaveFocus();
  });

  it("clears failed Back restoration without discarding its return state", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const scrollRoot = libraryScrollSurface(312);
    const sentinel = document.createElement("button");
    document.body.append(sentinel);
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
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    kinds.length = 0;
    rerender({ route: destination({ kind: "album", albumId }, "entry-2") });
    scrollRoot.scrollTop = 77;
    controllerMocks.navigate.mockRejectedValueOnce(new Error("transition failed"));

    await act(async () => {
      await result.current.back();
    });
    sentinel.focus();
    scrollRoot.scrollTop = 91;
    rerender({ route: destination({ kind: "now-playing" }, "entry-3") });

    expect(sentinel).toHaveFocus();
    expect(scrollRoot.scrollTop).toBe(91);

    rerender({ route: destination({ kind: "album", albumId }, "entry-2") });
    await act(() => result.current.back({ restoreFocus: false }));

    expect(kinds.at(-1)).toBe("album-detail-close");
  });

  it("allows Back from a newly committed location while the prior transition settles", async () => {
    cleanupControllerHarness();
    resetControllerHarness(false);
    const albumId = parseAlbumIdParam("album-1");
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      {
        initialProps: {
          route: destination({ kind: "album", albumId }, "entry-2"),
        },
      },
    );

    const first = result.current.back();
    await vi.waitFor(() =>
      expect(controllerMocks.navigate).toHaveBeenCalledOnce(),
    );

    rerender({ route: destination({ kind: "now-playing" }, "entry-3") });
    const second = result.current.back();

    expect(second).not.toBe(first);
    await vi.waitFor(() =>
      expect(controllerMocks.navigate).toHaveBeenCalledTimes(2),
    );

    latestViewTransition()?.resolve();
    await act(() => Promise.all([first, second]));
  });

  it("does not let an older real Back steal focus", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const albumSource = albumCard(albumId);
    const playerArtwork = document.createElement("a");
    playerArtwork.className = "player__art-link";
    playerArtwork.dataset.codaTrackId = "track-1";
    playerArtwork.href = "#/now-playing";
    playerArtwork.tabIndex = 0;
    document.body.append(playerArtwork);
    cleanupControllerHarness();
    resetControllerHarness(false);
    document.body.append(albumSource.card, playerArtwork);
    controllerHarness.captureTransition = (kind) => captureTransition?.(kind);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    const opening = result.current.open({
      albumId,
      kind: "album",
      sourceTrigger: albumSource.artworkLink,
    });
    await vi.waitFor(() => expect(latestViewTransition()).toBeDefined());
    latestViewTransition()?.resolve();
    await act(() => opening);
    rerender({ route: destination({ kind: "album", albumId }, "entry-2") });
    const firstBack = result.current.back();
    await vi.waitFor(() => expect(controllerMocks.navigate).toHaveBeenCalled());

    rerender({ route: destination(undefined, "entry-3") });
    const nowPlayingOpen = result.current.open({
      kind: "now-playing",
      trackId: "track-1",
    });
    await vi.waitFor(() =>
      expect(controllerHarness.viewTransition?.transitions.length).toBeGreaterThan(1),
    );
    latestViewTransition()?.resolve();
    await act(() => nowPlayingOpen);
    rerender({ route: destination({ kind: "now-playing" }, "entry-4") });
    const nowPlayingBack = result.current.back();
    await vi.waitFor(() =>
      expect(controllerHarness.viewTransition?.transitions.length).toBeGreaterThan(2),
    );
    latestViewTransition()?.resolve();
    await act(() => nowPlayingBack);
    rerender({ route: destination(undefined, "entry-5") });
    expect(playerArtwork).toHaveFocus();

    latestViewTransition()?.resolve();
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
    captureTransition = (kind) => kinds.push(kind);
    const scrollRoot = libraryScrollSurface(312);
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
    const heading = document.createElement("h1");
    heading.id = "album-detail-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    rerender({ route: destination({ kind: "album", albumId }, "entry-2") });
    activateDetailDestination("album", `album:${albumId}`);
    await waitFor(() => expect(heading).toHaveFocus());
    expect(scrollRoot.scrollTop).toBe(0);

    source.card.remove();
    let replacementCard: ReturnType<typeof albumCard> | undefined;
    window.requestAnimationFrame(() => {
      replacementCard = albumCard(albumId);
    });
    afterTransitionUpdate = () => {
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
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await act(() =>
      result.current.open({
        artistKey,
        kind: "artist",
        sourceTrigger: source.link,
      }),
    );
    kinds.push(getMotionDiagnostic()?.kind ?? "");
    rerender({
      route: destination({ artistKey, kind: "artist" }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));
    kinds.push(getMotionDiagnostic()?.kind ?? "");

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
    captureTransition = (kind) => kinds.push(kind);
    afterTransitionUpdate = () => {
      returnMarkers.push({
        artwork: source.cover.dataset.codaArtistArtworkReturn,
        name: source.nameText.dataset.codaArtistNameReturn,
      });
    };
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
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
    await act(() => result.current.back());

    expect(kinds).toEqual(["artist-detail", "artist-detail-close"]);
    expect(returnMarkers.at(-1)).toEqual({
      artwork: artistKey,
      name: artistKey,
    });
    expect(source.cover).not.toHaveAttribute("data-coda-artist-artwork-return");
    expect(source.nameText).not.toHaveAttribute("data-coda-artist-name-return");
  });

  it("uses page Back when a Discover transaction has no artwork owner", async () => {
    const releaseId = parseDiscoverReleaseIdParam("discover:blue-hours");
    const source = discoverCard(releaseId);
    source.artwork.remove();
    const kinds: string[] = [];
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
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
    kinds.push(getMotionDiagnostic()?.kind ?? "");
    rerender({
      route: destination({ kind: "discover-release", releaseId }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));
    kinds.push(getMotionDiagnostic()?.kind ?? "");

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
    const scrollRoot = libraryScrollSurface(428);
    captureTransition = (kind) => kinds.push(kind);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
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
    const heading = document.createElement("h1");
    heading.id = "discover-release-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    rerender({
      route: destination({ kind: "discover-release", releaseId }, "entry-2"),
    });
    activateDetailDestination(
      "discover-release",
      `discover-release:${releaseId}`,
    );
    await vi.waitFor(() => expect(heading).toHaveFocus());
    expect(scrollRoot.scrollTop).toBe(0);

    source.card.remove();
    let replacement: ReturnType<typeof discoverCard> | undefined;
    window.requestAnimationFrame(() => {
      replacement = discoverCard(releaseId);
    });
    afterTransitionUpdate = () => {
      returnMarkers.push({
        artwork: replacement?.artwork.dataset.codaDiscoverArtworkReturn,
        title: replacement?.title.dataset.codaDiscoverTitleReturn,
      });
    };

    await act(() => result.current.back());
    rerender({ route: destination(undefined, "entry-3") });

    await vi.waitFor(() => expect(replacement?.titleLink).toHaveFocus());
    expect(scrollRoot.scrollTop).toBe(428);
    expect(kinds).toEqual(["discover-detail", "discover-detail-close"]);
    expect(returnMarkers.at(-1)).toEqual({
      artwork: releaseId,
      title: releaseId,
    });
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
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
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
    kinds.push(getMotionDiagnostic()?.kind ?? "");
    rerender({
      route: destination({ kind: "discover-release", releaseId }, "entry-2"),
    });
    await act(() => result.current.back({ restoreFocus: false }));
    kinds.push(getMotionDiagnostic()?.kind ?? "");

    expect(kinds).toEqual(["page-forward", "page-back"]);
    expect(playerAlbumLink).not.toHaveAttribute("data-coda-discover-title-return");
  });
});
