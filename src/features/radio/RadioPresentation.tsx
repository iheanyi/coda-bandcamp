import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  ExternalLink,
  Heart,
  ListMusic,
  ListPlus,
  Radio,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  memo,
  type MouseEvent,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { LayoutGroup, useReducedMotionConfig } from "motion/react";
import * as m from "motion/react-m";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { countLabel } from "@/countLabel";
import { cn } from "@/lib/utils";
import { formatTime, initials } from "@/lib";
import type { PlaybackClock } from "@/playbackClock";
import { RadioChapterArtwork, RadioChapterCopy } from "@/RadioChapterMetadata";
import {
  BANDCAMP_RADIO_PROVIDER,
  radioSeriesForShow,
  radioShowIdentity,
} from "@/radioIdentity";
import { radioAiringIndexesAt } from "@/radioPlayback";
import { BANDCAMP_RADIO_SERIES, radioEpisodeUrl } from "@/radioSeries";
import { radioTrackFromShow } from "@/radioTrack";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import { useDistanceAwareSelectionPill } from "@/selectionMotion";
import {
  stringifyRadioSeriesIdParam,
  stringifyRadioShowIdParam,
  type RadioSeriesId,
} from "@/routing/routeContracts";
import type { RadioShow, RadioShowSummary, Track } from "@/types";

import { radioSeriesId, radioShowId } from "./radioRouteIds";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const radioSeriesLayoutGroupId = "coda-radio-series-navigation";
const radioSeriesIndicatorLayoutId = "coda-radio-series-selected-indicator";

export function showDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

export const RadioArtwork = memo(function RadioArtwork({
  show,
  eager = false,
  className,
  detail = false,
  returning = false,
}: {
  show: RadioShowSummary;
  eager?: boolean;
  className?: string;
  detail?: boolean;
  returning?: boolean;
}) {
  const artworkUrl = show.artworkUrl;
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string>();
  const [loadedArtworkUrl, setLoadedArtworkUrl] = useState<string>();
  const artworkEligible = Boolean(
    artworkUrl && failedArtworkUrl !== artworkUrl,
  );
  const artworkLoaded = Boolean(
    artworkEligible && loadedArtworkUrl === artworkUrl,
  );

  return (
    <div
      className={cn(
        "grid aspect-square place-items-center overflow-hidden rounded-lg border border-white/7 bg-coda-hover text-6xl font-bold text-[#a2a49f]",
        className,
      )}
      data-radio-show-artwork={show.id}
      data-coda-radio-artwork-detail={detail ? show.id : undefined}
      data-coda-radio-artwork-return={returning ? show.id : undefined}
    >
      {artworkEligible && artworkUrl ? (
        <img
          key={artworkUrl}
          className={cn(
            "col-start-1 row-start-1 size-full object-cover",
            !artworkLoaded && "invisible",
          )}
          data-radio-show-artwork-image={artworkUrl}
          src={artworkUrl}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onError={() => setFailedArtworkUrl(artworkUrl)}
          onLoad={() => {
            setLoadedArtworkUrl(artworkUrl);
            setFailedArtworkUrl((current) =>
              current === artworkUrl ? undefined : current,
            );
          }}
        />
      ) : null}
      {!artworkLoaded ? (
        <span
          className="col-start-1 row-start-1"
          data-radio-show-artwork-fallback={artworkUrl ?? "missing"}
        >
          {initials(show.subtitle)}
        </span>
      ) : null}
    </div>
  );
});

export const RadioSeriesLink = memo(function RadioSeriesLink({
  show,
  onBrowse,
}: {
  show: RadioShowSummary;
  onBrowse: (seriesId?: RadioSeriesId) => void;
}) {
  const identity = radioShowIdentity(show);
  const series = radioSeriesForShow(show);
  if (!series) {
    if (identity.seriesTitle) {
      return (
        <span className="inline-flex max-w-full items-center truncate">
          {identity.seriesTitle}
        </span>
      );
    }
    return (
      <Link
        activeOptions={{ exact: true }}
        className="inline-flex max-w-full items-center truncate outline-none hover:text-[#f09a83] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={(event) => handleCodaLinkActivation(event, () => onBrowse())}
        to="/radio"
      >
        {identity.provider}
      </Link>
    );
  }
  const seriesId = radioSeriesId(series.id);
  if (!seriesId) {
    return (
      <span className="inline-flex max-w-full items-center truncate">
        {series.title}
      </span>
    );
  }
  return (
    <Link
      activeOptions={{ exact: true }}
      aria-label={`Browse ${series.title} episodes`}
      className="inline-flex h-auto max-w-full justify-start overflow-hidden p-0 text-left text-inherit hover:bg-transparent hover:text-[#f09a83]"
      onClick={(event) =>
        handleCodaLinkActivation(event, () => onBrowse(seriesId))
      }
      params={{ seriesId: stringifyRadioSeriesIdParam(seriesId) }}
      title={`Browse ${series.title} in Coda`}
      to="/radio/series/$seriesId"
    >
      <span className="truncate">{series.title}</span>
    </Link>
  );
});

