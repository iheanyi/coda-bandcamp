import { describe, expect, it } from "vitest";

import {
  DETAIL_TRANSITION_DESCRIPTORS,
  codaViewTransitionClass,
  resolveDetailTransition,
} from "./detailTransitionDescriptors";

describe("detail transition descriptors", () => {
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

  it("expects only album artwork on close while the queue drawer is open", () => {
    const workspace = document.createElement("div");
    workspace.dataset.slot = "app-shell-workspace";
    workspace.dataset.queueOpen = "true";
    document.body.append(workspace);

    try {
      const album = DETAIL_TRANSITION_DESCRIPTORS.album;
      expect(resolveDetailTransition(album.closeKind)?.transitionNames).toEqual(
        [album.sharedElementOwner],
      );
      expect(resolveDetailTransition(album.openKind)?.transitionNames).toEqual(
        album.transitionNames,
      );
      expect(
        resolveDetailTransition(DETAIL_TRANSITION_DESCRIPTORS.artist.closeKind)
          ?.transitionNames,
      ).toEqual(DETAIL_TRANSITION_DESCRIPTORS.artist.transitionNames);

      workspace.dataset.queueOpen = "false";
      expect(resolveDetailTransition(album.closeKind)?.transitionNames).toEqual(
        album.transitionNames,
      );
      expect(
        Object.entries(DETAIL_TRANSITION_DESCRIPTORS).flatMap(
          ([kind, descriptor]) =>
            "closeOmitsSurfaceWhenQueueOpen" in descriptor ? [kind] : [],
        ),
      ).toEqual(["album"]);
    } finally {
      workspace.remove();
    }
  });

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
});
