import { act, render, renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activateDetailDestination,
  closeDetail,
  detailReturnStateCount,
  MAX_DETAIL_RETURN_STATES,
  openDetail,
  resetDetailNavigation,
} from "@/detailNavigation";
import type { RouteCommitOutcome } from "@/features/navigation/routeCommit";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
} from "@/routing/routeContracts";

import {
  albumCard,
  artistCard,
  cleanupControllerHarness,
  controllerMocks,
  controllerRuntime,
  destination,
  libraryScrollSurface,
  resetControllerHarness,
} from "./detailNavigationControllerTestHarness";
import { useDetailNavigationWithRuntime } from "./useDetailNavigation";

beforeEach(() => {
  resetControllerHarness();
});

afterEach(cleanupControllerHarness);

describe("detail navigation chain restoration", () => {
  it("restores each level when backing Album A → Artist X → Album B", async () => {
    const albumA = parseAlbumIdParam("album-a");
    const albumB = parseAlbumIdParam("album-b");
    const artistKey = parseArtistKeyParam("night archive");
    const sourceA = albumCard(albumA);
    const sourceX = artistCard(artistKey);
    const sourceB = albumCard(albumB);
    const scrollRoot = libraryScrollSurface(40);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    scrollRoot.scrollTop = 40;
    sourceA.artworkLink.focus();
    await act(() =>
      result.current.open({
        albumId: albumA,
        kind: "album",
        sourceTrigger: sourceA.artworkLink,
      }),
    );
    rerender({
      route: destination({ albumId: albumA, kind: "album" }, "entry-2"),
    });

    scrollRoot.scrollTop = 80;
    sourceX.link.focus();
    await act(() =>
      result.current.open({
        artistKey,
        kind: "artist",
        sourceTrigger: sourceX.link,
      }),
    );
    rerender({
      route: destination({ artistKey, kind: "artist" }, "entry-3"),
    });

    scrollRoot.scrollTop = 120;
    sourceB.artworkLink.focus();
    await act(() =>
      result.current.open({
        albumId: albumB,
        kind: "album",
        sourceTrigger: sourceB.artworkLink,
      }),
    );
    rerender({
      route: destination({ albumId: albumB, kind: "album" }, "entry-4"),
    });

    await act(() => result.current.back());
    rerender({
      route: destination({ artistKey, kind: "artist" }, "entry-3"),
    });
    expect(sourceB.artworkLink).toHaveFocus();
    expect(scrollRoot.scrollTop).toBe(120);

    await act(() => result.current.back());
    rerender({
      route: destination({ albumId: albumA, kind: "album" }, "entry-2"),
    });
    expect(sourceX.link).toHaveFocus();
    expect(scrollRoot.scrollTop).toBe(80);

    await act(() => result.current.back());
    rerender({ route: destination(undefined, "entry-1") });
    expect(sourceA.artworkLink).toHaveFocus();
    expect(scrollRoot.scrollTop).toBe(40);
  });

  it("focuses the previous heading when both descriptors fall back", async () => {
    const releaseId = parseDiscoverReleaseIdParam("discover:blue-hours");
    const playerArtwork = document.createElement("a");
    playerArtwork.href = "#/now-playing";
    playerArtwork.className = "player__art-link";
    playerArtwork.dataset.codaTrackId = "track-1";
    document.body.append(playerArtwork);
    const heading = document.createElement("h1");
    heading.id = "discover-release-heading";
    heading.tabIndex = -1;
    document.body.append(heading);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      {
        initialProps: {
          route: destination(
            { kind: "discover-release", releaseId },
            "entry-1",
          ),
        },
      },
    );

    await act(() =>
      result.current.open({ kind: "now-playing", trackId: "track-1" }),
    );
    rerender({ route: destination({ kind: "now-playing" }, "entry-2") });
    await act(() => result.current.back());
    rerender({
      route: destination({ kind: "discover-release", releaseId }, "entry-1"),
    });

    expect(heading).toHaveFocus();
  });

  it("abandons Radio close scroll when Now Playing open supersedes it", async () => {
    const scrollRoot = libraryScrollSurface(240);
    const playerArtwork = document.createElement("a");
    playerArtwork.href = "#/now-playing";
    playerArtwork.className = "player__art-link";
    playerArtwork.dataset.codaTrackId = "track-1";
    playerArtwork.tabIndex = 0;
    document.body.append(playerArtwork);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );

    await openDetail({
      kind: "radio",
      returnScrollTop: 240,
      source: {
        identity: "42",
        sharedIdentityAvailable: false,
      },
      targetKey: "radio:42",
      update: () => ({ locationKey: "radio-entry", outcome: "rendered" }),
    });
    scrollRoot.scrollTop = 0;

    let releaseRadioCommit = () => {};
    const radioCommit = new Promise<void>((resolve) => {
      releaseRadioCommit = resolve;
    });
    const radioClose = closeDetail({
      identity: "42",
      kind: "radio",
      requestKey: "radio-entry",
      restoreFocus: false,
      targetKey: "radio:42",
      update: async (): Promise<RouteCommitOutcome> => {
        await radioCommit;
        return "rendered";
      },
    });
    await act(() =>
      result.current.open({ kind: "now-playing", trackId: "track-1" }),
    );
    rerender({ route: destination({ kind: "now-playing" }, "entry-2") });
    releaseRadioCommit();
    await act(() => radioClose);

    expect(scrollRoot.scrollTop).toBe(0);
  });

  it("does not record return state for a superseded or failed open", async () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumCard(albumId);
    const { result, rerender } = renderHook(
      ({ route }) =>
        useDetailNavigationWithRuntime(route, controllerRuntime),
      { initialProps: { route: destination(undefined, "entry-1") } },
    );
    const before = detailReturnStateCount();
    controllerMocks.navigate.mockRejectedValueOnce(new Error("open failed"));

    await act(async () => {
      await result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      });
    });
    expect(detailReturnStateCount()).toBe(before);

    await act(() =>
      result.current.open({
        albumId,
        kind: "album",
        sourceTrigger: source.artworkLink,
      }),
    );
    expect(detailReturnStateCount()).toBe(before + 1);
    rerender({ route: destination({ albumId, kind: "album" }, "entry-2") });
    await act(() => result.current.back({ restoreFocus: false }));
  });

  it("focuses a destination heading once across Strict Mode double activation", async () => {
    const heading = document.createElement("h1");
    heading.id = "album-detail-heading";
    heading.tabIndex = -1;
    const focus = vi.spyOn(heading, "focus");
    document.body.append(heading);

    function ActivateOnce() {
      useLayoutEffect(() => {
        activateDetailDestination("album", "album:album-1");
      }, []);
      return null;
    }

    render(
      <StrictMode>
        <ActivateOnce />
      </StrictMode>,
    );

    await waitFor(() => expect(focus).toHaveBeenCalledOnce());
  });

  it("evicts the oldest return state once the map reaches its bound", async () => {
    resetDetailNavigation();
    for (let index = 0; index < MAX_DETAIL_RETURN_STATES + 1; index += 1) {
      await openDetail({
        kind: "playlist",
        source: {
          identity: `playlist-${index}`,
          sharedIdentityAvailable: false,
        },
        targetKey: `playlist:playlist-${index}`,
        update: () => ({
          locationKey: `location-${index}`,
          outcome: "rendered",
        }),
      });
    }

    expect(detailReturnStateCount()).toBe(MAX_DETAIL_RETURN_STATES);

    const seen: boolean[] = [];
    await closeDetail({
      identity: "playlist-0",
      kind: "playlist",
      requestKey: "location-0",
      restoreFocus: false,
      targetKey: "playlist:playlist-0",
      update: (hasReturnState) => {
        seen.push(hasReturnState);
        return "rendered";
      },
    });
    expect(seen).toEqual([false]);
  });
});
