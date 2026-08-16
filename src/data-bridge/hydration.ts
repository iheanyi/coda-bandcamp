import { normalizeGenre } from "../genres";
import type { Album, Track } from "../types";

const palettes: [string, string][] = [
  ["#cf6046", "#2f2624"],
  ["#d6a84d", "#313025"],
  ["#5f8a80", "#1e302f"],
  ["#9e6a91", "#30252e"],
  ["#6d7fa8", "#222936"],
  ["#b97653", "#33271f"],
  ["#66845d", "#243024"],
  ["#8e6d4b", "#332b24"],
];

export function paletteFor(id: string): [string, string] {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return palettes[hash % palettes.length];
}

export function hydrateAlbum(album: Omit<Album, "palette">): Album {
  return {
    ...album,
    genre: normalizeGenre(album.genre),
    palette: paletteFor(album.id),
  };
}

export function hydrateTrack(
  track: Omit<Track, "palette">,
  fallbackPalette?: [string, string],
): Track {
  return {
    ...track,
    palette: fallbackPalette ?? paletteFor(track.albumId || track.id),
  };
}
