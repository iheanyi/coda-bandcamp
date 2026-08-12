import { pickRandomItem, weightedRandomOrder } from "./random";
import type { Album, Track } from "./types";

const SURPRISE_MAX_ATTEMPTS = 6;

export type SurpriseResult = {
  kind: "album" | "track";
  album: Album;
  queue: [Track, ...Track[]];
};

export type SurpriseDependencies = {
  loadTracks: (album: Album) => Promise<readonly Track[] | undefined>;
  random?: () => number;
  selectTracks?: (
    album: Album,
    tracks: readonly Track[],
  ) => readonly Track[];
  isActive?: () => boolean;
};

export async function resolveSurprise(
  scopeAlbums: readonly Album[],
  {
    loadTracks,
    random = Math.random,
    selectTracks = (_album, tracks) => tracks,
    isActive = () => true,
  }: SurpriseDependencies,
): Promise<SurpriseResult | undefined> {
  const albumCandidates = scopeAlbums.filter((album) => album.songCount > 1);
  const kind = albumCandidates.length
    ? pickRandomItem(["album", "track"] as const, random) ?? "track"
    : "track";
  const candidates = weightedRandomOrder(
    kind === "album" ? albumCandidates : scopeAlbums,
    kind === "album" ? () => 1 : (album) => album.songCount,
    random,
  );
  for (const selectedAlbum of candidates.slice(0, SURPRISE_MAX_ATTEMPTS)) {
    if (!isActive()) return undefined;
    let tracks: readonly Track[] | undefined;
    try {
      tracks = await loadTracks(selectedAlbum);
    } catch {
      if (!isActive()) return undefined;
      continue;
    }
    if (!isActive()) return undefined;
    if (!tracks?.length) continue;
    if (kind === "album") {
      const [firstTrack, ...remainingTracks] = tracks;
      if (!firstTrack) continue;
      return {
        kind,
        album: selectedAlbum,
        queue: [firstTrack, ...remainingTracks],
      };
    }
    const selectedTrack = pickRandomItem(
      selectTracks(selectedAlbum, tracks),
      random,
    );
    if (selectedTrack) {
      return { kind, album: selectedAlbum, queue: [selectedTrack] };
    }
  }
  return undefined;
}
