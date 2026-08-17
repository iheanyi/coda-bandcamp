import { artistKey } from "@/libraryBrowse";
import {
  type AlbumId,
  type ArtistKey,
  parseAlbumIdParam,
  parseArtistKeyParam,
} from "@/routing/routeContracts";

const radioDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export const metadataLinkClassName =
  "inline-flex h-auto min-w-0 max-w-[48%] cursor-pointer items-center truncate rounded-none border-0 bg-transparent p-0 text-left text-xs font-normal text-coda-subtle-foreground outline-none hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
export const metadataTextClassName =
  "h-auto min-w-0 max-w-[48%] truncate text-left text-xs font-normal text-coda-subtle-foreground";
export const savedPageClassName =
  "mx-auto min-h-full w-full max-w-5xl pt-2 pb-12";

export function openAlbumAccessibleName(
  albumTitle: string,
  trackTitle: string,
): string {
  const album = albumTitle.trim();
  if (album.length > 0) return `Open ${album}`;
  const track = trackTitle.trim();
  return track.length > 0 ? `Open album for ${track}` : "Open album details";
}

export function loadingAlbumAccessibleName(
  albumTitle: string,
  trackTitle: string,
): string {
  const album = albumTitle.trim();
  if (album.length > 0) return `Loading ${album} album`;
  const track = trackTitle.trim();
  return track.length > 0
    ? `Loading album for ${track}`
    : "Loading album details";
}

export function albumRouteId(value: string): AlbumId | undefined {
  try {
    return parseAlbumIdParam(value);
  } catch {
    return undefined;
  }
}

export function artistRouteKey(value: string): ArtistKey | undefined {
  try {
    return parseArtistKeyParam(artistKey(value));
  } catch {
    return undefined;
  }
}

export function mutationError(cause: unknown): string {
  return String(cause).replace(/^Error:\s*/, "");
}

export function radioShowDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : radioDateFormatter.format(parsed);
}
