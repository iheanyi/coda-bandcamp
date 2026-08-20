import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  Clock3,
  ExternalLink,
  Heart,
  ListMusic,
  ListPlus,
  Radio,
} from "lucide-react";
import {
  memo,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { RetryButton } from "@/components/ui/retry-button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { countLabel } from "@/countLabel";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import type { PlaybackClock } from "@/playbackClock";
import { RadioChapterArtwork, RadioChapterCopy } from "@/RadioChapterMetadata";
import { radioSeriesForShow } from "@/radioIdentity";
import { radioAiringIndexesAt } from "@/radioPlayback";
import { radioEpisodeUrl } from "@/radioSeries";
import { radioTrackFromShow } from "@/radioTrack";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  stringifyRadioSeriesIdParam,
  type RadioSeriesId,
} from "@/routing/routeContracts";
import type { RadioShow, RadioShowSummary, Track } from "@/types";

import { RadioArtwork } from "./RadioArtwork";
import { showDate } from "./radioPresentationFormatting";
import { radioSeriesId } from "./radioRouteIds";
import { RadioSeriesLink } from "./RadioSeriesNavigation";
import { RadioShowBackButton } from "./RadioShowBackButton";

export const RadioDetail = memo(function RadioDetail({
  show,
  details,
  loading,
  loadError,
  retrying,
  actionError,
  onBack,
  onRetry,
  onPlay,
  onQueue,
  onPlayAt,
  currentTrackId,
  playbackClock,
  playing,
  onTogglePlayback,
  onOpenItem,
  favorite,
  onToggleFavorite,
  onBrowseSeries,
}: {
  show: RadioShowSummary;
  details?: RadioShow;
  loading: boolean;
  loadError?: string;
  retrying: boolean;
  actionError: string;
  onBack: () => void;
  onRetry: () => void;
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onPlayAt?: (track: Track, position: number) => void;
  currentTrackId?: string;
  playbackClock: PlaybackClock;
  playing: boolean;
  onTogglePlayback: () => void;
  onOpenItem: (url: string) => void;
  favorite: boolean;
  onToggleFavorite: (show: RadioShowSummary) => void;
  onBrowseSeries: (seriesId?: RadioSeriesId) => void;
}) {
  const track = useMemo(
    () => (details ? radioTrackFromShow(details) : undefined),
    [details],
  );
  const chapters = useMemo(() => track?.radioChapters ?? [], [track]);
  const activeShow = currentTrackId === `radio:${show.id}`;
  const getCurrentChapterIndex = useCallback(
    () =>
      activeShow
        ? radioAiringIndexesAt(chapters, playbackClock.getSnapshot())
            .currentIndex
        : -1,
    [activeShow, chapters, playbackClock],
  );
  const currentChapterIndex = useSyncExternalStore(
    playbackClock.subscribe,
    getCurrentChapterIndex,
    getCurrentChapterIndex,
  );
  const currentChapter =
    currentChapterIndex >= 0 ? chapters[currentChapterIndex] : undefined;
  const seriesId = radioSeriesId(radioSeriesForShow(details ?? show)?.id);

  return (
    <section
      className="mx-auto w-full max-w-5xl pt-2 pb-12"
      aria-labelledby="radio-detail-title"
    >
      <RadioShowBackButton onBack={onBack} />
      <div data-coda-radio-detail-surface>
        <header className="grid min-h-76 grid-cols-[16rem_minmax(0,1fr)] items-center gap-12 overflow-hidden rounded-xl border border-(--line) bg-[radial-gradient(circle_at_78%_5%,rgba(221,101,73,0.15),transparent_40%),linear-gradient(140deg,#25292b,#181b1d_72%)] p-8 max-xl:min-h-64 max-xl:grid-cols-[12rem_minmax(0,1fr)] max-xl:gap-6 max-xl:p-6 max-lg:min-h-48 max-lg:grid-cols-[8rem_minmax(0,1fr)] max-lg:gap-4 max-lg:p-5">
          <div className="aspect-square w-64 drop-shadow-[0_22px_30px_rgba(0,0,0,0.32)] max-xl:w-48 max-lg:w-32 [&>div]:size-full">
            <RadioArtwork show={show} eager detail />
          </div>
          <div className="min-w-0" data-coda-radio-metadata-detail>
            <Badge
              variant="artwork"
              className="h-auto gap-1.5 border-0 bg-transparent p-0 text-xs tracking-widest text-[#d47761] uppercase"
            >
              <Radio size={13} />
              <RadioSeriesLink show={show} onBrowse={onBrowseSeries} />
            </Badge>
            <h1
              id="radio-detail-title"
              className="m-0 max-w-2xl font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-5xl/tight font-semibold tracking-tighter text-balance text-[#f3f0ea] outline-none max-lg:text-3xl"
              tabIndex={-1}
            >
              <span
                className="inline-block max-w-full align-top"
                data-coda-radio-title-detail={show.id}
              >
                {show.subtitle}
              </span>
            </h1>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-[#b0b2ac]">
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={13} /> {showDate(show.publishedAt)}
              </span>
              {details ? (
                <>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 size={13} /> {formatTime(details.duration)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <ListMusic size={13} />{" "}
                    {countLabel(chapters.length, "chapter")}
                  </span>
                </>
              ) : null}
            </div>
            <p className="mt-4 mb-0 line-clamp-4 max-w-2xl text-sm/relaxed text-[#999c97] max-lg:line-clamp-3">
              {show.description}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                className={cn(activeShow && "bg-coda-primary-hover")}
                onClick={
                  activeShow
                    ? onTogglePlayback
                    : track
                      ? () => onPlay(track)
                      : undefined
                }
                disabled={!activeShow && !track}
                aria-label={
                  activeShow
                    ? `${playing ? "Pause" : "Resume"} show`
                    : track
                      ? "Play show"
                      : loading
                        ? "Loading show audio"
                        : "Show audio unavailable"
                }
                aria-pressed={activeShow && playing}
              >
                {!activeShow && loading ? (
                  <Spinner
                    aria-hidden="true"
                    className="size-4 text-current motion-reduce:animate-none"
                  />
                ) : (
                  <PlaybackIcon
                    className="size-4"
                    playing={activeShow && playing}
                  />
                )}
                {activeShow
                  ? playing
                    ? "Pause show"
                    : "Resume show"
                  : track
                    ? "Play show"
                    : loading
                      ? "Loading show…"
                      : "Show unavailable"}
              </Button>
              <Button
                onClick={track ? () => onQueue(track) : undefined}
                disabled={!track}
              >
                <ListPlus size={17} />
                Add to queue
              </Button>
              <Button
                className={cn(favorite && "text-coda-favorite")}
                onClick={() => onToggleFavorite(show)}
                aria-pressed={favorite}
                aria-label={
                  favorite
                    ? `Remove ${show.subtitle} from favorites`
                    : `Add ${show.subtitle} to favorites`
                }
              >
                <Heart size={16} fill={favorite ? "currentColor" : "none"} />
                {favorite ? "Favorited" : "Favorite"}
              </Button>
              {seriesId ? (
                <Link
                  activeOptions={{ exact: true }}
                  className={buttonVariants()}
                  onClick={(event) =>
                    handleCodaLinkActivation(event, () =>
                      onBrowseSeries(seriesId),
                    )
                  }
                  params={{
                    seriesId: stringifyRadioSeriesIdParam(seriesId),
                  }}
                  to="/radio/series/$seriesId"
                >
                  <Radio size={16} />
                  Browse all episodes
                </Link>
              ) : (
                <Link
                  activeOptions={{ exact: true }}
                  className={buttonVariants()}
                  onClick={(event) =>
                    handleCodaLinkActivation(event, () => onBrowseSeries())
                  }
                  to="/radio"
                >
                  <Radio size={16} />
                  Browse all shows
                </Link>
              )}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onOpenItem(radioEpisodeUrl(show.id))}
                      aria-label={`Open ${show.subtitle} on Bandcamp`}
                    />
                  }
                >
                  <ExternalLink size={16} />
                </TooltipTrigger>
                <TooltipContent>Open on Bandcamp</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </header>

        <div className="flex items-end justify-between gap-5 px-1 pt-8 pb-3">
          <div>
            <Badge
              variant="artwork"
              className="mb-1.5 h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase"
            >
              Broadcast tracklist
            </Badge>
            <h2 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-lg/tight font-semibold text-[#deddd7]">
              Songs in this show
            </h2>
          </div>
          <span className="text-xs text-coda-subtle-foreground">
            {track
              ? countLabel(chapters.length, "chapter")
              : loading
                ? "Loading…"
                : "Unavailable"}
          </span>
        </div>
        {track && chapters.length ? (
          <ol className="relative m-0 grid list-none gap-1 overflow-hidden rounded-lg bg-[rgba(19,21,23,0.5)] py-1.5">
            {chapters.map((chapter, index) => {
              const activeChapter = currentChapter === chapter;
              return (
                <li
                  className={cn(
                    "relative grid min-h-16 grid-cols-[3rem_minmax(0,1fr)_3.5rem_4.5rem] items-center gap-3 rounded-lg border-0 px-4 py-2 transition-colors duration-(--duration-coda-fast) [contain-intrinsic-size:4rem] [content-visibility:auto] hover:bg-white/3 motion-reduce:transition-none max-lg:grid-cols-[2rem_minmax(0,1fr)_3rem_3.5rem] max-lg:px-1.5",
                    activeChapter && "bg-primary/10",
                  )}
                  key={`${chapter.timecode}-${chapter.artist}-${chapter.title}-${index}`}
                  aria-current={activeChapter ? "true" : undefined}
                >
                  <RadioChapterArtwork
                    chapter={chapter}
                    index={index}
                    active={activeChapter}
                  />
                  <RadioChapterCopy
                    chapter={chapter}
                    className="min-w-0"
                    onOpen={onOpenItem}
                  />
                  <time className="text-center text-xs text-coda-subtle-foreground tabular-nums">
                    {formatTime(chapter.timecode)}
                  </time>
                  {onPlayAt ? (
                    <Button
                      variant="secondary"
                      size="compact"
                      className={cn(
                        "h-8 gap-1 rounded-md px-2 text-xs text-[#b8bab4] hover:border-primary/25 hover:bg-accent hover:text-[#e7937e] max-lg:px-1.5",
                        activeChapter &&
                          "border-primary/30 bg-primary/15 text-[#ec947d]",
                      )}
                      onClick={
                        activeChapter
                          ? onTogglePlayback
                          : () => onPlayAt(track, chapter.timecode)
                      }
                      aria-label={
                        activeChapter
                          ? `${playing ? "Pause" : "Resume"} ${chapter.title}`
                          : `Play ${chapter.title} from ${formatTime(chapter.timecode)}`
                      }
                      aria-pressed={activeChapter && playing}
                      title={
                        activeChapter
                          ? playing
                            ? "Pause"
                            : "Resume"
                          : "Play from here"
                      }
                    >
                      <PlaybackIcon
                        className="size-3.5"
                        playing={activeChapter && playing}
                      />
                      {activeChapter
                        ? playing
                          ? "Pause"
                          : "Resume"
                        : "Play"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : track ? (
          <p className="m-0 grid min-h-44 place-items-center rounded-lg border border-dashed border-(--line) text-sm text-[#7f837e]">
            Bandcamp did not provide a tracklist for this show.
          </p>
        ) : loadError ? (
          <div
            className="grid min-h-44 place-items-center rounded-lg border border-dashed border-(--line) px-6 text-center text-[#7f837e]"
            role="alert"
            aria-busy={retrying}
          >
            <div>
              <Radio className="mx-auto" size={26} />
              <strong className="mt-3 block text-sm text-[#cac9c3]">
                Tracklist unavailable
              </strong>
              <span className="mt-1.5 block max-w-md text-xs/normal text-coda-subtle-foreground">
                {loadError}
              </span>
              <RetryButton
                busy={retrying}
                busyLabel="Loading again…"
                className="mt-4 text-xs text-[#dd8973]"
                label="Try again"
                onClick={onRetry}
              />
            </div>
          </div>
        ) : (
          <div
            className="grid min-h-44 gap-2 overflow-hidden rounded-lg bg-[rgba(19,21,23,0.5)] p-3"
            aria-busy="true"
            aria-label="Loading Radio show tracklist"
            role="status"
          >
            <span className="sr-only">
              Fetching this episode’s tracklist from Bandcamp.
            </span>
            {[0, 1, 2].map((row) => (
              <div
                className="grid min-h-12 grid-cols-[2.5rem_minmax(0,1fr)_4rem] items-center gap-3 rounded-md bg-white/2 px-3"
                aria-hidden="true"
                key={row}
              >
                <span className="size-8 animate-pulse rounded bg-white/6 motion-reduce:animate-none" />
                <span className="h-3 animate-pulse rounded bg-white/6 motion-reduce:animate-none" />
                <span className="h-3 animate-pulse rounded bg-white/6 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        )}
        {actionError ? (
          <p className="mt-2.5 text-xs text-[#d28070]" role="status">
            {actionError}
          </p>
        ) : null}
      </div>
    </section>
  );
});
