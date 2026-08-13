import { artistKey } from "@/libraryBrowse";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import { radioSeriesByTitle } from "@/radioSeries";
import type { Track } from "@/types";
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
  | Readonly<{
      kind: "discover-release";
      releaseId: DiscoverReleaseId;
    }>
  | Readonly<{ kind: "radio-show"; showId: RadioShowId }>;

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

function tryParse<Value>(
  value: unknown,
  parse: (candidate: unknown) => Value,
): Value | undefined {
  try {
    return parse(value);
  } catch {
    return undefined;
  }
}

export function trackAlbumDestination(
  track: Track,
): TrackAlbumDestination | undefined {
  if (track.id.startsWith("discover:")) {
    const release = track.discoverRelease;
    if (!release || release.id !== track.albumId) return undefined;
    const releaseId = tryParse(release.id, parseDiscoverReleaseIdParam);
    return releaseId ? { kind: "discover-release", releaseId } : undefined;
  }

  if (track.id.startsWith("daily:")) return undefined;

  if (track.id.startsWith("radio:")) {
    const rawShowId = radioShowIdFromTrackId(track.id);
    const showId = tryParse(rawShowId, parseRadioShowIdParam);
    return showId ? { kind: "radio-show", showId } : undefined;
  }

  const albumId = tryParse(track.albumId, parseAlbumIdParam);
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
    const seriesId = tryParse(series.id, parseRadioSeriesIdParam);
    return seriesId ? { kind: "radio-series", seriesId } : { kind: "radio" };
  }

  const key = artistKey(track.artist);
  const parsedArtistKey = tryParse(key, parseArtistKeyParam);
  if (!parsedArtistKey) return undefined;
  const sourceAlbumId = tryParse(track.albumId, parseAlbumIdParam);
  return {
    kind: "artist",
    artistKey: parsedArtistKey,
    ...(sourceAlbumId ? { sourceAlbumId } : {}),
  };
}
