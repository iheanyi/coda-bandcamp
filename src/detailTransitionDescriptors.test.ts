import { afterEach, describe, expect, it } from "vitest";

import {
  getDetailTransitionDescriptor,
  resolveDetailTransition,
  type DetailTransitionKind,
} from "./detailTransitionDescriptors";

const detailKinds: readonly DetailTransitionKind[] = [
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
];

afterEach(() => document.body.replaceChildren());

describe("detail transition descriptors", () => {
  it("defines every registry-owned detail direction", () => {
    expect(
      detailKinds.map((kind) => getDetailTransitionDescriptor(kind)?.kind),
    ).toEqual(detailKinds);
    expect(getDetailTransitionDescriptor("album-detail")).toBeUndefined();
    expect(getDetailTransitionDescriptor("now-playing-open")).toBeUndefined();
  });

  it("uses the artist title as the shared diagnostic fallback", () => {
    const title = document.createElement("span");
    title.dataset.codaArtistNameSource = "artist-1";
    document.body.append(title);

    expect(resolveDetailTransition("artist-detail")).toMatchObject({
      diagnosticSource: title,
      diagnosticSourceCount: 1,
      snapshotDestinations: ["[data-coda-artist-name-detail]"],
    });
  });

  it("binds return destinations to the exact source identity", () => {
    const artwork = document.createElement("div");
    artwork.dataset.codaDiscoverArtworkDetail = 'release"one';
    document.body.append(artwork);

    expect(
      resolveDetailTransition("discover-detail-close")?.sharedDestination,
    ).toBe('[data-coda-discover-artwork-return="release\\"one"]');
  });
});
