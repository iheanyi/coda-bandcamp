import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_KEY,
  LOCAL_FAVORITES_VERSION,
  localTrackStarIndexCanAccept,
  MAX_FAVORITE_TRACKS,
  MAX_LOCAL_FAVORITES_BYTES,
  parseLocalFavoritesSerialized,
  readLocalFavorites,
  reconcileLocalTrackStarIndex,
  repairLocalFavoriteMetadata,
  sanitizeLocalFavorites,
  updateLocalFavorites,
  updateLocalRadioFavorite,
  writeLocalFavorites,
} from "./localFavorites";
import { isStringValue, type OwnDataValue } from "./ownData";
import type { Album, RadioShowSummary, Track } from "./types";

const track: Track = {
  id: "song-1",
  title: "Mirage",
  artist: "Sweeps",
  album: "Mirage",
  albumId: "album-1",
  duration: 188,
  track: 1,
  albumArtist: "Sweeps",
  musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
  coverArt: "cover-1",
  starredAt: "2025-07-01T12:01:00Z",
  artworkUrl: "https://bandcamp.com/api/subsonic/rest/getCoverArt.view?t=signed",
  streamUrl: "https://bandcamp.com/api/subsonic/rest/stream.view?t=signed",
  palette: ["#a66", "#222"],
};

const album: Album = {
  id: "album-1",
  title: "Mirage",
  artist: "Sweeps",
  songCount: 1,
  duration: 188,
  coverArt: "cover-1",
  year: 2025,
  addedAt: "30 Jun 2025 12:00:00 GMT",
  starredAt: "2025-07-01T12:00:00Z",
  playedAt: "2025-07-02T12:00:00Z",
  originalReleaseDate: { year: 2001 },
  releaseDate: { year: 2025, month: 6, day: 30 },
  artworkUrl: "https://bandcamp.com/api/subsonic/rest/getCoverArt.view?t=signed",
  tracks: [track],
  palette: ["#a66", "#222"],
};

