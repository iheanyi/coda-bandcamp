import { genreKey } from "./genres";
import type { Album, Track } from "./types";

export type QueueRecommendation = {
  album: Album;
  reason: string;
};

function normalized(value?: string): string {
  return value?.trim().toLocaleLowerCase() ?? "";
}

function hashText(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function recommendQueueAlbum(
  albums: readonly Album[],
  seedTrack: Track | undefined,
  favoriteAlbumIds: ReadonlySet<string>,
  nonce = 0,
): QueueRecommendation | undefined {
  const playable = albums.filter((album) => album.songCount > 0);
  if (!playable.length) return undefined;

  const seedAlbum = seedTrack
    ? playable.find((album) => album.id === seedTrack.albumId)
    : undefined;
  const candidates = seedAlbum && playable.length > 1
    ? playable.filter((album) => album.id !== seedAlbum.id)
    : playable;
  const seedArtist = normalized(seedTrack?.albumArtist ?? seedTrack?.artist);
  const seedGenre = genreKey(seedAlbum?.genre);
  const weighted = candidates.map((album) => {
    const sameArtist = Boolean(seedArtist) && normalized(album.artist) === seedArtist;
    const sameGenre = Boolean(seedGenre) && genreKey(album.genre) === seedGenre;
    const favorite = favoriteAlbumIds.has(album.id);
    return {
      album,
      sameArtist,
      sameGenre,
      favorite,
      weight:
        2 +
        (sameGenre ? 12 : 0) +
        (sameArtist ? 8 : 0) +
        (favorite ? 3 : 0) +
        Math.min(3, Math.floor(Math.log2(Math.max(1, album.songCount)))),
    };
  });
  const totalWeight = weighted.reduce((total, item) => total + item.weight, 0);
  let roll = hashText(
    `${seedTrack?.id ?? "collection"}:${nonce}:${weighted.length}`,
  ) % totalWeight;
  const chosen = weighted.find((item) => {
    roll -= item.weight;
    return roll < 0;
  }) ?? weighted[weighted.length - 1];

  const reason = chosen.sameArtist
    ? `More from ${chosen.album.artist}`
    : chosen.sameGenre
      ? `Another ${chosen.album.genre} pick`
      : chosen.favorite
        ? "A favorite from your collection"
        : seedTrack
          ? "A fresh turn from your collection"
          : "A wildcard from your collection";
  return { album: chosen.album, reason };
}
