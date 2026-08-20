import { bandcampArtistOrigin } from "./bandcampUrl";
import { paletteFor } from "./lib";
import type { DiscoverRelease, Track } from "./types";

export function discoverPreviewTrack(
  release: DiscoverRelease,
): Track | undefined {
  if (!release.featuredTrack) return undefined;
  return {
    id: release.featuredTrack.id,
    title: release.featuredTrack.title,
    artist: release.artist,
    album: release.title,
    albumId: release.id,
    duration: release.featuredTrack.duration,
    track: 1,
    artworkUrl: release.artworkUrl,
    streamUrl: release.featuredTrack.streamUrl,
    discoverRelease: release,
    palette: paletteFor(release.id),
  };
}

export function discoverArtistUrl(
  release: DiscoverRelease,
): string | undefined {
  return bandcampArtistOrigin(release.itemUrl);
}