const radioShow: RadioShowSummary = {
  id: 979,
  subtitle: "The Hip Hop Show",
  description: "New independent hip-hop from around the world.",
  publishedAt: "24 Jul 2026 00:00:00 GMT",
  artworkUrl: "https://f4.bcbits.com/img/0046240870_10.jpg",
  series: {
    id: 5,
    title: "The Hip Hop Show",
    slug: "the-hip-hop-show",
  },
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("local favorites", () => {
  it("persists a bounded track-star index without signed media URLs", () => {
    let favorites = updateLocalFavorites(
      emptyLocalFavorites(),
      { id: album.id, kind: "album", favorite: true },
      album,
    );
    favorites = updateLocalFavorites(
      favorites,
      { id: track.id, kind: "song", favorite: true },
      track,
    );

    writeLocalFavorites(favorites);

    const serialized = window.localStorage.getItem(LOCAL_FAVORITES_KEY)!;
    expect(serialized).not.toContain("stream.view");
    expect(serialized).not.toContain("getCoverArt.view");
    expect(readLocalFavorites()).toMatchObject({
      albumIds: [],
      songIds: ["song-1"],
      albums: [],
      tracks: [{
        id: "song-1",
        coverArt: "cover-1",
        albumArtist: "Sweeps",
        musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
        starredAt: "2025-07-01T12:01:00Z",
      }],
    });
    expect(readLocalFavorites().albums).toEqual([]);
  });

  it("removes favorites and discards malformed storage", () => {
    const added = updateLocalFavorites(
      emptyLocalFavorites(),
      { id: track.id, kind: "song", favorite: true },
      track,
    );
    expect(updateLocalFavorites(
      added,
      { id: track.id, kind: "song", favorite: false },
    ).songIds).toEqual([]);

    window.localStorage.setItem(LOCAL_FAVORITES_KEY, "{\"version\":1,\"songIds\":\"bad\"}");
    expect(readLocalFavorites()).toEqual({
      albumIds: [],
      songIds: [],
      albums: [],
      tracks: [],
      radioShowIds: [],
      radioShows: [],
    });
    expect(window.localStorage.getItem(LOCAL_FAVORITES_KEY)).toBeNull();
  });

  it("decodes storage directly into a validated Favorites owner", () => {
    const snapshot = {
      version: LOCAL_FAVORITES_VERSION,
      ...emptyLocalFavorites(),
      songIds: [track.id],
      tracks: [track],
    };

    expect(
      parseLocalFavoritesSerialized(JSON.stringify(snapshot))?.songIds,
    ).toEqual([track.id]);
    expect(parseLocalFavoritesSerialized("{")).toBeUndefined();
    expect(
      parseLocalFavoritesSerialized("x".repeat(MAX_LOCAL_FAVORITES_BYTES + 1)),
    ).toBeUndefined();
    expect(parseLocalFavoritesSerialized(JSON.stringify({
      ...snapshot,
      tracks: [{ ...track, title: "invalid\u009f" }],
    }))).toBeUndefined();
  });

  it("rejects inherited, accessor, and coercion-spoofed fields", () => {
    const validCollection = {
      ...emptyLocalFavorites(),
      songIds: [track.id],
      tracks: [track],
    };
    const inheritedCollection = Object.create(validCollection);
    let titleReads = 0;
    const accessorTrack = { ...track };
    Object.defineProperty(accessorTrack, "title", {
      enumerable: true,
      get() {
        titleReads += 1;
        return track.title;
      },
    });
    let coercions = 0;
    const spoofedTitle = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        return track.title;
      },
    };

    expect(sanitizeLocalFavorites(inheritedCollection)).toBeUndefined();
    expect(sanitizeLocalFavorites({
      ...validCollection,
      tracks: [accessorTrack],
    })).toBeUndefined();
    expect(titleReads).toBe(0);
    expect(sanitizeLocalFavorites({
      ...validCollection,
      tracks: [{ ...track, title: spoofedTitle }],
    })).toBeUndefined();
    expect(coercions).toBe(0);
  });

  it("normalizes nullable native fields and repairs prior ID-only favorites", () => {
    const nativeAlbum = {
      ...album,
      coverArt: null,
      year: null,
      genre: null,
      addedAt: null,
      starredAt: null,
      playedAt: null,
      originalReleaseDate: null,
      releaseDate: null,
    };
    const nativeTrack = {
      ...track,
      coverArt: null,
      disc: null,
    };
    const repaired = repairLocalFavoriteMetadata(
      {
        albumIds: ["album-1"],
        songIds: ["song-1"],
        albums: [],
        tracks: [],
        radioShowIds: [],
        radioShows: [],
      },
      [nativeAlbum],
      [nativeTrack],
    );

    expect(repaired.albums).toMatchObject([{ id: "album-1" }]);
    expect(repaired.tracks).toMatchObject([{ id: "song-1" }]);
    expect(repaired.albums[0]).not.toHaveProperty("coverArt");
    expect(repaired.albums[0]).not.toHaveProperty("releaseDate");
    expect(repaired.tracks[0]).not.toHaveProperty("disc");
    expect(() => writeLocalFavorites(repaired)).not.toThrow();
  });

  it("rejects malformed or unbounded OpenSubsonic date metadata", () => {
    const collectionFor = (candidate: Album) => ({
      ...emptyLocalFavorites(),
      albumIds: [candidate.id],
      albums: [candidate],
    });
    const malformed: Album[] = [
      { ...album, addedAt: "not-a-date" },
      { ...album, starredAt: "2025-02-29T12:00:00Z" },
      { ...album, playedAt: `2025-01-01T00:00:00Z${"x".repeat(1_025)}` },
      { ...album, originalReleaseDate: { year: 2025, month: 2, day: 29 } },
      { ...album, releaseDate: { year: 2025, day: 1 } },
    ];

    for (const candidate of malformed) {
      expect(sanitizeLocalFavorites(collectionFor(candidate))).toBeUndefined();
    }
  });

  it("scans full-length UTF-16 text and rejects every control range", () => {
    const collectionForTitle = (title: string) => ({
      ...emptyLocalFavorites(),
      songIds: [track.id],
      tracks: [{ ...track, title }],
    });
    const fullLengthTitle = "🎵".repeat(512);

    expect(fullLengthTitle).toHaveLength(1_024);
    expect(
      sanitizeLocalFavorites(collectionForTitle(fullLengthTitle))
        ?.tracks[0]?.title,
    ).toBe(fullLengthTitle);
    for (const control of ["\u0000", "\u001f", "\u007f", "\u009f"]) {
      expect(
        sanitizeLocalFavorites(
          collectionForTitle(`${"a".repeat(1_023)}${control}`),
        ),
      ).toBeUndefined();
    }
    expect(
      sanitizeLocalFavorites(collectionForTitle("a".repeat(1_025))),
    ).toBeUndefined();
  });

  it("repairs every preserved album date field and recognizes equal precision", () => {
    const current = updateLocalFavorites(
      emptyLocalFavorites(),
      { id: album.id, kind: "album", favorite: true },
      album,
    );
    const refreshed: Album = {
      ...album,
      addedAt: "01 Jul 2025 12:00:00 GMT",
      starredAt: "2025-07-03T12:00:00Z",
      playedAt: "2025-07-04T12:00:00Z",
      originalReleaseDate: { year: 2001, month: 4 },
      releaseDate: { year: 2025, month: 7, day: 1 },
    };

    const repaired = repairLocalFavoriteMetadata(current, [refreshed], []);

    expect(repaired.albums[0]).toMatchObject({
      addedAt: refreshed.addedAt,
      starredAt: refreshed.starredAt,
      playedAt: refreshed.playedAt,
      originalReleaseDate: refreshed.originalReleaseDate,
      releaseDate: refreshed.releaseDate,
    });
    expect(repairLocalFavoriteMetadata(
      repaired,
      [{
        ...refreshed,
        originalReleaseDate: { year: 2001, month: 4 },
        releaseDate: { year: 2025, month: 7, day: 1 },
      }],
      [],
    )).toBe(repaired);

    const {
      addedAt: _addedAt,
      starredAt: _starredAt,
      playedAt: _playedAt,
      originalReleaseDate: _originalReleaseDate,
      releaseDate: _releaseDate,
      ...candidateWithoutDates
    } = refreshed;
    expect(repairLocalFavoriteMetadata(
      repaired,
      [candidateWithoutDates],
      [],
    )).toBe(repaired);
  });

  it("drops legacy device-local music while migrating version-one favorites", () => {
    window.localStorage.setItem(
      LOCAL_FAVORITES_KEY,
      JSON.stringify({
        version: 1,
        albumIds: ["album-1"],
        songIds: [],
        albums: [album],
        tracks: [],
      }),
    );

    const migrated = readLocalFavorites();
    expect(migrated).toEqual(emptyLocalFavorites());
  });

  it("does not reinterpret version-two device-local tracks as Bandcamp stars", () => {
    window.localStorage.setItem(
      LOCAL_FAVORITES_KEY,
      JSON.stringify({
        version: 2,
        albumIds: [album.id],
        songIds: [track.id],
        albums: [album],
        tracks: [track],
        radioShowIds: [radioShow.id],
        radioShows: [radioShow],
      }),
    );

    expect(readLocalFavorites()).toEqual({
      ...emptyLocalFavorites(),
      radioShowIds: [radioShow.id],
      radioShows: [{ ...radioShow, artworkUrl: undefined }],
    });
  });

  it("persists radio-show favorites without remote artwork URLs", () => {
    const favorites = updateLocalRadioFavorite(
      emptyLocalFavorites(),
      radioShow,
      true,
    );
    writeLocalFavorites(favorites);

    const serialized = window.localStorage.getItem(LOCAL_FAVORITES_KEY)!;
    expect(serialized).not.toContain("f4.bcbits.com");
    expect(readLocalFavorites().radioShows).toEqual([
      {
        id: 979,
        subtitle: "The Hip Hop Show",
        description: "New independent hip-hop from around the world.",
        publishedAt: "24 Jul 2026 00:00:00 GMT",
        series: {
          id: 5,
          title: "The Hip Hop Show",
          slug: "the-hip-hop-show",
        },
      },
    ]);
    expect(updateLocalRadioFavorite(favorites, radioShow, false).radioShowIds)
      .toEqual([]);
  });

  it("filters the 25,000-track maximum with indexed ID membership", () => {
    const favoriteCount = 25_000;
    const songIds = Array.from(
      { length: favoriteCount },
      (_value, index) => `song-linear-${index}`,
    );
    const tracks = songIds.map((id, index): Track => ({
      ...track,
      id,
      track: index + 1,
    }));
    const originalIncludes = Array.prototype.includes;
    let linearCollectionIncludes = 0;
    const includesSpy = vi.spyOn(Array.prototype, "includes").mockImplementation(
      function (
        this: unknown[],
        searchElement: OwnDataValue,
        fromIndex?: number,
      ) {
        if (
          this.length === favoriteCount &&
          isStringValue(searchElement) &&
          searchElement.startsWith("song-linear-")
        ) {
          linearCollectionIncludes += 1;
        }
        return originalIncludes.call(this, searchElement, fromIndex);
      },
    );

    let sanitized: ReturnType<typeof sanitizeLocalFavorites>;
    try {
      sanitized = sanitizeLocalFavorites({
        albumIds: [],
        songIds,
        albums: [],
        tracks,
        radioShowIds: [],
        radioShows: [],
      });
    } finally {
      includesSpy.mockRestore();
    }

    expect(sanitized?.tracks).toHaveLength(favoriteCount);
    expect(linearCollectionIncludes).toBe(0);
  });

  it("returns the same collection when confirmed track stars already match", () => {
    const current = updateLocalFavorites(
      emptyLocalFavorites(),
      { id: track.id, kind: "song", favorite: true },
      track,
    );

    expect(reconcileLocalTrackStarIndex(current, current.tracks)).toBe(current);
  });

  it("drops confirmed unstars and prepends newly confirmed stars in one pass", () => {
    const kept = updateLocalFavorites(
      emptyLocalFavorites(),
      { id: track.id, kind: "song", favorite: true },
      track,
    );
    const removed = updateLocalFavorites(
      kept,
      { id: "song-2", kind: "song", favorite: true },
      { ...track, id: "song-2", title: "Lanterns", track: 2 },
    );
    const incoming: Track = {
      ...track,
      id: "song-3",
      title: "Afterimage",
      track: 3,
      starredAt: "2025-07-02T12:00:00Z",
      artworkUrl: undefined,
      streamUrl: undefined,
    };

    const reconciled = reconcileLocalTrackStarIndex(
      removed,
      [incoming],
      ["song-2"],
    );

    expect(reconciled).not.toBe(removed);
    expect(reconciled.songIds).toEqual(["song-3", "song-1"]);
    expect(reconciled.tracks.map((item) => item.id)).toEqual([
      "song-3",
      "song-1",
    ]);
    expect(reconciled.tracks[0]).toEqual({
      id: "song-3",
      title: "Afterimage",
      artist: "Sweeps",
      album: "Mirage",
      albumId: "album-1",
      duration: 188,
      track: 3,
      albumArtist: "Sweeps",
      musicBrainzId: "189002e7-3285-4e2e-92a3-7f6c30d407a2",
      coverArt: "cover-1",
      starredAt: "2025-07-02T12:00:00Z",
      palette: ["#a66", "#222"],
    });
  });

  it("rejects a new confirmed star at the 25,000-track bound and updates existing ids", () => {
    const songIds = Array.from(
      { length: MAX_FAVORITE_TRACKS },
      (_value, index) => `song-bound-${index}`,
    );
    const current = {
      ...emptyLocalFavorites(),
      songIds,
    };
    const overflow: Track = {
      ...track,
      id: "song-overflow",
      starredAt: "2025-07-02T12:00:00Z",
    };

    expect(localTrackStarIndexCanAccept(emptyLocalFavorites(), overflow.id)).toBe(true);
    expect(localTrackStarIndexCanAccept(current, "song-bound-0")).toBe(true);
    expect(localTrackStarIndexCanAccept(current, overflow.id)).toBe(false);
    expect(() => updateLocalFavorites(
      current,
      { id: overflow.id, kind: "song", favorite: true },
      overflow,
    )).toThrow("Coda can save at most 25,000 favorite tracks.");
    expect(() => reconcileLocalTrackStarIndex(current, [overflow])).toThrow(
      "Coda can save at most 25,000 favorite tracks.",
    );

    const updated = reconcileLocalTrackStarIndex(current, [{
      ...track,
      id: "song-bound-0",
      starredAt: "2025-07-03T12:00:00Z",
    }]);
    expect(updated.songIds[0]).toBe("song-bound-0");
    expect(updated.tracks[0]).toMatchObject({
      id: "song-bound-0",
      starredAt: "2025-07-03T12:00:00Z",
    });
  });

  it("reconciles the 25,000-track bound without per-track linear scans", () => {
    const favoriteCount = MAX_FAVORITE_TRACKS;
    const songIds = Array.from(
      { length: favoriteCount },
      (_value, index) => `song-linear-${index}`,
    );
    const tracks = songIds.map((id, index): Track => ({
      id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumId: track.albumId,
      duration: track.duration,
      track: index + 1,
      albumArtist: track.albumArtist,
      musicBrainzId: track.musicBrainzId,
      coverArt: track.coverArt,
      starredAt: track.starredAt,
      palette: track.palette,
    }));
    const current = {
      ...emptyLocalFavorites(),
      songIds,
      tracks,
    };
    const originalFind = Array.prototype.find;
    const originalIncludes = Array.prototype.includes;
    const originalFilter = Array.prototype.filter;
    let linearCollectionFinds = 0;
    let linearCollectionIncludes = 0;
    let linearCollectionFilters = 0;
    const findSpy = vi.spyOn(Array.prototype, "find").mockImplementation(
      function (this: OwnDataValue[], predicate, thisArg) {
        if (this.length === favoriteCount) linearCollectionFinds += 1;
        return originalFind.call(this, predicate, thisArg);
      },
    );
    const includesSpy = vi.spyOn(Array.prototype, "includes").mockImplementation(
      function (
        this: OwnDataValue[],
        searchElement: OwnDataValue,
        fromIndex?: number,
      ) {
        if (
          this.length === favoriteCount &&
          isStringValue(searchElement) &&
          searchElement.startsWith("song-linear-")
        ) {
          linearCollectionIncludes += 1;
        }
        return originalIncludes.call(this, searchElement, fromIndex);
      },
    );
    const filterSpy = vi.spyOn(Array.prototype, "filter").mockImplementation(
      function (this: OwnDataValue[], predicate, thisArg) {
        if (this.length === favoriteCount) linearCollectionFilters += 1;
        return originalFilter.call(this, predicate, thisArg);
      },
    );
    const stringifySpy = vi.spyOn(JSON, "stringify");

    try {
      expect(reconcileLocalTrackStarIndex(current, tracks)).toBe(current);

      const refreshed = tracks.map((item) => ({
        ...item,
        starredAt: "2025-08-01T12:00:00Z",
      }));
      const reconciled = reconcileLocalTrackStarIndex(current, refreshed);
      expect(reconciled.tracks).toHaveLength(favoriteCount);
      expect(reconciled.tracks[0]?.starredAt).toBe("2025-08-01T12:00:00Z");
      expect(reconciled.songIds[0]).toBe(`song-linear-${favoriteCount - 1}`);
      expect(stringifySpy).not.toHaveBeenCalled();
    } finally {
      findSpy.mockRestore();
      includesSpy.mockRestore();
      filterSpy.mockRestore();
      stringifySpy.mockRestore();
    }

    expect(linearCollectionFinds).toBe(0);
    expect(linearCollectionIncludes).toBe(0);
    expect(linearCollectionFilters).toBeLessThan(8);
    expect(stringifySpy).not.toHaveBeenCalled();
  });
});
