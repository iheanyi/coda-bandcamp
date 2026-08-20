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
  | Readonly<{ kind: "discover-external-artist" }>
  | Readonly<{ kind: "daily-external-artist" }>
  | Readonly<{ kind: "radio" }>
  | Readonly<{ kind: "radio-series"; seriesId: RadioSeriesId }>;

export function trackAlbumDestination(
  track: Track,
): TrackAlbumDestination | undefined {
  if (track.id.startsWith("discover:")) {
    const release = track.discoverRelease;
    if (!release || release.id !== track.albumId) return undefined;
    const releaseId = tryParseRouteId(release.id, parseDiscoverReleaseIdParam);
    return releaseId
      ? { kind: "discover-release", releaseId, release }
      : undefined;
  }

  if (track.id.startsWith("daily:")) {
    const itemUrl = track.dailySource?.itemUrl;
    return itemUrl ? { kind: "daily-external-item", itemUrl } : undefined;
  }

  if (track.id.startsWith("radio:")) {
    const rawShowId = radioShowIdFromTrackId(track.id);
    const showId = tryParseRouteId(rawShowId, parseRadioShowIdParam);
    if (showId) return { kind: "radio-show", showId };
    const series = radioSeriesByTitle(track.album);
    const seriesId = tryParseRouteId(series?.id, parseRadioSeriesIdParam);
    return seriesId ? { kind: "radio-series", seriesId } : { kind: "radio" };
  }

  const albumId = tryParseRouteId(track.albumId, parseAlbumIdParam);
  return albumId ? { kind: "album", albumId } : undefined;
}

export function trackArtistDestination(
  track: Track,
): TrackArtistDestination | undefined {
  if (track.id.startsWith("discover:")) {
    return track.discoverRelease?.id === track.albumId
      ? { kind: "discover-external-artist" }
      : undefined;
  }

  if (track.id.startsWith("daily:")) {
    return track.dailySource?.artistUrl
      ? { kind: "daily-external-artist" }
      : undefined;
  }

  if (track.id.startsWith("radio:")) {
    const series = radioSeriesByTitle(track.album);
    if (!series) return { kind: "radio" };
    const seriesId = tryParseRouteId(series.id, parseRadioSeriesIdParam);
    return seriesId ? { kind: "radio-series", seriesId } : { kind: "radio" };
  }

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
