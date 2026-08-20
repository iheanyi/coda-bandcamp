import { describe, expect, it } from "vitest";

import {
  bandcampArtistOrigin,
  parseVerifiedBandcampPageUrl,
} from "./bandcampUrl";

describe("verified Bandcamp page URLs", () => {
  it("accepts HTTPS Bandcamp hosts without credentials", () => {
    expect(
      parseVerifiedBandcampPageUrl(
        "https://nightarchive.bandcamp.com/album/soft-focus",
      )?.toString(),
    ).toBe("https://nightarchive.bandcamp.com/album/soft-focus");
    expect(
      parseVerifiedBandcampPageUrl("https://bandcamp.com/album/soft-focus")
        ?.hostname,
    ).toBe("bandcamp.com");
  });

  it("rejects non-Bandcamp hosts, credentials, and invalid URLs", () => {
    expect(
      parseVerifiedBandcampPageUrl("https://example.com/album"),
    ).toBeUndefined();
    expect(
      parseVerifiedBandcampPageUrl(
        "https://token@nightarchive.bandcamp.com/album/soft-focus",
      ),
    ).toBeUndefined();
    expect(parseVerifiedBandcampPageUrl("not a url")).toBeUndefined();
  });

  it("derives only artist subdomain origins", () => {
    expect(
      bandcampArtistOrigin(
        "https://signal-garden.bandcamp.com/album/blue-hours?from=discover",
      ),
    ).toBe("https://signal-garden.bandcamp.com/");
    expect(
      bandcampArtistOrigin("https://bandcamp.com/album/blue-hours"),
    ).toBeUndefined();
  });
});
