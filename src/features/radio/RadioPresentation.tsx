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
import { AnimatePresence, useReducedMotionConfig } from "motion/react";
import * as m from "motion/react-m";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { ScrollableLinkSelectionRail } from "@/components/ScrollableLinkSelectionRail";
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
import {
  stringifyRadioSeriesIdParam,
  stringifyRadioShowIdParam,
  type RadioSeriesId,
} from "@/routing/routeContracts";
import type { RadioShow, RadioShowSummary, Track } from "@/types";

import { showDate } from "./radioPresentationFormatting";
import { radioSeriesId, radioShowId } from "./radioRouteIds";

const radioSeriesLayoutGroupId = "coda-radio-series-navigation";
const radioSeriesNavItems = [
  { label: "All shows", value: "all" },
  ...BANDCAMP_RADIO_SERIES.map((series) => ({
    label: series.title,
    value: String(series.id),
  })),
];

const hoverCapabilityQuery = "(hover: hover) and (pointer: fine)";

function getHoverCapability() {
  return (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    window.matchMedia(hoverCapabilityQuery).matches
  );
}

function subscribeToHoverCapability(onChange: () => void) {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => undefined;
  }
  const query = window.matchMedia(hoverCapabilityQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useHoverCapability() {
  return useSyncExternalStore(
    subscribeToHoverCapability,
    getHoverCapability,
    () => true,
  );
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
  return (
    <div className="mb-4 flex items-end justify-between gap-6 max-xl:flex-col max-xl:items-start max-xl:gap-2.5">
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
      <ScrollableLinkSelectionRail
        aria-label={`${BANDCAMP_RADIO_PROVIDER} shows`}
        busy={pending}
        className="min-w-0 max-xl:w-full"
        indicatorDataAttributes={{
          "data-radio-series-active-indicator": "",
        }}
        indicatorMotionDataAttribute="data-radio-series-indicator-motion"
        items={radioSeriesNavItems}
        layoutGroupId={radioSeriesLayoutGroupId}
        linkClassName="text-[#858984] hover:text-[#c8c8c2]"
        navClassName="p-0.5"
        navDataAttributes={{
          "data-radio-series-layout-group": radioSeriesLayoutGroupId,
        }}
        renderLink={(item, state) => {
          if (item.value === "all") {
            return (
              <Link
                activeOptions={{ exact: true }}
                aria-current={state.selected ? "page" : undefined}
                className={state.className}
                key={item.value}
                onClick={(event) =>
                  handleCodaLinkActivation(event, () => onSelect())
                }
                preload="intent"
                ref={state.ref}
                to="/radio"
              >
                {state.children}
              </Link>
            );
          }
          const series = BANDCAMP_RADIO_SERIES.find(
            (candidate) => String(candidate.id) === item.value,
          );
          if (!series) return null;
          return (
            <Link
              activeOptions={{ exact: true }}
              aria-current={state.selected ? "page" : undefined}
              className={state.className}
              key={item.value}
              onClick={(event) =>
                handleCodaLinkActivation(event, () => onSelect(series.id))
              }
              params={{
                seriesId: stringifyRadioSeriesIdParam(series.id),
              }}
              preload="intent"
              ref={state.ref}
              to="/radio/series/$seriesId"
            >
              {state.children}
            </Link>
          );
        }}
        travelSteps={seriesTravelSteps}
        value={
          selectedSeriesId === undefined ? "all" : String(selectedSeriesId)
        }
      />
    </div>
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
  const canHover = useHoverCapability();
  const reduceMotion = useReducedMotionConfig() === true;
  const [hovered, setHovered] = useState(false);
  const [keyboardFocusWithin, setKeyboardFocusWithin] = useState(false);
  const actionsExpanded =
    canHover && (hovered || keyboardFocusWithin || Boolean(busyAction));
  const motionTransition = reduceMotion
    ? { duration: 0 }
    : { type: "spring" as const, bounce: 0.06, visualDuration: 0.32 };
  const openDetails = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!showId) return;
    handleCodaLinkActivation(event, (trigger) => onDetails(show, trigger));
  };

  const playbackControl = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-compact"
            className={cn(
              "group/action size-8 rounded-md text-[#f09a83] hover:text-[#ffc0b0]",
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
          />
        }
      >
        {busyAction === "play" ? (
          <Spinner
            aria-hidden="true"
            className="size-4 text-current motion-reduce:animate-none"
          />
        ) : (
          <PlaybackIcon
            className="size-4 transition-transform duration-300 ease-out group-hover/action:scale-110 group-focus-visible/action:scale-110 group-active/action:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
            playing={active && playing}
          />
        )}
      </TooltipTrigger>
      <TooltipContent>
        {active ? (playing ? "Pause" : "Resume") : "Play show"}
      </TooltipContent>
    </Tooltip>
  );

  const auxiliaryActionControls = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-compact"
              className={cn(
                "group/action size-8 rounded-md",
                favorite && "text-coda-favorite",
              )}
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
          <Heart
            className="transition-transform duration-300 ease-out group-hover/action:-rotate-6 group-hover/action:scale-110 group-focus-visible/action:-rotate-6 group-focus-visible/action:scale-110 group-active/action:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
            size={15}
            fill={favorite ? "currentColor" : "none"}
          />
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
                className={cn(
                  buttonVariants({
                    variant: "ghost",
                    size: "icon-compact",
                  }),
                  "group/action size-8 rounded-md",
                )}
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
              <ListMusic
                className="transition-transform duration-300 ease-out group-hover/action:-translate-y-0.5 group-focus-visible/action:-translate-y-0.5 group-active/action:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
                size={15}
              />
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
              className="group/action size-8 rounded-md"
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
            <ListPlus
              className="transition-transform duration-300 ease-out group-hover/action:rotate-6 group-hover/action:scale-110 group-focus-visible/action:rotate-6 group-focus-visible/action:scale-110 group-active/action:scale-90 motion-reduce:transform-none motion-reduce:transition-none"
              size={15}
            />
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
              className="group/action size-8 rounded-md"
              onClick={() => onOpenItem(radioEpisodeUrl(show.id))}
              aria-label={`Open ${show.subtitle} on Bandcamp`}
            />
          }
        >
          <ExternalLink
            className="transition-transform duration-300 ease-out group-hover/action:translate-x-0.5 group-hover/action:-translate-y-0.5 group-focus-visible/action:translate-x-0.5 group-focus-visible/action:-translate-y-0.5 group-active/action:translate-x-0 group-active/action:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none"
            size={14}
          />
        </TooltipTrigger>
        <TooltipContent>Open on Bandcamp</TooltipContent>
      </Tooltip>
    </>
  );

  const actionControls = (
    <div
      className="flex items-center justify-between gap-0.5"
      data-radio-card-actions=""
    >
      {playbackControl}
      {auxiliaryActionControls}
    </div>
  );

  return (
    <m.article
      className={cn(
        "group/card relative min-w-0 overflow-hidden rounded-lg border border-(--line) bg-[#151719] transition-[border-color,background-color,box-shadow] duration-(--duration-coda-standard) ease-coda-enter [contain-intrinsic-size:24rem_15rem] [content-visibility:auto] motion-reduce:transition-none",
        actionsExpanded &&
          "border-(--line-strong) bg-[#181b1d] shadow-[0_12px_30px_rgba(0,0,0,0.3)]",
      )}
      data-radio-card=""
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setKeyboardFocusWithin(false);
        }
      }}
      onFocusCapture={(event) =>
        setKeyboardFocusWithin(event.target.matches(":focus-visible"))
      }
      onHoverEnd={() => setHovered(false)}
      onHoverStart={() => setHovered(true)}
    >
      <div className="relative overflow-hidden">
        <m.div
          animate={{
            transform: actionsExpanded ? "scale(1.018)" : "scale(1)",
          }}
          initial={false}
          transition={motionTransition}
        >
          <RadioArtwork
            show={show}
            className="rounded-none border-x-0 border-t-0 text-3xl"
            returning={returningArtwork}
          />
        </m.div>
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
        {canHover ? (
          <>
            <m.div
              animate={{ opacity: actionsExpanded ? 1 : 0 }}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_46%,rgba(7,8,9,0.78)_100%)]"
              initial={false}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
              }
            />
            <m.div
              animate={{
                opacity: actionsExpanded ? 1 : 0,
                transform: actionsExpanded
                  ? "translateY(0px)"
                  : "translateY(10px)",
              }}
              className={cn(
                "absolute bottom-2 left-2 z-10 overflow-hidden rounded-lg border border-white/10 bg-[#101214]/92 p-1.5 shadow-[0_8px_22px_rgba(0,0,0,0.34)] backdrop-blur-md",
                actionsExpanded ? "pointer-events-auto" : "pointer-events-none",
              )}
              initial={false}
              style={{
                width: actionsExpanded ? "calc(100% - 1rem)" : "2.75rem",
              }}
              transition={motionTransition}
            >
              <div
                className="flex items-center gap-0.5"
                data-radio-card-actions=""
                data-radio-card-actions-expanded={actionsExpanded}
              >
                {playbackControl}
                <AnimatePresence initial={false}>
                  {actionsExpanded ? (
                    <m.div
                      animate={{
                        opacity: 1,
                        transform: "translateX(0px)",
                      }}
                      className="flex min-w-0 flex-1 items-center justify-between gap-0.5"
                      exit={{
                        opacity: 0,
                        transform: "translateX(-8px)",
                      }}
                      initial={{
                        opacity: 0,
                        transform: "translateX(-8px)",
                      }}
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
                      }
                    >
                      {auxiliaryActionControls}
                    </m.div>
                  ) : null}
                </AnimatePresence>
              </div>
            </m.div>
          </>
        ) : null}
      </div>
      <div className="relative flex min-h-44 flex-col p-3.5">
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
        <p
          className={cn(
            "mt-2.5 text-xs/normal text-[#8d918b]",
            canHover ? "mb-0 line-clamp-4" : "mb-3.5 line-clamp-3 min-h-11",
          )}
        >
          {show.description}
        </p>
        {!canHover ? <div className="mt-auto">{actionControls}</div> : null}
      </div>
    </m.article>
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
