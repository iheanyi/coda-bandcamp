import {
  Airplay,
  ArrowLeft,
  Clock3,
  Dices,
  ExternalLink,
  Heart,
  ListMusic,
  ListPlus,
  Pause,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  memo,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DrawerTrigger } from "@/components/ui/drawer";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatTime, openBandcampUrl } from "./lib";
import { countLabel } from "./countLabel";
import {
  RadioChapterArtwork,
  RadioChapterCopy,
  type RadioChapterLocalLinks,
} from "./RadioChapterMetadata";
import {
  nextRadioChapterTimeInTimeline,
  previousRadioChapterTimeInTimeline,
  radioAiringIndexesAt,
  radioShowIdFromTrackId,
} from "./radioPlayback";
import { radioSeriesByTitle } from "./radioSeries";
import type { QueueRecommendation } from "./queueRecommendation";
import type { PlaybackClock } from "./playbackClock";
import type { RadioChapter, RepeatMode, Track } from "./types";

type NowPlayingViewProps = {
  track: Track;
  radioTimeline: readonly RadioChapter[];
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  playbackClock: PlaybackClock;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  artwork: ReactNode;
  airPlayAvailable: boolean;
  queueOpen: boolean;
  queueControlRef?: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onRepeat: () => void;
  onAirPlay: () => void;
  onArtist: (artist: string) => void;
  onAlbum: (track: Track) => void;
  albumLoading?: boolean;
  onPlayQueueIndex: (index: number) => void;
  onRadioSeries: (seriesId?: number) => void;
  recommendation?: QueueRecommendation;
  recommendationArtwork?: ReactNode;
  recommendationLoading: boolean;
  onPlayRecommendation: () => void;
  onAnotherRecommendation: () => void;
  getRadioChapterLocalLinks?: (chapter: RadioChapter) => RadioChapterLocalLinks;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  onAddToPlaylist?: () => void;
};

const UPCOMING_PREVIEW_LIMIT = 4;

function useCurrentRadioIndex(
  playbackClock: PlaybackClock,
  timeline: readonly RadioChapter[],
): number {
  const getCurrentIndex = useCallback(
    () =>
      radioAiringIndexesAt(timeline, playbackClock.getSnapshot()).currentIndex,
    [playbackClock, timeline],
  );
  return useSyncExternalStore(
    playbackClock.subscribe,
    getCurrentIndex,
    getCurrentIndex,
  );
}

