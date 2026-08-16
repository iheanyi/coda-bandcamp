import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_KEY,
  LOCAL_FAVORITES_VERSION,
  MAX_LOCAL_FAVORITES_BYTES,
  parseLocalFavoritesSerialized,
  readLocalFavorites,
  repairLocalFavoriteMetadata,
  sanitizeLocalFavorites,
  updateLocalFavorites,
  updateLocalRadioFavorite,
  writeLocalFavorites,
  type LocalFavoritesWireValue,
} from "./localFavorites";
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

function isWireString(value: LocalFavoritesWireValue): value is string {
  return String(value) === value;
}

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

  it("filters large favorite metadata with indexed ID membership", () => {
    const favoriteCount = 2_000;
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
        this: LocalFavoritesWireValue[],
        searchElement: LocalFavoritesWireValue,
        fromIndex?: number,
      ) {
        if (
          this.length === favoriteCount &&
          isWireString(searchElement) &&
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
});
