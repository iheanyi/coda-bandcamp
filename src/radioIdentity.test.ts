import { describe, expect, it } from "vitest";

import type { RadioShow, RadioShowSummary } from "@/types";

import { BANDCAMP_RADIO_PROVIDER, radioShowIdentity } from "./radioIdentity";
import { radioTrackFromShow } from "./radioTrack";

const summary: RadioShowSummary = {
  id: 981,
  subtitle: "MADLIFE",
  description: "12k Gotti joins The Hip Hop Show.",
  publishedAt: "07 Aug 2026 00:00:00 GMT",
};

const show: RadioShow = {
  ...summary,
  title: "The Hip Hop Show",
  duration: 6_030,
  streamUrl: "https://bandcamp.com/stream_redirect?enc=mp3-128",
  chapters: [],
};

describe("Bandcamp Radio identity", () => {
  it("keeps provider, series, and episode labels distinct", () => {
    expect(radioShowIdentity(summary)).toEqual({
      provider: BANDCAMP_RADIO_PROVIDER,
      episodeTitle: "MADLIFE",
      seriesTitle: "The Hip Hop Show",
    });
    expect(radioShowIdentity(show)).toEqual({
      provider: BANDCAMP_RADIO_PROVIDER,
      episodeTitle: "MADLIFE",
      seriesTitle: "The Hip Hop Show",
    });
  });

  it("projects a Radio episode into playback metadata consistently", () => {
    expect(radioTrackFromShow(show)).toEqual(
      expect.objectContaining({
        id: "radio:981",
        title: "MADLIFE",
        artist: BANDCAMP_RADIO_PROVIDER,
        album: "The Hip Hop Show",
      }),
    );
  });
});
