import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activateDetailDestination,
  cancelDetailNavigation,
  clearDestinationFocus,
  closeDetail,
  detailReturnStateCount,
  openDetail,
  resetDetailNavigation,
} from "@/detailNavigation";
import { DETAIL_TRANSITION_DESCRIPTORS } from "@/detailTransitionDescriptors";
import { prepareDetailSource } from "@/features/navigation/detailSourceIdentity";
import { installDocumentViewTransitionHarness } from "@/test/documentViewTransitionHarness";
import type { CodaViewTransitionKind } from "@/viewTransitions";

const DETAIL_TRANSITION_KINDS = [
  "album",
  "artist",
  "daily",
  "discover-release",
  "playlist",
  "radio",
  "now-playing",
] as const;

function playlistTrigger(playlistId: string) {
  const trigger = document.createElement("button");
  trigger.dataset.playlistOpen = playlistId;
  const identity = document.createElement("span");
  identity.dataset.playlistIdentity = playlistId;
  const titleRoot = document.createElement("span");
  titleRoot.dataset.playlistTitle = playlistId;
  const title = document.createElement("span");
  title.dataset.slot = "overflow-marquee-text";
  titleRoot.append(title);
  trigger.append(identity, titleRoot);
  return { identity, title, trigger };
}

function nowPlayingArtworkLink(trackId: string) {
  const artwork = document.createElement("a");
  artwork.className = "player__art-link";
  artwork.dataset.codaTrackId = trackId;
  artwork.href = "#/now-playing";
  artwork.tabIndex = 0;
  artwork.textContent = "Open Now Playing";
  return artwork;
}

function discoverReleaseCard(releaseId: string, title: string) {
  const card = document.createElement("article");
  card.dataset.discoverReleaseCard = releaseId;
  const artworkLink = document.createElement("a");
  artworkLink.href = `/discover/releases/${encodeURIComponent(releaseId)}`;
  artworkLink.dataset.codaDiscoverArtwork = releaseId;
  artworkLink.textContent = `${title} artwork`;
  const titleLink = document.createElement("a");
  titleLink.href = `/discover/releases/${encodeURIComponent(releaseId)}`;
  const titleText = document.createElement("span");
  titleText.dataset.codaDiscoverTitle = releaseId;
  titleText.textContent = title;
  titleLink.append(titleText);
  card.append(artworkLink, titleLink);
  return { artworkLink, card, titleLink, titleText };
}

afterEach(() => {
  resetDetailNavigation();
  document.body.replaceChildren();
});

