import { artistKey } from "@/libraryBrowse";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import { radioSeriesByTitle } from "@/radioSeries";
import type { Track } from "@/types";
import { tryParseRouteId } from "./tryParseRouteId";
import {
  type AlbumId,
  type ArtistKey,
  type DiscoverReleaseId,
  type RadioSeriesId,
  type RadioShowId,
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
} from "./routeContracts";

export type TrackAlbumDestination =
  | Readonly<{ kind: "album"; albumId: AlbumId }>
  | Readonly<{ kind: "daily-external-item"; itemUrl: string }>
  | Readonly<{
      kind: "discover-release";
      releaseId: DiscoverReleaseId;
      release: NonNullable<Track["discoverRelease"]>;
    }>
  | Readonly<{ kind: "radio-show"; showId: RadioShowId }>
  | Readonly<{ kind: "radio-series"; seriesId: RadioSeriesId }>
  | Readonly<{ kind: "radio" }>;

export type TrackArtistDestination =
  | Readonly<{
      kind: "artist";
      artistKey: ArtistKey;
      sourceAlbumId?: AlbumId;
    }>
  | Readonly<{
      kind: "discover-external-artist";
      release: NonNullable<Track["discoverRelease"]>;
    }>
  | Readonly<{ kind: "daily-external-artist"; artistUrl: string }>
  | Readonly<{ kind: "radio" }>
  | Readonly<{ kind: "radio-series"; seriesId: RadioSeriesId }>;

export type TrackSourceFamily = "daily" | "discover" | "radio" | "library";

function assertNever(value: never): never {
  throw new TypeError(`Unsupported exhaustive variant: ${String(value)}`);
}

/** Sole owner of the track-id prefixes that separate Coda's source families. */
export function trackSourceFamily(track: Track): TrackSourceFamily {
  if (track.id.startsWith("discover:")) return "discover";
  if (track.id.startsWith("daily:")) return "daily";
  if (track.id.startsWith("radio:")) return "radio";
  return "library";
}

export function trackAlbumDestination(
  track: Track,
): TrackAlbumDestination | undefined {
  const family = trackSourceFamily(track);
  switch (family) {
    case "discover": {
      const release = track.discoverRelease;
      if (!release || release.id !== track.albumId) return undefined;
      const releaseId = tryParseRouteId(
        release.id,
        parseDiscoverReleaseIdParam,
      );
      return releaseId
        ? { kind: "discover-release", releaseId, release }
        : undefined;
    }
    case "daily": {
      const itemUrl = track.dailySource?.itemUrl;
      return itemUrl ? { kind: "daily-external-item", itemUrl } : undefined;
    }
    case "radio": {
      const rawShowId = radioShowIdFromTrackId(track.id);
      const showId = tryParseRouteId(rawShowId, parseRadioShowIdParam);
      if (showId) return { kind: "radio-show", showId };
      const series = radioSeriesByTitle(track.album);
      const seriesId = tryParseRouteId(series?.id, parseRadioSeriesIdParam);
      return seriesId ? { kind: "radio-series", seriesId } : { kind: "radio" };
    }
    case "library": {
      const albumId = tryParseRouteId(track.albumId, parseAlbumIdParam);
      return albumId ? { kind: "album", albumId } : undefined;
    }
    default:
      return assertNever(family);
  }
}

export function trackArtistDestination(
  track: Track,
): TrackArtistDestination | undefined {
  const family = trackSourceFamily(track);
  switch (family) {
    case "discover": {
      const release = track.discoverRelease;
      if (!release || release.id !== track.albumId) return undefined;
      return { kind: "discover-external-artist", release };
    }
    case "daily": {
      const artistUrl = track.dailySource?.artistUrl;
      return artistUrl
        ? { kind: "daily-external-artist", artistUrl }
        : undefined;
    }
    case "radio": {
      const series = radioSeriesByTitle(track.album);
      if (!series) return { kind: "radio" };
      const seriesId = tryParseRouteId(series.id, parseRadioSeriesIdParam);
      return seriesId ? { kind: "radio-series", seriesId } : { kind: "radio" };
    }
    case "library": {
      const key = artistKey(track.artist);
      const parsedArtistKey = tryParseRouteId(key, parseArtistKeyParam);
      if (!parsedArtistKey) return undefined;
      const sourceAlbumId = tryParseRouteId(track.albumId, parseAlbumIdParam);
      if (sourceAlbumId) {
        return {
          kind: "artist",
          artistKey: parsedArtistKey,
          sourceAlbumId,
        };
      }
      return {
        kind: "artist",
        artistKey: parsedArtistKey,
      };
    }
    default:
      return assertNever(family);
  }
}
