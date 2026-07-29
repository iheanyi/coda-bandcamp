import { ExternalLink } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { RadioChapter } from "./types";

export type RadioChapterLocalLinks = {
  track?: () => void;
  artist?: () => void;
  album?: () => void;
};

export const RadioChapterArtwork = memo(function RadioChapterArtwork({
  chapter,
  index,
  active = false,
}: {
  chapter: RadioChapter;
  index: number;
  active?: boolean;
}) {
  const number = String(index + 1).padStart(2, "0");
  return (
    <span
      className={cn(
        "relative grid size-10 shrink-0 place-items-center justify-self-center overflow-hidden rounded-md border border-white/7 bg-[#232628] text-xs text-[#858984] tabular-nums",
        active &&
          "border-primary/42 shadow-[0_0_0_1px_rgba(221,101,73,0.08)]",
      )}
      aria-hidden="true"
    >
      <span>{number}</span>
      {chapter.artworkUrl ? (
        <img
          className="absolute inset-0 size-full object-cover"
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
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {openTrack ? (
        <Button
          variant="text"
          size="compact"
          className="h-auto w-fit max-w-full justify-start gap-1.5 overflow-hidden p-0 text-left text-xs/tight font-semibold text-[#deddd7] hover:bg-transparent hover:text-[#ee927b]"
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
          <span className="truncate">{chapter.title}</span>
          {!localLinks?.track ? (
            <ExternalLink className="size-3 shrink-0 text-[#777b76]" aria-hidden="true" />
          ) : null}
        </Button>
      ) : (
        <strong className="w-fit max-w-full truncate text-xs/tight font-semibold text-[#d8d7d1]">
          {chapter.title}
        </strong>
      )}
      <span className="flex min-w-0 items-baseline gap-1 overflow-hidden text-xs text-[#7d817c]">
        <span className="shrink-0">by</span>
        {openArtist ? (
          <Button
            variant="text"
            size="compact"
            className={cn(
              "h-auto max-w-2/5 shrink-0 truncate p-0 text-xs font-semibold text-[#999c96] hover:bg-transparent hover:text-[#e58b74]",
              localLinks?.artist && "hover:text-[#dadbd5]",
            )}
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
            {!localLinks?.artist ? (
              <span className="ml-0.5 text-[#686d68]" aria-hidden="true">↗</span>
            ) : null}
          </Button>
        ) : (
          <span className="max-w-2/5 shrink-0 truncate">{chapter.artist}</span>
        )}
        {chapter.album ? (
          <>
            <span className="shrink-0" aria-hidden="true">·</span>
            <span className="shrink-0">from</span>
            {openAlbum ? (
              <Button
                variant="text"
                size="compact"
                className={cn(
                  "h-auto max-w-2/5 shrink-0 truncate p-0 text-xs font-semibold text-[#999c96] hover:bg-transparent hover:text-[#e58b74]",
                  localLinks?.album && "hover:text-[#dadbd5]",
                )}
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
                {!localLinks?.album ? (
                  <span className="ml-0.5 text-[#686d68]" aria-hidden="true">↗</span>
                ) : null}
              </Button>
            ) : (
              <span className="max-w-2/5 shrink-0 truncate">{chapter.album}</span>
            )}
          </>
        ) : null}
      </span>
    </div>
  );
});