export const RadioSeriesNav = memo(function RadioSeriesNav({
  selectedSeriesId,
  pending,
  onSelect,
  seriesTravelSteps,
}: {
  selectedSeriesId?: RadioSeriesId;
  pending: boolean;
  onSelect: (seriesId?: RadioSeriesId) => void;
  seriesTravelSteps?: number;
}) {
  const selectedIndex =
    selectedSeriesId === undefined
      ? 0
      : Math.max(
          0,
          BANDCAMP_RADIO_SERIES.findIndex(
            (series) => series.id === selectedSeriesId,
          ) + 1,
        );
  const indicatorMotion = useDistanceAwareSelectionPill(
    selectedIndex,
    seriesTravelSteps,
  );
  const reduceMotion = useReducedMotionConfig() === true;
  const activeIndicator = (
    <m.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-md border border-primary/20 bg-accent"
      data-radio-series-active-indicator=""
      data-radio-series-indicator-motion={reduceMotion ? "snap" : "spring"}
      data-selection-travel-steps={indicatorMotion.travelSteps}
      layoutId={radioSeriesIndicatorLayoutId}
      transition={indicatorMotion.transition}
    />
  );

  return (
    <nav
      className="mb-4 flex items-end justify-between gap-6 max-xl:flex-col max-xl:items-start max-xl:gap-2.5"
      aria-label={`${BANDCAMP_RADIO_PROVIDER} shows`}
    >
      <div className="grid shrink-0 gap-1">
        <Badge
          variant="artwork"
          className="h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase"
        >
          Browse by show
        </Badge>
        <strong className="font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-lg/tight font-semibold tracking-tight text-[#e5e3dc]">
          {BANDCAMP_RADIO_PROVIDER}
        </strong>
      </div>
      <LayoutGroup id={radioSeriesLayoutGroupId}>
        <div
          aria-busy={pending || undefined}
          className="flex min-w-0 scrollbar-none gap-1 overflow-x-auto p-0.5 max-xl:w-full [&::-webkit-scrollbar]:hidden"
          data-radio-series-layout-group={radioSeriesLayoutGroupId}
        >
          <Link
            activeOptions={{ exact: true }}
            className={cn(
              buttonVariants({ variant: "ghost", size: "compact" }),
              "relative isolate h-8 shrink-0 overflow-hidden rounded-md border border-transparent px-2.5 text-xs text-[#858984] hover:border-(--line) hover:bg-white/2.5 hover:text-[#c8c8c2]",
              selectedSeriesId === undefined &&
                "border-transparent text-accent-foreground hover:border-transparent hover:bg-transparent hover:text-accent-foreground",
            )}
            onClick={(event) =>
              handleCodaLinkActivation(event, () => onSelect())
            }
            to="/radio"
          >
            {selectedSeriesId === undefined ? activeIndicator : null}
            <span className="relative z-10">All shows</span>
          </Link>
          {BANDCAMP_RADIO_SERIES.map((series) => (
            <Link
              activeOptions={{ exact: true }}
              key={series.id}
              className={cn(
                buttonVariants({ variant: "ghost", size: "compact" }),
                "relative isolate h-8 shrink-0 overflow-hidden rounded-md border border-transparent px-2.5 text-xs text-[#858984] hover:border-(--line) hover:bg-white/2.5 hover:text-[#c8c8c2]",
                selectedSeriesId === series.id &&
                  "border-transparent text-accent-foreground hover:border-transparent hover:bg-transparent hover:text-accent-foreground",
              )}
              onClick={(event) =>
                handleCodaLinkActivation(event, () => onSelect(series.id))
              }
              params={{
                seriesId: stringifyRadioSeriesIdParam(series.id),
              }}
              to="/radio/series/$seriesId"
            >
              {selectedSeriesId === series.id ? activeIndicator : null}
              <span className="relative z-10">{series.title}</span>
            </Link>
          ))}
        </div>
      </LayoutGroup>
    </nav>
  );
});

