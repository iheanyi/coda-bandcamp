import {
  memo,
  startTransition,
  useEffect,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { countLabel } from "@/countLabel";
import { useCurrentRadioChapter } from "@/features/player/playbackClockHooks";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import type { PlaybackClock } from "@/playbackClock";
import {
  RadioChapterArtwork,
  RadioChapterCopy,
  type RadioChapterLocalLinks,
} from "@/RadioChapterMetadata";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import type { RadioChapter } from "@/types";

const RADIO_TIMELINE_INITIAL_LIMIT = 6;
const RADIO_TIMELINE_BATCH_SIZE = 12;

export const NowPlayingRadioSummary = memo(function NowPlayingRadioSummary({
  playbackClock,
  timeline,
  onOpen,
  getLocalLinks,
}: {
  playbackClock: PlaybackClock;
  timeline: readonly RadioChapter[];
  onOpen: (url: string) => void;
  getLocalLinks?: (chapter: RadioChapter) => RadioChapterLocalLinks;
}) {
  const { current, next } = useCurrentRadioChapter(playbackClock, timeline);

  if (current) {
    return (
      <section
        className="my-4 grid max-w-lg gap-1 rounded-lg border border-primary/25 bg-primary/10 p-4"
        aria-label={`Currently airing on ${BANDCAMP_RADIO_PROVIDER}`}
        aria-live="polite"
        aria-atomic="true"
      >
        <Badge
          variant="artwork"
          className="mb-0.5 h-auto border-0 bg-transparent p-0 text-xs tracking-widest text-[#d47761] uppercase"
        >
          On air now
        </Badge>
        <RadioChapterCopy
          chapter={current}
          className="min-w-0 gap-1 [&>button:first-child]:text-base [&>span:last-child]:text-sm [&>span:last-child]:text-[#a9aaa5] [&>strong:first-child]:text-base"
          onOpen={onOpen}
          localLinks={getLocalLinks?.(current)}
        />
        {next ? (
          <small className="mt-2 truncate border-t border-white/7 pt-2 text-xs text-[#777c77]">
            Up next: {next.title} by {next.artist}
          </small>
        ) : null}
      </section>
    );
  }

  return next ? (
    <p className="mt-4 mb-0 text-sm text-[#989b96]" aria-live="polite">
      Up next: {next.title} by {next.artist}
    </p>
  ) : null;
});

export const NowPlayingRadioTimeline = memo(function NowPlayingRadioTimeline({
  playbackClock,
  timeline,
  playing,
  radioLinkError,
  onSeek,
  onOpen,
  getLocalLinks,
}: {
  playbackClock: PlaybackClock;
  timeline: readonly RadioChapter[];
  playing: boolean;
  radioLinkError: string;
  onSeek: (value: number) => void;
  onOpen: (url: string) => void;
  getLocalLinks?: (chapter: RadioChapter) => RadioChapterLocalLinks;
}) {
  const { currentIndex, nextIndex } = useCurrentRadioChapter(
    playbackClock,
    timeline,
  );
  const [renderedCount, setRenderedCount] = useState(() =>
    Math.min(RADIO_TIMELINE_INITIAL_LIMIT, timeline.length),
  );
  useEffect(() => {
    if (renderedCount >= timeline.length) return;
    const timeout = window.setTimeout(() => {
      startTransition(() => {
        setRenderedCount((current) =>
          Math.min(current + RADIO_TIMELINE_BATCH_SIZE, timeline.length),
        );
      });
    }, 16);
    return () => window.clearTimeout(timeout);
  }, [renderedCount, timeline.length]);

  if (!timeline.length) return null;

  return (
    <section
      className="now-playing__radio-timeline relative mx-auto mt-10 w-full max-w-5xl max-xl:max-w-xl"
      aria-labelledby="radio-timeline-heading"
    >
      <div className="mb-4 flex items-end justify-between gap-5 px-1">
        <div>
          <Badge
            variant="artwork"
            className="mb-1.5 h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase"
          >
            Broadcast tracklist
          </Badge>
          <h2
            id="radio-timeline-heading"
            className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-lg/tight font-semibold text-[#deddd7]"
          >
            Songs in this show
          </h2>
        </div>
        <span className="text-xs text-coda-subtle-foreground">
          {countLabel(timeline.length, "chapter")}
        </span>
      </div>
      <ol
        className="relative m-0 grid max-h-[min(42vh,24rem)] scrollbar-thin [scrollbar-color:#3e4142_transparent] scrollbar-gutter-stable list-none gap-1 overflow-y-auto overscroll-contain rounded-lg bg-[rgba(13,15,17,0.66)] py-1.5 pr-2.5 pl-1.5"
        aria-label="Radio chapter timeline"
        aria-busy={renderedCount < timeline.length || undefined}
      >
        {timeline.slice(0, renderedCount).map((chapter, index) => {
          const isCurrent = index === currentIndex;
          const isNext = index === nextIndex;
          return (
            <li
              className={cn(
                "relative grid min-h-16 grid-cols-[6.5rem_minmax(0,1fr)_5rem] items-center gap-3.5 rounded-lg px-3.5 py-2 transition-[background-color,box-shadow] duration-(--duration-coda-fast) [contain-intrinsic-size:4rem] [content-visibility:auto] hover:bg-white/3 motion-reduce:transition-none max-lg:grid-cols-[6rem_minmax(0,1fr)_3rem] max-lg:pr-2",
                isCurrent &&
                  "bg-[color-mix(in_srgb,var(--now-playing-accent)_11%,rgba(24,26,28,0.94))] shadow-[0_8px_24px_color-mix(in_srgb,var(--now-playing-accent)_7%,transparent)]",
                isNext && "bg-white/2",
              )}
              key={`${chapter.timecode}-${chapter.artist}-${chapter.title}-${index}`}
              aria-current={isCurrent ? "true" : undefined}
            >
              <Button
                variant="text"
                size="compact"
                className="grid h-auto min-h-9 grid-cols-[2.5rem_1fr] items-center gap-2 rounded-lg py-0 pr-2.5 pl-0 text-[#7c807b] hover:bg-white/4 hover:text-[#dddcd6]"
                onClick={() => onSeek(chapter.timecode)}
                aria-label={`Seek to ${chapter.title} at ${formatTime(chapter.timecode)}`}
                title={`Play from ${formatTime(chapter.timecode)}`}
              >
                <RadioChapterArtwork
                  chapter={chapter}
                  index={index}
                  active={isCurrent}
                />
                <time className="text-xs tabular-nums">
                  {formatTime(chapter.timecode)}
                </time>
              </Button>
              <RadioChapterCopy
                chapter={chapter}
                className="min-w-0"
                onOpen={onOpen}
                localLinks={getLocalLinks?.(chapter)}
              />
              {isCurrent ? (
                <Badge
                  variant="artwork"
                  className="justify-self-end border-0 bg-[color-mix(in_srgb,var(--now-playing-accent)_17%,transparent)] px-2 py-1 text-xs tracking-widest text-[color-mix(in_srgb,var(--now-playing-accent)_72%,#f4eee8)] uppercase"
                >
                  <i
                    className={cn(
                      "inline-flex size-2.5 items-end gap-px [&>i]:h-[9px] [&>i]:w-0.5 [&>i]:origin-bottom [&>i]:animate-[radio-equalizer_850ms_ease-in-out_infinite_alternate] [&>i]:rounded-sm [&>i]:bg-current [&>i]:[transform:scaleY(0.444444)] [&>i]:motion-reduce:animate-none [&>i:nth-child(2)]:[animation-delay:-410ms] [&>i:nth-child(2)]:[transform:scaleY(0.888889)] [&>i:nth-child(3)]:[animation-delay:-210ms] [&>i:nth-child(3)]:[transform:scaleY(0.666667)]",
                      !playing && "[&>i]:paused",
                    )}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </i>
                  On air
                </Badge>
              ) : isNext ? (
                <Badge
                  variant="secondary"
                  className="justify-self-end px-2 py-1 text-xs tracking-widest uppercase"
                >
                  Up next
                </Badge>
              ) : null}
            </li>
          );
        })}
      </ol>
      {radioLinkError ? (
        <p className="mt-2.5 text-xs text-[#d28070]" role="status">
          {radioLinkError}
        </p>
      ) : null}
    </section>
  );
});
