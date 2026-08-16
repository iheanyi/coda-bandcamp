import { describe, expect, it } from "vitest";

import {
  ALL_CODA_VIEW_TRANSITION_KINDS,
  DETAIL_TRANSITION_DESCRIPTORS,
  codaViewTransitionClass,
  resolveDetailTransition,
} from "./detailTransitionDescriptors";

describe("detail transition descriptors", () => {
  it("keeps every native detail lifecycle registered", () => {
    expect(ALL_CODA_VIEW_TRANSITION_KINDS).toEqual([
      "album-detail",
      "album-detail-close",
      "artist-detail",
      "artist-detail-close",
      "daily-detail",
      "daily-detail-close",
      "discover-detail",
      "discover-detail-close",
      "playlist-detail",
      "playlist-detail-close",
      "radio-detail",
      "radio-detail-close",
      "now-playing-open",
      "now-playing-close",
      "page-forward",
      "page-back",
      "page-crossfade",
    ]);
  });

  it("owns every coordinator route and focus destination", () => {
    expect(
      Object.fromEntries(
        Object.entries(DETAIL_TRANSITION_DESCRIPTORS).map(
          ([kind, descriptor]) => [
            kind,
            {
              destinationHeadingId: descriptor.destinationHeadingId,
              routeKey: descriptor.routeKey,
              sharedElementOwner: descriptor.sharedElementOwner,
            },
          ],
        ),
      ),
    ).toEqual({
      album: {
        destinationHeadingId: "album-detail-heading",
        routeKey: "album-detail",
        sharedElementOwner: "coda-album-artwork",
      },
      artist: {
        destinationHeadingId: "artist-detail-heading",
        routeKey: "artist-detail",
        sharedElementOwner: "coda-artist-artwork",
      },
      daily: {
        destinationHeadingId: "daily-article-heading",
        routeKey: "daily-detail",
        sharedElementOwner: "coda-daily-artwork",
      },
      "discover-release": {
        destinationHeadingId: "discover-release-heading",
        routeKey: "discover-detail",
        sharedElementOwner: "coda-discover-artwork",
      },
      playlist: {
        destinationHeadingId: "playlist-detail-heading",
        routeKey: "playlist-detail",
        sharedElementOwner: "coda-playlist-identity",
      },
      radio: {
        destinationHeadingId: "radio-detail-title",
        routeKey: "radio-detail",
        sharedElementOwner: "coda-radio-artwork",
      },
      "now-playing": {
        destinationHeadingId: "now-playing-heading",
        routeKey: "now-playing-detail",
        sharedElementOwner: "coda-now-playing-artwork",
      },
    });
  });

  it.each(Object.entries(DETAIL_TRANSITION_DESCRIPTORS))(
    "derives symmetric shared-element metadata for %s",
    (_detailKind, descriptor) => {
      const open = resolveDetailTransition(descriptor.openKind);
      const close = resolveDetailTransition(descriptor.closeKind);

      expect(open).toEqual({
        className: descriptor.openClassName,
        destinationSelectors: descriptor.detailSelectors,
        direction: "open",
        kind: descriptor.openKind,
        sharedOwner: descriptor.sharedElementOwner,
        sourceSelectors: descriptor.sourceSelectors,
        transitionNames: descriptor.transitionNames,
      });
      expect(close).toEqual({
        className: descriptor.closeClassName,
        destinationSelectors: descriptor.returnSelectors,
        direction: "close",
        kind: descriptor.closeKind,
        sharedOwner: descriptor.sharedElementOwner,
        sourceSelectors: descriptor.detailSelectors,
        transitionNames: descriptor.transitionNames,
      });
      expect(descriptor.openClassName).toBe(
        codaViewTransitionClass(descriptor.openKind),
      );
      expect(descriptor.closeClassName).toBe(
        codaViewTransitionClass(descriptor.closeKind),
      );
      expect(open?.destinationSelectors).toBe(close?.sourceSelectors);
    },
  );

  it("derives temporary endpoint selectors from canonical marker definitions", () => {
    for (const descriptor of Object.values(DETAIL_TRANSITION_DESCRIPTORS)) {
      const sourceSharedMarker =
        "shared" in descriptor.markerEndpoints.source
          ? descriptor.markerEndpoints.source.shared
          : undefined;
      const returnSharedMarker =
        "shared" in descriptor.markerEndpoints.return
          ? descriptor.markerEndpoints.return.shared
          : undefined;

      if (sourceSharedMarker) {
        expect(descriptor.sourceSelectors).toEqual([
          sourceSharedMarker.selector,
        ]);
      }
      if (returnSharedMarker) {
        expect(descriptor.returnSelectors).toEqual([
          returnSharedMarker.selector,
        ]);
      }
    }
  });

  it("owns route-specific DOM identity without duplicating transition markers", () => {
    expect(DETAIL_TRANSITION_DESCRIPTORS.daily.domIdentity).toEqual({
      ownerSelector: "article",
      secondary: {
        identityAttribute: "data-daily-article-title",
        selector: "[data-daily-article-title]",
      },
      shared: {
        identityAttribute: "data-daily-article-artwork",
        selector: "[data-daily-article-artwork]",
      },
      trigger: {
        identityAttribute: "data-daily-article-open",
        selector: "[data-daily-article-open]",
      },
    });
    expect(DETAIL_TRANSITION_DESCRIPTORS.radio.domIdentity).toEqual({
      ownerSelector: "article",
      secondary: {
        identityAttribute: "data-radio-show-title",
        selector: "[data-radio-show-title]",
        targetSelector:
          ':is([data-slot="overflow-marquee-text"], [data-coda-radio-title-text])',
      },
      shared: {
        identityAttribute: "data-radio-show-artwork",
        selector: "[data-radio-show-artwork]",
      },
      trigger: {
        identityAttribute: "data-radio-show-open",
        selector: "[data-radio-show-open]",
        slotAttribute: "data-radio-show-navigation-slot",
      },
    });
    expect(DETAIL_TRANSITION_DESCRIPTORS.playlist.domIdentity).toEqual({
      secondary: {
        identityAttribute: "data-playlist-title",
        selector: "[data-playlist-title]",
        targetSelector: '[data-slot="overflow-marquee-text"]',
      },
      shared: {
        identityAttribute: "data-playlist-identity",
        selector: "[data-playlist-identity]",
      },
      trigger: {
        identityAttribute: "data-playlist-open",
        selector: "[data-playlist-open]",
      },
    });
    expect(DETAIL_TRANSITION_DESCRIPTORS.album.domIdentity).toEqual({
      ownerIdentityAttribute: "data-album-card",
      ownerSelector: "[data-album-card]",
      secondary: {
        identityAttribute: "data-coda-album-title-target",
        selector: "[data-coda-album-title-target]",
        targetSelector: '[data-slot="overflow-marquee-text"]',
      },
      shared: {
        fromOwner: true,
        selector: "[data-slot=cover]",
      },
      trigger: {
        identityAttribute: "data-album-open",
        selector: "a[data-album-open]",
        slotAttribute: "data-navigation-slot",
      },
    });
    expect(DETAIL_TRANSITION_DESCRIPTORS.artist.domIdentity).toEqual({
      ownerSelector:
        ":is([data-coda-artist-card], [data-album-card], [data-coda-album-detail-surface])",
      secondary: {
        identityAttribute: "data-coda-artist-name-target",
        selector: "[data-coda-artist-name-target]",
        targetSelector: '[data-slot="overflow-marquee-text"]',
      },
      shared: {
        fromOwner: true,
        selector: "[data-slot=cover]",
      },
      trigger: {
        identityAttribute: "data-artist-open",
        selector: "[data-artist-open]",
        slotAttribute: "data-navigation-slot",
      },
    });
    expect(DETAIL_TRANSITION_DESCRIPTORS["discover-release"].domIdentity).toEqual(
      {
        ownerIdentityAttribute: "data-discover-release-card",
        ownerSelector: "[data-discover-release-card]",
        secondary: {
          identityAttribute: "data-coda-discover-title",
          selector: "[data-coda-discover-title]",
        },
        shared: {
          identityAttribute: "data-coda-discover-artwork",
          selector: "[data-coda-discover-artwork]",
        },
        trigger: {
          identityAttribute: "data-coda-discover-artwork",
          selector: "[data-coda-discover-artwork]",
          slotAttribute: "data-navigation-slot",
        },
      },
    );
    expect(DETAIL_TRANSITION_DESCRIPTORS["now-playing"].domIdentity).toEqual({
      shared: {
        identityAttribute: "data-coda-track-id",
        selector: "[data-coda-track-id]",
      },
      trigger: {
        identityAttribute: "data-coda-track-id",
        selector: ".player__art-link[data-coda-track-id]",
      },
    });
  });

  it("models heading-focus fallback and discover return slots as present or absent", () => {
    expect(
      DETAIL_TRANSITION_DESCRIPTORS["discover-release"].returnFocusFallsBackToHeading,
    ).toBe(true);
    expect(
      DETAIL_TRANSITION_DESCRIPTORS["now-playing"].returnFocusFallsBackToHeading,
    ).toBe(true);
    expect(
      DETAIL_TRANSITION_DESCRIPTORS["discover-release"].sharedReturnSlots,
    ).toEqual(["discover-artwork", "discover-title"]);
    expect(
      Object.entries(DETAIL_TRANSITION_DESCRIPTORS).flatMap(([kind, descriptor]) =>
        "returnFocusFallsBackToHeading" in descriptor ? [kind] : [],
      ),
    ).toEqual(["discover-release", "now-playing"]);
    expect(
      Object.entries(DETAIL_TRANSITION_DESCRIPTORS).flatMap(([kind, descriptor]) =>
        "sharedReturnSlots" in descriptor ? [kind] : [],
      ),
    ).toEqual(["discover-release"]);
  });
});