export const RadioCard = memo(function RadioCard({
  show,
  busyAction,
  active,
  playing,
  onPlay,
  onTogglePlayback,
  onQueue,
  onDetails,
  favorite,
  onToggleFavorite,
  onOpenItem,
  onBrowseSeries,
  returningArtwork,
}: {
  show: RadioShowSummary;
  busyAction?: "play" | "queue" | "detail";
  active: boolean;
  playing: boolean;
  onPlay: (show: RadioShowSummary) => void;
  onTogglePlayback: () => void;
  onQueue: (show: RadioShowSummary) => void;
  onDetails: (show: RadioShowSummary, trigger: HTMLAnchorElement) => void;
  favorite: boolean;
  onToggleFavorite: (show: RadioShowSummary) => void;
  onOpenItem: (url: string) => void;
  onBrowseSeries: (seriesId?: RadioSeriesId) => void;
  returningArtwork: boolean;
}) {
  const showId = radioShowId(show.id);
  const showIdParam = showId ? stringifyRadioShowIdParam(showId) : undefined;
  const openDetails = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!showId) return;
    handleCodaLinkActivation(event, (trigger) => onDetails(show, trigger));
  };

  return (
    <article className="group/card min-w-0 overflow-hidden rounded-lg border border-(--line) bg-white/2 transition-[transform,border-color,background-color] duration-(--duration-coda-standard) ease-coda-enter [contain-intrinsic-size:24rem_15rem] [content-visibility:auto] hover:-translate-y-0.5 hover:border-(--line-strong) hover:bg-white/4 motion-reduce:transition-none">
      <div className="relative">
        <RadioArtwork
          show={show}
          className="rounded-none border-x-0 border-t-0 text-3xl"
          returning={returningArtwork}
        />
        {showIdParam ? (
          <Link
            aria-label={`Open ${show.subtitle}`}
            className="absolute inset-0 rounded-t-lg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            data-radio-show-navigation-slot="artwork"
            data-radio-show-open={show.id}
            onClick={openDetails}
            params={{ showId: showIdParam }}
            to="/radio/shows/$showId"
          />
        ) : null}
      </div>
      <div className="flex min-h-44 flex-col p-3.5">
        <div className="min-h-3.5 text-xs font-bold tracking-widest text-[#cb7560] uppercase">
          <RadioSeriesLink show={show} onBrowse={onBrowseSeries} />
        </div>
        <h3
          className="mt-1.5 mb-1 min-w-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base/tight font-semibold text-[#ebe9e3]"
          data-radio-show-title={show.id}
        >
          {showIdParam ? (
            <Link
              className="block min-w-0 outline-none hover:text-[#f09a83] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              data-radio-show-navigation-slot="title"
              data-radio-show-open={show.id}
              onClick={openDetails}
              params={{ showId: showIdParam }}
              to="/radio/shows/$showId"
            >
              <OverflowMarquee
                staticTextProps={{
                  "data-coda-radio-title-return": returningArtwork
                    ? show.id
                    : undefined,
                }}
                text={show.subtitle}
              />
            </Link>
          ) : (
            <OverflowMarquee text={show.subtitle} />
          )}
        </h3>
        <time className="text-xs text-[#737772]" dateTime={show.publishedAt}>
          {showDate(show.publishedAt)}
        </time>
        <p className="mt-2.5 mb-3.5 line-clamp-3 min-h-11 text-xs/normal text-[#8d918b]">
          {show.description}
        </p>
        <div className="mt-auto flex items-center gap-1">
          <Button
            variant="text"
            size="compact"
            className={cn(
              "h-8 gap-1.5 rounded-md bg-accent px-2.5 text-xs font-bold text-accent-foreground hover:bg-primary/20 hover:text-[#ffc0b0]",
              active && "bg-primary/20 text-[#ffc0b0]",
            )}
            onClick={active ? onTogglePlayback : () => onPlay(show)}
            disabled={Boolean(busyAction)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${show.subtitle}`
                : `Play ${show.subtitle}`
            }
            aria-pressed={active && playing}
          >
            {busyAction === "play" ? (
              <Spinner
                aria-hidden="true"
                className="size-4 text-current motion-reduce:animate-none"
              />
            ) : (
              <PlaybackIcon className="size-4" playing={active && playing} />
            )}
            {active ? (playing ? "Pause" : "Resume") : "Play"}
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-compact"
                  className={cn("size-8", favorite && "text-[#ef8066]")}
                  onClick={() => onToggleFavorite(show)}
                  disabled={Boolean(busyAction)}
                  aria-label={
                    favorite
                      ? `Remove ${show.subtitle} from favorites`
                      : `Add ${show.subtitle} to favorites`
                  }
                  aria-pressed={favorite}
                />
              }
            >
              <Heart size={15} fill={favorite ? "currentColor" : "none"} />
            </TooltipTrigger>
            <TooltipContent>
              {favorite ? "Remove from favorites" : "Add to favorites"}
            </TooltipContent>
          </Tooltip>
          {showIdParam ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Link
                    aria-label={`View tracklist for ${show.subtitle}`}
                    className={buttonVariants({
                      variant: "ghost",
                      size: "icon",
                    })}
                    data-radio-show-navigation-slot="tracklist"
                    data-radio-show-open={show.id}
                    onClick={openDetails}
                    params={{ showId: showIdParam }}
                    to="/radio/shows/$showId"
                  />
                }
              >
                {busyAction === "detail" ? (
                  <Spinner
                    aria-hidden="true"
                    className="size-4 text-current motion-reduce:animate-none"
                  />
                ) : (
                  <ListMusic size={15} />
                )}
              </TooltipTrigger>
              <TooltipContent>View tracklist</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-compact"
                  className="size-8"
                  onClick={() => onQueue(show)}
                  disabled={Boolean(busyAction)}
                  aria-label={`Add ${show.subtitle} to queue`}
                />
              }
            >
              {busyAction === "queue" ? (
                <Spinner
                  aria-hidden="true"
                  className="size-4 text-current motion-reduce:animate-none"
                />
              ) : (
                <ListPlus size={15} />
              )}
            </TooltipTrigger>
            <TooltipContent>Add show to queue</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-compact"
                  className="size-8"
                  onClick={() => onOpenItem(radioEpisodeUrl(show.id))}
                  aria-label={`Open ${show.subtitle} on Bandcamp`}
                />
              }
            >
              <ExternalLink size={14} />
            </TooltipTrigger>
            <TooltipContent>Open on Bandcamp</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </article>
  );
});

export const RadioDetail = memo(function RadioDetail({
  show,
  actionError,
  onBack,
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
  show: RadioShow;
  actionError: string;
  onBack: () => void;
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
  const track = useMemo(() => radioTrackFromShow(show), [show]);
  const chapters = track.radioChapters ?? [];
  const activeShow = currentTrackId === track.id;
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
  const seriesId = radioSeriesId(radioSeriesForShow(show)?.id);

  return (
    <section
      className="mx-auto w-full max-w-5xl pt-2 pb-12"
      aria-labelledby="radio-detail-title"
      data-coda-radio-detail-surface
    >
      <Button
        variant="text"
        size="compact"
        className="mb-3.5 -ml-1 h-auto gap-1.5 p-1 text-xs text-[#969994] hover:bg-transparent hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft size={16} />
        Back
      </Button>
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
            <span className="inline-flex items-center gap-1">
              <Clock3 size={13} /> {formatTime(show.duration)}
            </span>
            <span className="inline-flex items-center gap-1">
              <ListMusic size={13} /> {countLabel(chapters.length, "chapter")}
            </span>
          </div>
          <p className="mt-4 mb-0 line-clamp-4 max-w-2xl text-sm/relaxed text-[#999c97] max-lg:line-clamp-3">
            {show.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              className={cn(activeShow && "bg-coda-primary-hover")}
              onClick={activeShow ? onTogglePlayback : () => onPlay(track)}
              aria-label={
                activeShow
                  ? `${playing ? "Pause" : "Resume"} show`
                  : "Play show"
              }
              aria-pressed={activeShow && playing}
            >
              <PlaybackIcon
                className="size-4"
                playing={activeShow && playing}
              />
              {activeShow
                ? playing
                  ? "Pause show"
                  : "Resume show"
                : "Play show"}
            </Button>
            <Button onClick={() => onQueue(track)}>
              <ListPlus size={17} />
              Add to queue
            </Button>
            <Button
              className={cn(favorite && "text-[#ef8066]")}
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
        <span className="text-xs text-[#777b76]">
          {countLabel(chapters.length, "chapter")}
        </span>
      </div>
      {chapters.length ? (
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
                <time className="text-center text-xs text-[#777b76] tabular-nums">
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
                    {activeChapter ? (playing ? "Pause" : "Resume") : "Play"}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="m-0 grid min-h-44 place-items-center rounded-lg border border-dashed border-(--line) text-sm text-[#7f837e]">
          Bandcamp did not provide a tracklist for this show.
        </p>
      )}
      {actionError ? (
        <p className="mt-2.5 text-xs text-[#d28070]" role="status">
          {actionError}
        </p>
      ) : null}
    </section>
  );
});
