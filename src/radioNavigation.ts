import { artistKey } from "./libraryBrowse";
import type { Album, RadioChapter } from "./types";

function metadataKey(value: string | undefined): string {
  return value?.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US") ?? "";
}

export type RadioChapterLibraryTargets = {
  artist?: string;
  album?: Album;
};

export function resolveRadioChapterLibraryTargets(
  chapter: RadioChapter,
  albums: readonly Album[],
): RadioChapterLibraryTargets {
  const chapterArtist = artistKey(chapter.artist);
  const chapterAlbum = metadataKey(chapter.album);
  const chapterTitle = metadataKey(chapter.title);
  const artistAlbum = albums.find(
    (album) => artistKey(album.artist) === chapterArtist,
  );
  const exactAlbum = chapterAlbum
    ? albums.find(
        (album) =>
          metadataKey(album.title) === chapterAlbum &&
          artistKey(album.artist) === chapterArtist,
      )
    : undefined;
  const trackAlbum = albums.find((album) =>
    album.tracks?.some(
      (track) =>
        metadataKey(track.title) === chapterTitle &&
        artistKey(track.artist) === chapterArtist,
    ),
  );

  return {
    artist: artistAlbum?.artist,
    album: exactAlbum ?? trackAlbum,
  };
}
