import { describe, expect, it } from "vitest";
import { parseDiscoverReleaseIdParam } from "@/routing/routeContracts";
import type { DiscoverPage, DiscoverRelease } from "@/types";
import { resolveDiscoverReleaseFromCachePages } from "./discoverCache";

const release: DiscoverRelease = {
  id: "discover:release-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
  artworkUrl: "https://f4.bcbits.com/img/blue-hours.jpg",
  featuredTrack: {
    id: "discover:preview-1",
    title: "Glass Lines",
    duration: 201,
    streamUrl: "https://t4.bcbits.com/signed/blue-hours",
  },
};

function page(results: DiscoverRelease[]): DiscoverPage {
  return {
    results,
    resultCount: results.length,
    hasMore: false,
  };
}

describe("resolveDiscoverReleaseFromCachePages", () => {
  it("returns the existing cache reference for a validated release ID", () => {
    const releaseId = parseDiscoverReleaseIdParam(release.id);
    const result = resolveDiscoverReleaseFromCachePages(
      [page([]), page([release])],
      releaseId,
    );

    expect(result.status).toBe("found");
    if (result.status !== "found") throw new Error("Expected cached release");
    expect(result.release).toBe(release);
    expect(result.release.featuredTrack?.streamUrl).toBe(
      release.featuredTrack?.streamUrl,
    );
  });

  it("represents absent cache data and missing IDs explicitly", () => {
    const missingId = parseDiscoverReleaseIdParam("discover:missing");

    expect(resolveDiscoverReleaseFromCachePages(undefined, missingId)).toEqual({
      status: "missing",
    });
    expect(resolveDiscoverReleaseFromCachePages([page([release])], missingId))
      .toEqual({ status: "missing" });
  });

  it("stops at a bounded page budget instead of scanning unbounded cache data", () => {
    const target = { ...release, id: "discover:target" };
    const pages = Array.from({ length: 129 }, (_value, index) =>
      page(index === 128 ? [target] : []),
    );

    expect(
      resolveDiscoverReleaseFromCachePages(
        pages,
        parseDiscoverReleaseIdParam(target.id),
      ),
    ).toEqual({ status: "lookup-limit-reached" });
  });

  it("stops at a bounded release budget within a cache page", () => {
    const target = { ...release, id: "discover:target" };
    const other = { ...release, id: "discover:other" };
    const releases = [
      ...Array.from({ length: 5_120 }, () => other),
      target,
    ];

    expect(
      resolveDiscoverReleaseFromCachePages(
        [page(releases)],
        parseDiscoverReleaseIdParam(target.id),
      ),
    ).toEqual({ status: "lookup-limit-reached" });
  });
});
