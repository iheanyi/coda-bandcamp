import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchRadioShow,
  fetchRadioShows,
  parseRadioShow,
  parseRadioShowsPage,
} from "./radio";

const series = {
  id: 1,
  title: "Bandcamp Weekly",
  slug: "bandcamp-weekly",
};

const showSummary = {
  id: 979,
  subtitle: "The Coda Broadcast",
  description: "Guest mix.",
  publishedAt: "2026-08-01T00:00:00Z",
  artworkUrl: "https://f4.bcbits.com/img/a1.jpg",
  series,
};

const radioShow = {
  ...showSummary,
  title: "Bandcamp Weekly",
  duration: 3_600,
  streamUrl: "https://t4.bcbits.com/stream/radio/mp3-128",
  chapters: [{
    title: "Afterimage",
    artist: "Night Archive",
    album: "Soft Focus",
    timecode: 60,
    itemUrl: "https://nightarchive.bandcamp.com/track/afterimage",
    artistUrl: "https://nightarchive.bandcamp.com",
    albumUrl: "https://nightarchive.bandcamp.com/album/soft-focus",
    artworkUrl: "https://f4.bcbits.com/img/a2.jpg",
  }],
};

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("Radio native decoders", () => {
  it("decodes a bounded archive page and optional series artwork", () => {
    expect(parseRadioShowsPage({
      results: [showSummary],
      hasMore: true,
      cursor: "next-page",
    }, "radio_shows")).toEqual({
      results: [showSummary],
      hasMore: true,
      cursor: "next-page",
    });
  });

  it("decodes a show with chapters and verified Bandcamp media URLs", () => {
    expect(parseRadioShow(radioShow, "radio_show")).toEqual(radioShow);
  });

  it("rejects untrusted streams, oversized archives, and out-of-range ids", () => {
    expect(() => parseRadioShow({
      ...radioShow,
      streamUrl: "https://example.com/show.mp3",
    }, "radio_show")).toThrow("verified Bandcamp HTTPS URL");
    expect(() => parseRadioShowsPage({
      results: Array.from({ length: 1_001 }, () => showSummary),
      hasMore: false,
    }, "radio_shows")).toThrow("at most 1000 entries");
    expect(() => parseRadioShow({
      ...radioShow,
      id: 1_000_001,
    }, "radio_show")).toThrow("an integer from 1 through 1000000");
    expect(() => parseRadioShow({
      ...radioShow,
      chapters: Array.from({ length: 257 }, () => radioShow.chapters[0]),
    }, "radio_show")).toThrow("at most 256 entries");
    expect(() => parseRadioShow({
      ...radioShow,
      duration: 24 * 60 * 60 + 1,
    }, "radio_show")).toThrow("an integer from 0 through 86400");
  });

  it("rejects inherited archive records instead of reading the prototype chain", () => {
    expect(() =>
      parseRadioShowsPage(Object.create({
        results: [showSummary],
        hasMore: false,
      }), "radio_shows")
    ).toThrow("Invalid native response for radio_shows");
  });
});

describe("Radio native commands", () => {
  it("is available only in the desktop app", async () => {
    await expect(fetchRadioShows()).rejects.toThrow(
      "Bandcamp Radio is available in the Coda desktop app.",
    );
    await expect(fetchRadioShow(979)).rejects.toThrow(
      "Bandcamp Radio is available in the Coda desktop app.",
    );
  });

  it("invokes fixed commands and decodes the native payload", async () => {
    const invocations: Array<{
      command: string;
      payload: InvokeArgs | undefined;
    }> = [];
    mockIPC((command, payload) => {
      invocations.push({ command, payload });
      if (command === "radio_shows") {
        return { results: [showSummary], hasMore: false };
      }
      if (command === "radio_show") return radioShow;
      throw new Error(`Unexpected native command: ${command}`);
    });

    await expect(fetchRadioShows({ seriesId: 1, cursor: "next" })).resolves
      .toEqual({
        results: [showSummary],
        hasMore: false,
      });
    await expect(fetchRadioShow(979)).resolves.toEqual(radioShow);
    expect(invocations).toEqual([
      {
        command: "radio_shows",
        payload: { seriesId: 1, cursor: "next" },
      },
      { command: "radio_show", payload: { showId: 979 } },
    ]);
  });
});
