import { ExternalLink } from "lucide-react";
import { memo } from "react";
import type { RadioChapter } from "./types";

export type RadioChapterLocalLinks = {
  track?: () => void;
  artist?: () => void;
  album?: () => void;
};

export const RadioChapterArtwork = memo(function RadioChapterArtwork({
  chapter,
  index,
}: {
  chapter: RadioChapter;
  index: number;
}) {
  const number = String(index + 1).padStart(2, "0");
  return (
    <span className="radio-chapter-artwork" aria-hidden="true">
      <span>{number}</span>
      {chapter.artworkUrl ? (
        <img
          src={chapter.artworkUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </span>
  );
});

export const RadioChapterCopy = memo(function RadioChapterCopy({
  chapter,
  className,
  onOpen,
  localLinks,
}: {
  chapter: RadioChapter;
  className: string;
  onOpen: (url: string) => void;
  localLinks?: RadioChapterLocalLinks;
}) {
  const openTrack = localLinks?.track ??
    (chapter.itemUrl ? () => onOpen(chapter.itemUrl!) : undefined);
  const openArtist = localLinks?.artist ??
    (chapter.artistUrl ? () => onOpen(chapter.artistUrl!) : undefined);
  const openAlbum = localLinks?.album ??
    (chapter.albumUrl ? () => onOpen(chapter.albumUrl!) : undefined);

  return (
    <div className={className}>
      {openTrack ? (
        <button
          className={`metadata-link radio-chapter-title-link ${
            localLinks?.track ? "is-local" : "is-external"
          }`}
          onClick={openTrack}
          aria-label={
            localLinks?.track
              ? `Find ${chapter.title} by ${chapter.artist} in Coda`
              : `Open ${chapter.title} by ${chapter.artist} on Bandcamp`
          }
          title={
            localLinks?.track
              ? "Open its release in Coda"
              : "Not in your library — open track on Bandcamp"
          }
        >
          {chapter.title}
          {!localLinks?.track ? <ExternalLink size={13} aria-hidden="true" /> : null}
        </button>
      ) : (
        <strong>{chapter.title}</strong>
      )}
      <span className="radio-chapter-byline">
        <span>by</span>
        {openArtist ? (
          <button
            className={`metadata-link radio-chapter-metadata-link ${
              localLinks?.artist ? "is-local" : "is-external"
            }`}
            onClick={openArtist}
            aria-label={
              localLinks?.artist
                ? `Open artist ${chapter.artist} in Coda`
                : `Open artist ${chapter.artist} on Bandcamp`
            }
            title={
              localLinks?.artist
                ? "Open artist in Coda"
                : "Not in your library — open artist on Bandcamp"
            }
          >
            {chapter.artist}
          </button>
        ) : (
          <span>{chapter.artist}</span>
        )}
        {chapter.album ? (
          <>
            <span aria-hidden="true">·</span>
            <span>from</span>
            {openAlbum ? (
              <button
                className={`metadata-link radio-chapter-metadata-link ${
                  localLinks?.album ? "is-local" : "is-external"
                }`}
                onClick={openAlbum}
                aria-label={
                  localLinks?.album
                    ? `Open album ${chapter.album} in Coda`
                    : `Open album ${chapter.album} on Bandcamp`
                }
                title={
                  localLinks?.album
                    ? "Open album in Coda"
                    : "Not in your library — open album on Bandcamp"
                }
              >
                {chapter.album}
              </button>
            ) : (
              <span>{chapter.album}</span>
            )}
          </>
        ) : null}
      </span>
    </div>
  );
});
