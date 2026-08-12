import { memo, useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import type { RadioChapter } from "@/types";

export type QueueRadioChaptersProps = {
  chapters: readonly RadioChapter[] | undefined;
  currentChapterIndex: number;
  nextChapterIndex: number;
  open: boolean;
  onSeek: (position: number) => void;
  className?: string;
};

export const QueueRadioChapters = memo(function QueueRadioChapters({
  chapters,
  currentChapterIndex,
  nextChapterIndex,
  open,
  onSeek,
  className,
}: QueueRadioChaptersProps) {
  const currentChapterRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open && currentChapterIndex >= 0) {
      currentChapterRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [chapters, currentChapterIndex, open]);

  if (!chapters?.length) return null;

  return (
    <section
      className={cn("mt-3 border-t border-white/[0.07] pt-2.5", className)}
      aria-label="Show chapters"
    >
      <header className="flex items-center justify-between px-1 pb-2 text-coda-micro font-bold tracking-widest text-[#8d918b] uppercase">
        <span>Show chapters</span>
        <span className="text-[#686d68] tabular-nums">{chapters.length}</span>
      </header>
      <ol className="m-0 max-h-[min(16rem,30vh)] list-none overflow-x-hidden overflow-y-auto px-0.5 pb-0.5 overscroll-contain [scrollbar-color:#3b3e3f_transparent] scrollbar-thin">
        {chapters.map((chapter, chapterIndex) => {
          const isCurrent = chapterIndex === currentChapterIndex;
          const isNext = chapterIndex === nextChapterIndex;
          return (
            <li
              className="[contain-intrinsic-size:48px] [content-visibility:auto]"
              key={`${chapter.timecode}-${chapter.artist}-${chapter.title}-${chapterIndex}`}
            >
              <Button
                className={`grid h-auto min-h-12 w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-inherit transition-colors duration-(--duration-coda-fast) hover:bg-white/4.5 focus-visible:-outline-offset-2 focus-visible:outline-primary/60 ${
                  isCurrent ? "bg-primary/10" : ""
                }`}
                ref={isCurrent ? currentChapterRef : undefined}
                onClick={() => onSeek(chapter.timecode)}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={`Seek to ${chapter.title} at ${formatTime(chapter.timecode)}`}
                size="compact"
                variant="text"
              >
                <time className="text-coda-micro text-coda-subtle-foreground tabular-nums">
                  {formatTime(chapter.timecode)}
                </time>
                <span className="flex min-w-0 flex-col gap-1">
                  <strong
                    className={`truncate text-coda-meta font-semibold ${isCurrent ? "text-[#f0e8e2]" : isNext ? "text-[#c5c5bf]" : "text-[#d5d4ce]"}`}
                  >
                    {chapter.title}
                  </strong>
                  <small className="truncate text-coda-micro font-normal text-[#747873]">
                    {chapter.artist}
                    {chapter.album ? ` · ${chapter.album}` : ""}
                  </small>
                </span>
                {isCurrent ? (
                  <Badge
                    className="rounded-full bg-primary/15 text-(length:--text-coda-micro) font-bold tracking-widest text-[#e39582] uppercase"
                    size="compact"
                  >
                    On air
                  </Badge>
                ) : isNext ? (
                  <Badge
                    className="rounded-full bg-white/4.5 text-(length:--text-coda-micro) font-bold tracking-widest text-[#858984] uppercase"
                    size="compact"
                  >
                    Next
                  </Badge>
                ) : null}
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