describe("detailNavigation module", () => {
  it("routes every descriptor kind through one lifecycle", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const kinds: CodaViewTransitionKind[] = [];
    try {
      for (const kind of DETAIL_TRANSITION_KINDS) {
        const identity = `${kind}-identity`;
        const sourceTrigger = document.createElement("button");
        const shared = document.createElement("span");
        sourceTrigger.append(shared);
        if (kind === "discover-release") {
          sourceTrigger.dataset.navigationSlot = "discover-artwork";
        }
        document.body.append(sourceTrigger);
        const targetKey = `${kind}:${identity}`;
        await openDetail({
          kind,
          source: {
            identity,
            sharedIdentityAvailable: true,
            sourceTrigger,
            targets: { owner: sourceTrigger, secondary: shared, shared },
          },
          targetKey,
          update: () => ({ locationKey: targetKey, outcome: "rendered" }),
        });
        const heading = document.createElement("h1");
        heading.id = DETAIL_TRANSITION_DESCRIPTORS[kind].destinationHeadingId;
        heading.tabIndex = -1;
        document.body.append(heading);
        activateDetailDestination(kind, targetKey);
        expect(heading).toHaveFocus();
        await closeDetail({
          identity,
          kind,
          restoreFocus: false,
          targetKey,
          update: () => ({
            locationKey: `${kind}-return`,
            outcome: "rendered",
          }),
        });
      }
      kinds.push(
        ...harness.transitions
          .map((transition) => transition.kind)
          .filter((kind): kind is CodaViewTransitionKind => Boolean(kind)),
      );
    } finally {
      harness.restore();
    }

    expect(kinds).toEqual(
      Object.values(DETAIL_TRANSITION_DESCRIPTORS).flatMap((descriptor) => [
        descriptor.openKind,
        descriptor.closeKind,
      ]),
    );
  });

  it("keeps source markers until a newer navigation restores them", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: false });
    const playlistId = "playlist-1";
    const source = playlistTrigger(playlistId);
    const scrollRoot = document.createElement("main");
    scrollRoot.dataset.codaLibraryScroll = "";
    source.trigger.style.setProperty("content-visibility", "auto");
    scrollRoot.append(source.trigger);
    document.body.append(scrollRoot);
    try {
      const opening = openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "playlist-open",
          outcome: "rendered",
        }),
      });
      await vi.waitFor(() =>
        expect(source.identity).toHaveAttribute(
          "data-coda-playlist-identity-source",
          playlistId,
        ),
      );
      await vi.waitFor(() => expect(detailReturnStateCount()).toBe(1));

      const closing = closeDetail({
        identity: playlistId,
        kind: "playlist",
        requestKey: "playlist-open",
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "playlist-return",
          outcome: "rendered",
        }),
      });
      await vi.waitFor(() =>
        expect(source.identity).toHaveAttribute(
          "data-coda-playlist-identity-return",
          playlistId,
        ),
      );
      expect(source.identity).not.toHaveAttribute(
        "data-coda-playlist-identity-source",
      );

      harness.transitions[0]?.resolve();
      await opening;
      harness.transitions[1]?.resolve();
      await closing;
      expect(source.identity).not.toHaveAttribute(
        "data-coda-playlist-identity-return",
      );
      expect(source.trigger).toHaveFocus();
    } finally {
      harness.restore();
    }
  });

  it("keeps the latest source markers when an older open settles first", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: false });
    const playlistId = "playlist-1";
    const source = playlistTrigger(playlistId);
    document.body.append(source.trigger);
    try {
      const first = openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "playlist-first",
          outcome: "rendered",
        }),
      });
      const second = openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "playlist-second",
          outcome: "rendered",
        }),
      });
      expect(source.identity).toHaveAttribute(
        "data-coda-playlist-identity-source",
        playlistId,
      );

      harness.transitions[0]?.resolve();
      await first;
      expect(source.identity).toHaveAttribute(
        "data-coda-playlist-identity-source",
        playlistId,
      );

      harness.transitions[1]?.resolve();
      await second;
      expect(source.identity).not.toHaveAttribute(
        "data-coda-playlist-identity-source",
      );
    } finally {
      harness.restore();
    }
  });

  it("does not retain return state after a failed open", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const playlistId = "playlist-failed";
    const source = playlistTrigger(playlistId);
    document.body.append(source.trigger);
    const before = detailReturnStateCount();
    try {
      await openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "failed-open",
          outcome: "failed",
        }),
      });
      expect(detailReturnStateCount()).toBe(before);
      expect(source.identity).not.toHaveAttribute(
        "data-coda-playlist-identity-source",
      );

      const closeUpdates: boolean[] = [];
      await closeDetail({
        identity: playlistId,
        kind: "playlist",
        targetKey: `playlist:${playlistId}`,
        update: (hasReturnState) => {
          closeUpdates.push(hasReturnState);
          return { locationKey: "failed-open-close", outcome: "rendered" };
        },
      });
      expect(closeUpdates).toEqual([false]);
    } finally {
      harness.restore();
    }
  });

  it("restores compact-player Discover focus after React drops the return slot", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const releaseId = "discover:blue-hours";
    const playerAlbumLink = document.createElement("a");
    playerAlbumLink.href = `/discover/releases/${encodeURIComponent(releaseId)}`;
    playerAlbumLink.dataset.playerAlbumLink = "";
    playerAlbumLink.textContent = "Blue Hours";
    document.body.append(playerAlbumLink);
    try {
      await openDetail({
        kind: "discover-release",
        source: prepareDetailSource(
          "discover-release",
          releaseId,
          true,
          playerAlbumLink,
        ),
        targetKey: `discover-release:${releaseId}`,
        update: () => ({
          locationKey: "discover-detail",
          outcome: "rendered",
        }),
      });
      playerAlbumLink.removeAttribute("data-navigation-slot");
      expect(playerAlbumLink.dataset.navigationSlot).toBeUndefined();

      await closeDetail({
        identity: releaseId,
        kind: "discover-release",
        requestKey: "discover-detail",
        targetKey: `discover-release:${releaseId}`,
        update: () => ({
          locationKey: "discover-player-return",
          outcome: "rendered",
        }),
      });
      expect(playerAlbumLink).toHaveFocus();
    } finally {
      harness.restore();
    }
  });

  it("returns Discover title focus to the opened release, not the first stale title slot", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: false });
    const staleRelease = discoverReleaseCard(
      "discover:amber-drift",
      "Amber Drift",
    );
    const openedRelease = discoverReleaseCard(
      "discover:blue-hours",
      "Blue Hours",
    );
    // A previously visited card keeps its assigned slot attribute.
    staleRelease.titleLink.dataset.navigationSlot = "discover-title";
    document.body.append(staleRelease.card, openedRelease.card);
    try {
      const opening = openDetail({
        kind: "discover-release",
        source: prepareDetailSource(
          "discover-release",
          "discover:blue-hours",
          true,
          openedRelease.titleLink,
        ),
        targetKey: "discover-release:discover:blue-hours",
        update: () => ({
          locationKey: "discover-detail",
          outcome: "rendered",
        }),
      });
      expect(openedRelease.titleLink.dataset.navigationSlot).toBe(
        "discover-title",
      );
      await vi.waitFor(() => expect(harness.transitions.length).toBe(1));
      harness.transitions[0]?.resolve();
      await opening;

      const closing = closeDetail({
        identity: "discover:blue-hours",
        kind: "discover-release",
        requestKey: "discover-detail",
        targetKey: "discover-release:discover:blue-hours",
        update: () => ({
          locationKey: "discover-title-return",
          outcome: "rendered",
        }),
      });
      await vi.waitFor(() =>
        expect(openedRelease.artworkLink).toHaveAttribute(
          "data-coda-discover-artwork-return",
          "discover:blue-hours",
        ),
      );
      expect(staleRelease.artworkLink).not.toHaveAttribute(
        "data-coda-discover-artwork-return",
      );
      harness.transitions[1]?.resolve();
      await closing;
      expect(openedRelease.titleLink).toHaveFocus();
    } finally {
      harness.restore();
    }
  });

  it("abandons virtual return polling when the transition is no longer current", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: false });
    const findCalls = vi.fn(() => undefined);
    try {
      const closing = closeDetail({
        identity: "gone",
        kind: "playlist",
        targetKey: "playlist:gone",
        update: () => ({
          locationKey: "abandoned-close",
          outcome: "rendered",
        }),
      });
      resetDetailNavigation();
      harness.transitions[0]?.resolve();
      await closing;
      expect(findCalls).not.toHaveBeenCalled();
    } finally {
      harness.restore();
    }
  });

  it("does not record phantom return state when an identified open times out", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const playlistId = "playlist-timeout";
    const source = playlistTrigger(playlistId);
    document.body.append(source.trigger);
    const before = detailReturnStateCount();
    try {
      await openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "timeout-open",
          outcome: "timeout",
        }),
      });
      expect(detailReturnStateCount()).toBe(before);

      const closeUpdates: boolean[] = [];
      await closeDetail({
        identity: playlistId,
        kind: "playlist",
        targetKey: `playlist:${playlistId}`,
        update: (hasReturnState) => {
          closeUpdates.push(hasReturnState);
          return { locationKey: "timeout-close", outcome: "rendered" };
        },
      });
      expect(closeUpdates).toEqual([false]);
    } finally {
      harness.restore();
    }
  });

  it("preserves return state after a failed close so retry can restore", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const playlistId = "playlist-retry";
    const source = playlistTrigger(playlistId);
    document.body.append(source.trigger);
    try {
      await openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "retry-open",
          outcome: "rendered",
        }),
      });
      expect(detailReturnStateCount()).toBe(1);

      const firstClose = await closeDetail({
        identity: playlistId,
        kind: "playlist",
        requestKey: "retry-open",
        restoreFocus: false,
        targetKey: `playlist:${playlistId}`,
        update: () => ({ locationKey: "retry-close", outcome: "failed" }),
      });
      expect(firstClose).toBe("failed");
      expect(detailReturnStateCount()).toBe(1);

      const secondClose = await closeDetail({
        identity: playlistId,
        kind: "playlist",
        requestKey: "retry-open",
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "retry-close-success",
          outcome: "rendered",
        }),
      });
      expect(secondClose).toBe("rendered");
      expect(detailReturnStateCount()).toBe(0);
      expect(source.trigger).toHaveFocus();
    } finally {
      harness.restore();
    }
  });

  it("refocuses a destination heading after route cleanup", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const heading = document.createElement("h1");
    heading.id = DETAIL_TRANSITION_DESCRIPTORS.album.destinationHeadingId;
    heading.tabIndex = -1;
    document.body.append(heading);
    try {
      activateDetailDestination("album", "album:album-1");
      expect(heading).toHaveFocus();
      heading.blur();
      activateDetailDestination("album", "album:album-1");
      expect(heading).not.toHaveFocus();
      clearDestinationFocus();
      activateDetailDestination("album", "album:album-1");
      expect(heading).toHaveFocus();
    } finally {
      harness.restore();
    }
  });

  it("cancels destination heading focus when a close starts", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const playlistId = "playlist-focus-cancel";
    const source = playlistTrigger(playlistId);
    document.body.append(source.trigger);
    try {
      await openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "focus-cancel",
          outcome: "rendered",
        }),
      });
      activateDetailDestination("playlist", `playlist:${playlistId}`);
      const heading = document.createElement("h1");
      heading.id = DETAIL_TRANSITION_DESCRIPTORS.playlist.destinationHeadingId;
      heading.tabIndex = -1;
      document.body.append(heading);

      await closeDetail({
        identity: playlistId,
        kind: "playlist",
        requestKey: "focus-cancel",
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "focus-cancel-close",
          outcome: "rendered",
        }),
      });

      expect(heading).not.toHaveFocus();
      expect(source.trigger).toHaveFocus();
    } finally {
      harness.restore();
    }
  });

  it("does not consume return state when a close is cancelled", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const playlistId = "playlist-cancel-open";
    const source = playlistTrigger(playlistId);
    document.body.append(source.trigger);
    try {
      await openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "cancel-open",
          outcome: "rendered",
        }),
      });
      expect(detailReturnStateCount()).toBe(1);

      const closing = closeDetail({
        identity: playlistId,
        kind: "playlist",
        requestKey: "cancel-open",
        restoreFocus: false,
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "cancel-close",
          outcome: "rendered",
        }),
      });
      await cancelDetailNavigation();
      await closing;
      expect(detailReturnStateCount()).toBe(1);
    } finally {
      harness.restore();
    }
  });

  it("restores Now Playing Back onto live compact artwork after the track advances", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: true });
    const artwork = nowPlayingArtworkLink("track-1");
    const albumLink = document.createElement("a");
    albumLink.dataset.playerAlbumLink = "";
    albumLink.href = "#/album";
    albumLink.tabIndex = 0;
    albumLink.textContent = "Album";
    const heading = document.createElement("h1");
    heading.id = "now-playing-heading";
    heading.tabIndex = -1;
    heading.textContent = "Now Playing";
    document.body.append(artwork, albumLink, heading);
    try {
      await openDetail({
        kind: "now-playing",
        source: prepareDetailSource("now-playing", "track-1", true),
        targetKey: "now-playing",
        update: () => ({
          locationKey: "now-playing-open",
          outcome: "rendered",
        }),
      });
      artwork.dataset.codaTrackId = "track-2";

      await closeDetail({
        identity: "now-playing",
        kind: "now-playing",
        requestKey: "now-playing-open",
        targetKey: "now-playing",
        update: () => ({
          locationKey: "now-playing-return",
          outcome: "rendered",
        }),
      });

      expect(artwork).toHaveFocus();
      expect(heading).not.toHaveFocus();
      expect(albumLink).not.toHaveFocus();
    } finally {
      harness.restore();
    }
  });

  it("reasserts reverse focus after the view transition finishes", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: false });
    const playlistId = "playlist-reassert";
    const source = playlistTrigger(playlistId);
    document.body.append(source.trigger);
    try {
      const opening = openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "reassert-open",
          outcome: "rendered",
        }),
      });
      await vi.waitFor(() => expect(harness.transitions[0]).toBeDefined());
      harness.transitions[0]?.resolve();
      await opening;

      const closing = closeDetail({
        identity: playlistId,
        kind: "playlist",
        requestKey: "reassert-open",
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "reassert-close",
          outcome: "rendered",
        }),
      });
      await vi.waitFor(() => expect(source.trigger).toHaveFocus());
      document.body.tabIndex = -1;
      document.body.focus();
      expect(document.body).toHaveFocus();
      harness.transitions[1]?.resolve();
      await closing;

      expect(source.trigger).toHaveFocus();
    } finally {
      document.body.removeAttribute("tabindex");
      harness.restore();
    }
  });

  it("does not steal a user focus change during the view transition", async () => {
    const harness = installDocumentViewTransitionHarness({ autoFinish: false });
    const playlistId = "playlist-keep-focus";
    const source = playlistTrigger(playlistId);
    const sentinel = document.createElement("button");
    sentinel.textContent = "Other";
    document.body.append(source.trigger, sentinel);
    try {
      const opening = openDetail({
        kind: "playlist",
        source: prepareDetailSource(
          "playlist",
          playlistId,
          true,
          source.trigger,
        ),
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "keep-focus-open",
          outcome: "rendered",
        }),
      });
      await vi.waitFor(() => expect(harness.transitions[0]).toBeDefined());
      harness.transitions[0]?.resolve();
      await opening;

      const closing = closeDetail({
        identity: playlistId,
        kind: "playlist",
        requestKey: "keep-focus-open",
        targetKey: `playlist:${playlistId}`,
        update: () => ({
          locationKey: "keep-focus-close",
          outcome: "rendered",
        }),
      });
      await vi.waitFor(() => expect(source.trigger).toHaveFocus());
      sentinel.focus();
      expect(sentinel).toHaveFocus();
      harness.transitions[1]?.resolve();
      await closing;

      expect(sentinel).toHaveFocus();
    } finally {
      harness.restore();
    }
  });
});
