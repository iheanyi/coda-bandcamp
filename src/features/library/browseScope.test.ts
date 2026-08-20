import { describe, expect, it } from "vitest";

import type { ArtistGroup } from "@/libraryBrowse";
import type { Album } from "@/types";

import {
  browseModeReleaseTitle,
  deriveBrowseScopeDescriptor,
  deriveReleaseResultsTitle,
  deriveSurpriseScope,
  hasActiveBrowseFilters,
} from "./browseScope";

const album: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  songCount: 4,
  duration: 804,
  palette: ["#777", "#222"],
};

const artist: ArtistGroup = {
  key: "signal garden",
  name: "Signal Garden",
  albums: [album],
  releaseCount: 1,
  trackCount: 4,
  duration: 804,
  representative: album,
};

const base = {
  activeArtist: undefined,
  effectiveBrowseMode: "releases" as const,
  genre: "All",
  query: "",
  recent: false,
};

describe("browse scope descriptor", () => {
  it("prefers album, artist, results, genre, then recent over browse mode", () => {
    expect(
      deriveBrowseScopeDescriptor({ ...base, selectedAlbum: album }),
    ).toEqual({ name: "Blue Hours", shuffleLabel: "Shuffle album" });
    expect(
      deriveBrowseScopeDescriptor({ ...base, activeArtist: artist }),
    ).toEqual({ name: "Signal Garden", shuffleLabel: "Shuffle artist" });
    expect(deriveBrowseScopeDescriptor({ ...base, query: "glass" })).toEqual({
      name: "the current results",
      shuffleLabel: "Shuffle results",
    });
    expect(deriveBrowseScopeDescriptor({ ...base, genre: "Ambient" })).toEqual({
      name: "Ambient",
      shuffleLabel: "Shuffle genre",
    });
    expect(deriveBrowseScopeDescriptor({ ...base, recent: true })).toEqual({
      name: "recent additions",
      shuffleLabel: "Shuffle recent",
    });
  });

  it("labels each library browse mode", () => {
    expect(deriveBrowseScopeDescriptor(base)).toEqual({
      name: "the collection",
      shuffleLabel: "Shuffle collection",
    });
    expect(
      deriveBrowseScopeDescriptor({ ...base, effectiveBrowseMode: "albums" }),
    ).toEqual({
      name: "the albums view",
      shuffleLabel: "Shuffle albums",
    });
    expect(
      deriveBrowseScopeDescriptor({ ...base, effectiveBrowseMode: "singles" }),
    ).toEqual({
      name: "the singles view",
      shuffleLabel: "Shuffle singles",
    });
    expect(
      deriveBrowseScopeDescriptor({ ...base, effectiveBrowseMode: "artists" }),
    ).toEqual({
      name: "the visible artists",
      shuffleLabel: "Shuffle artists",
    });
  });
});

describe("surprise scope", () => {
  it("scopes albums to the current album, artist, or visible list", () => {
    expect(
      deriveSurpriseScope({
        ...base,
        routeKind: "album",
        selectedAlbum: album,
        visibleAlbums: [album],
      }),
    ).toEqual({
      albums: [album],
      artist: undefined,
      name: "Blue Hours",
      shuffleLabel: "Shuffle album",
    });
    expect(
      deriveSurpriseScope({
        ...base,
        activeArtist: artist,
        routeKind: "artist",
        visibleAlbums: [album],
      }),
    ).toEqual({
      albums: artist.albums,
      artist,
      name: "Signal Garden",
      shuffleLabel: "Shuffle artist",
    });
    expect(
      deriveSurpriseScope({
        ...base,
        routeKind: "collection",
        visibleAlbums: [album],
      }),
    ).toEqual({
      albums: [album],
      artist: undefined,
      name: "the collection",
      shuffleLabel: "Shuffle collection",
    });
  });
});

describe("browse titles and filters", () => {
  it("titles the release grid from artist, genre, and browse mode", () => {
    expect(browseModeReleaseTitle("albums")).toBe("Albums & EPs");
    expect(
      deriveReleaseResultsTitle({
        activeArtist: artist,
        genre: "Ambient",
        mode: "albums",
      }),
    ).toBe("Releases");
    expect(
      deriveReleaseResultsTitle({
        activeArtist: undefined,
        genre: "Ambient",
        mode: "albums",
      }),
    ).toBe("Albums & EPs · Ambient");
  });

  it("treats query, genre, mode, and artist as active filters", () => {
    expect(
      hasActiveBrowseFilters({
        query: "",
        genre: "All",
        mode: "releases",
      }),
    ).toBe(false);
    expect(
      hasActiveBrowseFilters({
        query: "glass",
        genre: "All",
        mode: "releases",
      }),
    ).toBe(true);
  });
});
