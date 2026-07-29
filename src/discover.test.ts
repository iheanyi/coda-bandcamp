import { describe, expect, it } from "vitest";
import { discoverArtistUrl, discoverPreviewTrack } from "./discover";
import type { DiscoverRelease } from "./types";

const release: DiscoverRelease = {
  id: "discover:release-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours?from=discover",
  featuredTrack: {
    id: "discover:preview-1",
    title: "Glass Lines",
    duration: 201,
    streamUrl: "https://t4.bcbits.com/stream/blue-hours",
  },
};

describe("Discover navigation metadata", () => {
  it("keeps the validated release attached to its ephemeral preview", () => {
    expect(discoverPreviewTrack(release)).toEqual(expect.objectContaining({
      id: "discover:preview-1",
      albumId: "discover:release-1",
      discoverRelease: release,
    }));
  });

  it("derives only an artist Bandcamp origin from a release URL", () => {
    expect(discoverArtistUrl(release))
      .toBe("https://signal-garden.bandcamp.com/");
    expect(discoverArtistUrl({
      ...release,
      itemUrl: "https://bandcamp.com/album/blue-hours",
    })).toBeUndefined();
    expect(discoverArtistUrl({
      ...release,
      itemUrl: "https://example.com/album/blue-hours",
    })).toBeUndefined();
  });
});
