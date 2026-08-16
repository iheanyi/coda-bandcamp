import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { fetchDiscover, parseDiscoverPage } from "./discover";

const release = {
  id: "discover:soft-focus",
  title: "Soft Focus",
  artist: "Night Archive",
  genre: "Electronic",
  location: "Brooklyn",
  itemUrl: "https://nightarchive.bandcamp.com/album/soft-focus",
  artworkUrl: "https://f4.bcbits.com/img/a1.jpg",
  featuredTrack: {
    id: "discover:track-1",
    title: "Afterimage",
    duration: 245,
    streamUrl: "https://t4.bcbits.com/stream/discover/mp3-128",
  },
};

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("Discover native decoders", () => {
  it("decodes a bounded page with optional featured-track media", () => {
    expect(parseDiscoverPage({
      results: [release],
      resultCount: 1,
      hasMore: true,
      cursor: "next-page",
    }, "discover")).toEqual({
      results: [release],
      resultCount: 1,
      hasMore: true,
      cursor: "next-page",
    });
  });

  it("rejects untrusted featured streams and oversized result lists", () => {
    expect(() => parseDiscoverPage({
      results: [{
        ...release,
        featuredTrack: {
          ...release.featuredTrack,
          streamUrl: "https://example.com/track.mp3",
        },
      }],
      resultCount: 1,
      hasMore: false,
    }, "discover")).toThrow("verified Bandcamp HTTPS URL");
    expect(() => parseDiscoverPage({
      results: Array.from({ length: 41 }, () => release),
      resultCount: 41,
      hasMore: false,
    }, "discover")).toThrow("at most 40 entries");
  });

  it("rejects inherited page records instead of reading the prototype chain", () => {
    expect(() =>
      parseDiscoverPage(Object.create({
        results: [release],
        resultCount: 1,
        hasMore: false,
      }), "discover")
    ).toThrow("Invalid native response for discover");
  });
});

describe("Discover native commands", () => {
  it("is available only in the desktop app", async () => {
    await expect(fetchDiscover({ tag: "jazz", sort: "top" })).rejects.toThrow(
      "Discover is available in the Coda desktop app.",
    );
  });

  it("invokes the fixed command and decodes the native payload", async () => {
    const invocations: Array<{
      command: string;
      payload: InvokeArgs | undefined;
    }> = [];
    mockIPC((command, payload) => {
      invocations.push({ command, payload });
      if (command === "discover") {
        return {
          results: [release],
          resultCount: 1,
          hasMore: false,
        };
      }
      throw new Error(`Unexpected native command: ${command}`);
    });

    await expect(fetchDiscover({ tag: "jazz", sort: "new" }, "cursor-1"))
      .resolves.toEqual({
        results: [release],
        resultCount: 1,
        hasMore: false,
      });
    expect(invocations).toEqual([{
      command: "discover",
      payload: {
        input: { tag: "jazz", sort: "new", cursor: "cursor-1" },
      },
    }]);
  });
});