const NowPlayingRadioSummary = memo(function NowPlayingRadioSummary({
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
  const currentIndex = useCurrentRadioIndex(playbackClock, timeline);
  const current = currentIndex >= 0 ? timeline[currentIndex] : undefined;
  const next = currentIndex + 1 < timeline.length
    ? timeline[currentIndex + 1]
    : undefined;

  if (current) {
    return (
      <section
        className="my-4 grid max-w-lg gap-1 rounded-lg border border-primary/25 bg-primary/10 p-4"
        aria-label="Currently airing on Bandcamp Radio"
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

const NowPlayingPlaybackControls = memo(function NowPlayingPlaybackControls({
  playbackClock,
  timeline,
  duration,
  playing,
  repeat,
  queueOpen,
  queueControlRef,
  canPrevious,
  canNext,
  onSeek,
  onRepeat,
  onPrevious,
  onToggle,
  onNext,
}: {
  playbackClock: PlaybackClock;
  timeline: readonly RadioChapter[];
  duration: number;
  playing: boolean;
  repeat: RepeatMode;
  queueOpen: boolean;
  queueControlRef?: RefObject<HTMLButtonElement | null>;
  canPrevious: boolean;
  canNext: boolean;
  onSeek: (value: number) => void;
  onRepeat: () => void;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
}) {
  const currentTime = useSyncExternalStore(
    playbackClock.subscribe,
    playbackClock.getSnapshot,
    playbackClock.getSnapshot,
  );
  const safeDuration = Math.max(0, duration);
  const remaining = Math.max(0, safeDuration - currentTime);
  const repeatLabel =
    repeat === "off"
      ? "Repeat off"
      : repeat === "all"
        ? "Repeat queue"
        : "Repeat current track";
  const positionCanPrevious =
    currentTime > 4 ||
    previousRadioChapterTimeInTimeline(timeline, currentTime) !== undefined;
  const positionCanNext =
    nextRadioChapterTimeInTimeline(timeline, currentTime) !== undefined;

  return (
    <>
      <div className="mt-12 max-xl:mt-7">
        <Slider
          className="**:data-[slot=slider-range]:bg-[#ebe8e1] **:data-[slot=slider-thumb]:size-3 **:data-[slot=slider-thumb]:opacity-100 **:data-[slot=slider-track]:h-1 **:data-[slot=slider-track]:bg-white/15"
          aria-label="Now playing position"
          min={0}
          max={safeDuration || 1}
          step={1}
          value={[Math.min(Math.max(0, currentTime), safeDuration || 1)]}
          onValueChange={(values) => onSeek(values[0] ?? 0)}
        />
        <div className="mt-2 flex justify-between text-xs text-[#8e918c] tabular-nums" aria-hidden="true">
          <span>{formatTime(currentTime)}</span>
          <span>−{formatTime(remaining)}</span>
        </div>
      </div>

      <div
        className="mt-5 grid grid-cols-[2.5rem_3rem_4rem_3rem_2.5rem] items-center justify-center gap-2 max-lg:grid-cols-[2rem_2.5rem_3.5rem_2.5rem_2rem] max-lg:gap-0.5"
        role="group"
        aria-label="Playback controls"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "justify-self-center text-[#7e817d]",
                  repeat !== "off" && "text-primary",
                )}
                onClick={onRepeat}
                aria-label={repeatLabel}
                aria-pressed={repeat !== "off"}
              />
            }
          >
            {repeat === "one"
              ? <Repeat1 className="size-5" size={20} />
              : <Repeat className="size-5" size={20} />}
          </TooltipTrigger>
          <TooltipContent>{repeatLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-11 justify-self-center text-[#dedcd6] max-lg:size-9"
                onClick={onPrevious}
                disabled={!canPrevious && !positionCanPrevious}
                aria-label="Previous"
              />
            }
          >
            <SkipBack className="size-6" size={24} fill="currentColor" />
          </TooltipTrigger>
          <TooltipContent>Previous</TooltipContent>
        </Tooltip>
        <Button
          variant="secondary"
          size="icon"
          className="size-16 justify-self-center rounded-full border-0 bg-[#f1eee7] text-[#141618] shadow-[0_14px_30px_rgba(0,0,0,0.27)] transition-[background-color,transform,box-shadow] duration-(--duration-coda-standard) ease-coda-enter hover:scale-[1.035] hover:bg-white hover:shadow-[0_16px_34px_rgba(0,0,0,0.32)] active:scale-[0.965] motion-reduce:transition-none max-lg:size-14"
          onClick={onToggle}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing
            ? <Pause className="size-7" size={29} fill="currentColor" />
            : <Play className="size-7" size={29} fill="currentColor" />}
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-11 justify-self-center text-[#dedcd6] max-lg:size-9"
                onClick={onNext}
                disabled={!canNext && !positionCanNext}
                aria-label="Next"
              />
            }
          >
            <SkipForward className="size-6" size={24} fill="currentColor" />
          </TooltipTrigger>
          <TooltipContent>Next</TooltipContent>
        </Tooltip>
        <Tooltip>
          <DrawerTrigger
            render={
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    ref={queueControlRef}
                    className={cn(
                      "justify-self-center text-[#7e817d]",
                      queueOpen && "text-primary",
                    )}
                    aria-label={queueOpen ? "Hide queue" : "Show queue"}
                    aria-pressed={queueOpen}
                  />
                }
              >
                <ListMusic className="size-5" size={20} />
              </TooltipTrigger>
            }
          />
          <TooltipContent>{queueOpen ? "Hide queue" : "Show queue"}</TooltipContent>
        </Tooltip>
      </div>
    </>
  );
});

const NowPlayingRadioTimeline = memo(function NowPlayingRadioTimeline({
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
  const currentIndex = useCurrentRadioIndex(playbackClock, timeline);
  const nextIndex = currentIndex + 1 < timeline.length
    ? currentIndex + 1
    : -1;

  if (!timeline.length) return null;

  return (
    <section
      className="now-playing__radio-timeline relative mx-auto mt-10 w-full max-w-5xl max-xl:max-w-xl"
      aria-labelledby="radio-timeline-heading"
    >
      <div className="mb-4 flex items-end justify-between gap-5 px-1">
        <div>
          <Badge variant="artwork" className="mb-1.5 h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase">
            Broadcast tracklist
          </Badge>
          <h2
            id="radio-timeline-heading"
            className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-lg/tight font-semibold text-[#deddd7]"
          >
            Songs in this show
          </h2>
        </div>
        <span className="text-xs text-[#777b76]">{countLabel(timeline.length, "chapter")}</span>
      </div>
      <ol
        className="relative m-0 grid max-h-[min(42vh,24rem)] scrollbar-thin [scrollbar-color:#3e4142_transparent] scrollbar-gutter-stable list-none gap-1 overflow-y-auto overscroll-contain rounded-lg bg-[rgba(13,15,17,0.66)] py-1.5 pr-2.5 pl-1.5"
        aria-label="Radio chapter timeline"
      >
        {timeline.map((chapter, index) => {
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
                <RadioChapterArtwork chapter={chapter} index={index} active={isCurrent} />
                <time className="text-xs tabular-nums">{formatTime(chapter.timecode)}</time>
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
                      "inline-flex size-2.5 items-end gap-px [&>i]:min-h-1 [&>i]:w-0.5 [&>i]:animate-[radio-equalizer_850ms_ease-in-out_infinite_alternate] [&>i]:rounded-sm [&>i]:bg-current [&>i]:motion-reduce:animate-none [&>i:nth-child(2)]:min-h-2 [&>i:nth-child(2)]:[animation-delay:-410ms] [&>i:nth-child(3)]:min-h-1.5 [&>i:nth-child(3)]:[animation-delay:-210ms]",
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
                <Badge variant="secondary" className="justify-self-end px-2 py-1 text-xs tracking-widest uppercase">
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

function NowPlayingViewComponent({
  track,
  radioTimeline,
  queue,
  currentIndex,
  playing,
  playbackClock,
  duration,
  volume,
  repeat,
  artwork,
  airPlayAvailable,
  queueOpen,
  queueControlRef,
  onBack,
  onToggle,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  onSeek,
  onVolume,
  onRepeat,
  onAirPlay,
  onArtist,
  onAlbum,
  albumLoading = false,
  onPlayQueueIndex,
  onRadioSeries,
  recommendation,
  recommendationArtwork,
  recommendationLoading,
  onPlayRecommendation,
  onAnotherRecommendation,
  getRadioChapterLocalLinks,
  favorite = false,
  onToggleFavorite,
  onAddToPlaylist,
}: NowPlayingViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [radioLinkError, setRadioLinkError] = useState("");
  const safeDuration = Math.max(0, duration);
  const upcoming = queue.slice(currentIndex + 1, currentIndex + 1 + UPCOMING_PREVIEW_LIMIT);
  const moreUpcoming = Math.max(0, queue.length - currentIndex - 1 - upcoming.length);
  const radioShowId = radioShowIdFromTrackId(track.id);
  const radioShowUrl = radioShowId
    ? `https://bandcamp.com/radio?show=${radioShowId}`
    : undefined;
  const radioSeries = radioShowUrl ? radioSeriesByTitle(track.album) : undefined;

  const openRadioChapter = useCallback((url: string) => {
    setRadioLinkError("");
    void openBandcampUrl(url).catch((cause) => {
      setRadioLinkError(String(cause).replace(/^Error:\s*/, ""));
    });
  }, []);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <article
      className="relative isolate min-h-full overflow-hidden bg-[linear-gradient(155deg,color-mix(in_srgb,var(--now-playing-base)_34%,#17191b),#111315_62%)] px-16 pt-6 pb-10 max-xl:px-6 max-lg:px-4 max-lg:pt-5 max-lg:pb-8"
      aria-labelledby="now-playing-heading"
      style={
        {
          "--now-playing-accent": track.palette[0],
          "--now-playing-base": track.palette[1],
        } as CSSProperties
      }
    >
      <div
        className="now-playing__wash pointer-events-none absolute inset-0 -z-1 bg-[radial-gradient(circle_at_20%_26%,color-mix(in_srgb,var(--now-playing-accent)_28%,transparent),transparent_37%),radial-gradient(circle_at_82%_8%,color-mix(in_srgb,var(--now-playing-base)_58%,transparent),transparent_35%)] opacity-80 saturate-75 after:absolute after:inset-0 after:bg-[linear-gradient(to_bottom,rgba(17,19,21,0.08),#111315_90%)] after:content-['']"
        aria-hidden="true"
      />
      <header className="now-playing__header relative z-1 mx-auto mb-7 flex max-w-5xl items-center justify-between max-xl:max-w-xl max-lg:mb-5">
        <Button
          variant="secondary"
          size="compact"
          className="h-8 gap-2 rounded-lg border-white/7 bg-white/2.5 px-2.5 text-xs text-muted-foreground transition-[color,border-color,background-color,transform] hover:border-white/15 hover:bg-white/6 hover:text-foreground active:translate-y-px motion-reduce:transition-none"
          onClick={onBack}
          aria-label="Back"
          title="Back to previous view"
        >
          <ArrowLeft size={17} strokeWidth={2.2} />
          Back
        </Button>
        <Badge
          variant="artwork"
          className="gap-2 border-0 bg-transparent p-0 text-xs tracking-widest text-[#a7aaa4] uppercase"
          role="status"
          aria-live="polite"
        >
          <i
            className={cn(
              "relative block size-1.5 shrink-0 rounded-full bg-(--now-playing-accent) shadow-[0_0_0_4px_color-mix(in_srgb,var(--now-playing-accent)_13%,transparent)] after:absolute after:inset-0 after:rounded-full after:bg-(--now-playing-accent) after:content-['']",
              playing &&
                "after:animate-[now-playing-status-pulse_1.8s_var(--ease-coda-enter)_infinite] after:motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
          {playing ? "Playing now" : "Paused"}
        </Badge>
      </header>

      <div className="relative mx-auto grid w-full max-w-5xl grid-cols-[minmax(15rem,24rem)_minmax(17rem,1fr)] items-center gap-16 max-xl:max-w-xl max-xl:grid-cols-1 max-xl:gap-6">
        <div className="now-playing__artwork aspect-square w-full drop-shadow-[0_32px_44px_rgba(0,0,0,0.42)] **:data-[cover-size=large]:size-full **:data-[cover-size=large]:rounded-xl **:data-[cover-size=large]:border **:data-[cover-size=large]:border-white/10 **:data-[cover-size=large]:shadow-none max-xl:mx-auto max-xl:w-64 max-lg:w-52">
          {artwork}
        </div>
        <section className="now-playing__details min-w-0 max-xl:text-center" aria-label="Current track">
          <h1
            id="now-playing-heading"
            ref={headingRef}
            className={cn(
              "m-0 max-w-3xl font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-6xl/tight font-bold tracking-tighter text-balance text-[#f5f2eb] outline-none max-xl:text-5xl max-lg:text-3xl",
              track.title.length > 32 && "text-5xl leading-none max-xl:text-4xl max-lg:text-3xl",
            )}
            title={track.title}
            tabIndex={-1}
          >
            {radioShowUrl ? (
              <Button
                variant="text"
                size="compact"
                className="group/show tracking-inherit inline-flex h-auto max-w-full items-baseline gap-1 overflow-hidden p-0 text-left text-inherit [font:inherit] hover:bg-transparent hover:text-inherit"
                onClick={() => openRadioChapter(radioShowUrl)}
                aria-label={`Open ${track.title} on Bandcamp Radio`}
                title="Open show on Bandcamp Radio"
              >
                <span className="truncate">{track.title}</span>
                <ExternalLink className="size-5 shrink-0 text-[#858984] transition-[color,transform] duration-(--duration-coda-standard) ease-coda-enter group-hover/show:translate-x-0.5 group-hover/show:-translate-y-0.5 group-hover/show:text-(--now-playing-accent) motion-reduce:transition-none" aria-hidden="true" />
              </Button>
            ) : (
              track.title
            )}
          </h1>
          <div className="mt-4 flex min-w-0 items-center gap-2 text-[#696d68] max-xl:justify-center">
            {radioShowUrl ? (
              <>
                <Button
                  variant="text"
                  size="compact"
                  className="h-auto max-w-[46%] truncate p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary hover:underline"
                  onClick={() => onRadioSeries()}
                >
                  Bandcamp Radio
                </Button>
                <span aria-hidden="true">·</span>
                <Button
                  variant="text"
                  size="compact"
                  className="h-auto max-w-[46%] truncate p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary hover:underline"
                  onClick={() => onRadioSeries(radioSeries?.id)}
                >
                  {track.album}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="text"
                  size="compact"
                  className="h-auto max-w-[46%] truncate p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary hover:underline"
                  onClick={() => onArtist(track.artist)}
                >
                  {track.artist}
                </Button>
                <span aria-hidden="true">·</span>
                <Button
                  variant="text"
                  size="compact"
                  className="h-auto max-w-[46%] truncate p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary hover:underline"
                  onClick={() => onAlbum(track)}
                  aria-busy={albumLoading}
                  aria-label={albumLoading ? `Loading album ${track.album}` : undefined}
                  disabled={albumLoading}
                >
                  {albumLoading ? (
                    <Spinner
                      aria-label={`Loading album ${track.album}`}
                      className="size-3 shrink-0 text-current motion-reduce:animate-none"
                    />
                  ) : null}
                  {track.album}
                </Button>
              </>
            )}
          </div>
          {radioTimeline.length ? (
            <NowPlayingRadioSummary
              playbackClock={playbackClock}
              timeline={radioTimeline}
              onOpen={openRadioChapter}
              getLocalLinks={getRadioChapterLocalLinks}
            />
          ) : null}
          <div className="mt-3.5 flex items-center gap-2 text-xs text-[#7d817b] max-xl:justify-center max-lg:flex-wrap">
            <span className="inline-flex items-center gap-1 after:ml-2 after:text-[#505450] after:content-['·']">Track {track.track}</span>
            <span className="inline-flex items-center gap-1 after:ml-2 after:text-[#505450] after:content-['·']"><Clock3 size={13} /> {formatTime(safeDuration)}</span>
            <span className="inline-flex items-center gap-1">{countLabel(queue.length - currentIndex - 1, "track")} next</span>
          </div>
          {(
            onToggleFavorite ||
            (!track.id.startsWith("radio:") && onAddToPlaylist)
          ) ? (
            <div className="mt-2.5 flex gap-2 max-xl:justify-center">
              {onToggleFavorite ? (
                <Button
                  variant="text"
                  size="compact"
                  className={cn("bg-white/2.5 px-2", favorite && "text-[#ef8066]")}
                  onClick={onToggleFavorite}
                  aria-pressed={favorite}
                >
                  <Heart size={15} fill={favorite ? "currentColor" : "none"} />
                  {favorite ? "Favorited" : "Favorite"}
                </Button>
              ) : null}
              {!track.id.startsWith("radio:") && onAddToPlaylist ? (
                <Button variant="text" size="compact" className="bg-white/2.5 px-2" onClick={onAddToPlaylist}>
                  <ListPlus size={15} /> Add to playlist
                </Button>
              ) : null}
            </div>
          ) : null}

          <NowPlayingPlaybackControls
            playbackClock={playbackClock}
            timeline={radioTimeline}
            duration={safeDuration}
            playing={playing}
            repeat={repeat}
            queueOpen={queueOpen}
            queueControlRef={queueControlRef}
            canPrevious={canPrevious}
            canNext={canNext}
            onSeek={onSeek}
            onRepeat={onRepeat}
            onPrevious={onPrevious}
            onToggle={onToggle}
            onNext={onNext}
          />

          <div className="mt-4 flex items-center justify-center gap-1">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onVolume(volume ? 0 : 0.72)}
                    aria-label={volume ? "Mute" : "Unmute"}
                  />
                }
              >
                {volume
                  ? <Volume2 className="size-5" size={19} />
                  : <VolumeX className="size-5" size={19} />}
              </TooltipTrigger>
              <TooltipContent>{volume ? "Mute" : "Unmute"}</TooltipContent>
            </Tooltip>
            <Slider
              className="mr-3 data-horizontal:w-28 max-lg:data-horizontal:w-20"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.01}
              value={[volume]}
              onValueChange={(values) => onVolume(values[0] ?? 0)}
            />
            {airPlayAvailable ? (
              <Button
                variant="secondary"
                size="compact"
                className="h-auto px-2 py-1.5 text-xs text-muted-foreground"
                onClick={onAirPlay}
                title="Choose AirPlay device"
                aria-label="Choose AirPlay device"
              >
                <Airplay size={17} />
                AirPlay
              </Button>
            ) : null}
          </div>
        </section>
      </div>

      <NowPlayingRadioTimeline
        playbackClock={playbackClock}
        timeline={radioTimeline}
        playing={playing}
        radioLinkError={radioLinkError}
        onSeek={onSeek}
        onOpen={openRadioChapter}
        getLocalLinks={getRadioChapterLocalLinks}
      />

      <section
        className="now-playing__up-next relative mx-auto mt-16 w-full max-w-5xl border-t border-white/8 pt-5 max-xl:max-w-xl max-lg:mt-8"
        aria-labelledby="up-next-heading"
      >
        <div className="mb-3 flex items-end justify-between gap-5 max-lg:flex-col max-lg:items-start max-lg:gap-2">
          <div>
            <Badge variant="artwork" className="mb-1 h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase">
              {upcoming.length ? "In this session" : "Queue complete"}
            </Badge>
            <h2 id="up-next-heading" className="m-0 text-base/tight font-semibold tracking-tight text-[#dfddd7]">
              {upcoming.length ? "Up next" : "Keep listening"}
            </h2>
          </div>
        </div>
        {upcoming.length ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 max-xl:grid-cols-1">
            {upcoming.map((item, index) => {
              const queueIndex = currentIndex + index + 1;
              return (
                <Button
                  variant="ghost"
                  size="compact"
                  className="grid h-auto min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-white/4"
                  key={`${item.id}-${queueIndex}`}
                  onClick={() => onPlayQueueIndex(queueIndex)}
                  aria-label={`Play ${item.title}`}
                >
                  <span className="text-xs font-normal text-[#686c67] tabular-nums">
                    {String(queueIndex + 1).padStart(2, "0")}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                    <strong className="truncate text-xs/snug text-[#d4d3cd]">{item.title}</strong>
                    <small className="truncate text-xs font-normal text-[#737772]">{item.artist} · {item.album}</small>
                  </span>
                  <span className="text-xs font-normal text-[#686c67] tabular-nums">{formatTime(item.duration)}</span>
                </Button>
              );
            })}
          </div>
        ) : recommendation ? (
          <div className="grid min-h-20 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3.5 rounded-lg border border-white/7 bg-[radial-gradient(circle_at_0_0,rgba(221,101,73,0.1),transparent_42%),rgba(255,255,255,0.025)] p-3 max-lg:grid-cols-[3rem_minmax(0,1fr)]">
            <div className="size-14 overflow-hidden rounded-lg **:data-[slot=cover]:size-full max-lg:size-12">
              {recommendationArtwork}
            </div>
            <div className="flex min-w-0 flex-col overflow-hidden">
              <span className="text-xs font-bold tracking-widest text-[#d37e68] uppercase">
                Picked from your collection
              </span>
              <strong className="mt-1 truncate text-sm text-[#e2e0da]">{recommendation.album.title}</strong>
              <small className="mt-1 truncate text-xs text-[#777b76]">
                {recommendation.album.artist} · {recommendation.reason}
              </small>
            </div>
            <div className="flex items-center gap-2 max-lg:col-span-full">
              <Button
                variant="primary"
                size="compact"
                className="h-8 px-2.5"
                onClick={onPlayRecommendation}
                disabled={recommendationLoading}
                aria-label={`Play something from ${recommendation.album.title}`}
              >
                {recommendationLoading ? (
                  <Spinner aria-hidden="true" className="size-4 text-current motion-reduce:animate-none" />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
                {recommendationLoading ? "Picking…" : "Play something"}
              </Button>
              <Button
                size="compact"
                className="h-8 px-2.5"
                onClick={onAnotherRecommendation}
                disabled={recommendationLoading}
              >
                <Dices size={15} />
                Another pick
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-start gap-1 rounded-lg bg-white/2.5 p-4 text-xs text-[#747873]">
            <strong className="text-xs text-[#c9c8c2]">You reached the end.</strong>
            <span className="text-xs text-[#717570]">Open the queue or browse your collection to keep listening.</span>
          </div>
        )}
        {moreUpcoming ? (
          <span className="mt-2 block text-right text-xs text-[#747873]">{moreUpcoming} more in the full queue</span>
        ) : null}
      </section>
    </article>
  );
}

export const NowPlayingView = memo(NowPlayingViewComponent);
