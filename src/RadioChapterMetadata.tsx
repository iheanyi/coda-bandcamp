import { ExternalLink } from "lucide-react";
import { memo } from "react";
import type { RadioChapter } from "./types";

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
}: {
  chapter: RadioChapter;
  className: string;
  onOpen: (url: string) => void;
}) {
  return (
    <div className={className}>
      {chapter.itemUrl ? (
        <button
          className="metadata-link radio-chapter-title-link"
          onClick={() => onOpen(chapter.itemUrl!)}
          aria-label={`Open ${chapter.title} by ${chapter.artist} on Bandcamp`}
          title="Open track on Bandcamp"
        >
          {chapter.title}
          <ExternalLink size={13} aria-hidden="true" />
        </button>
      ) : (
        <strong>{chapter.title}</strong>
      )}
      <span className="radio-chapter-byline">
        <span>by</span>
        {chapter.artistUrl ? (
          <button
            className="metadata-link radio-chapter-metadata-link"
            onClick={() => onOpen(chapter.artistUrl!)}
            aria-label={`Open artist ${chapter.artist} on Bandcamp`}
            title="Open artist on Bandcamp"
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
            {chapter.albumUrl ? (
              <button
                className="metadata-link radio-chapter-metadata-link"
                onClick={() => onOpen(chapter.albumUrl!)}
                aria-label={`Open album ${chapter.album} on Bandcamp`}
                title="Open album on Bandcamp"
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
