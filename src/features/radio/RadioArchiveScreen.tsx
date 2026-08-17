import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  CalendarDays,
  Clock3,
  ExternalLink,
  Headphones,
  Heart,
  ListMusic,
  ListPlus,
  Radio,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { countLabel } from "@/countLabel";
import type { RouteCommitOutcome } from "@/features/navigation/routeCommit";
import { openBandcampUrl } from "@/lib";
import { cn } from "@/lib/utils";
import {
  radioShowQueryOptions,
  radioShowsInfiniteQueryOptions,
} from "@/queries/radioQueries";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import { BANDCAMP_RADIO_SERIES, radioEpisodeUrl } from "@/radioSeries";
import { radioTrackFromShow } from "@/radioTrack";
import { ResponsiveVirtualGrid } from "@/ResponsiveVirtualGrid";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  stringifyRadioShowIdParam,
  type RadioSeriesId,
} from "@/routing/routeContracts";
import type { RadioShowSummary } from "@/types";

import {
  RadioArtwork,
  RadioCard,
  RadioSeriesLink,
  RadioSeriesNav,
} from "./RadioPresentation";
import { showDate } from "./radioPresentationFormatting";
import { radioShowId } from "./radioRouteIds";
import type {
  RadioArchiveScreenProps,
} from "./radioScreenTypes";

const RADIO_ARCHIVE_GRID_LAYOUTS = [
  {
    maxWidth: 780,
    minColumnWidth: 176,
    columnGap: 14,
    rowGap: 14,
    rowHeight: (columnWidth: number) => columnWidth + 176,
  },
  {
    minColumnWidth: 224,
    columnGap: 14,
    rowGap: 14,
    rowHeight: (columnWidth: number) => columnWidth + 176,
  },
] as const;
const radioShowKey = (show: RadioShowSummary) => show.id;

function assertNever(value: never): never {
  throw new TypeError(`Unsupported exhaustive variant: ${String(value)}`);
}

function radioShowNavigationFailureCopy(
  outcome: RouteCommitOutcome,
): string | undefined {
  switch (outcome) {
    case "rendered":
    case "same-location":
      return undefined;
    case "failed":
      return "Radio show navigation failed. Try again.";
    case "timeout":
      return "Radio show navigation took too long. Try again.";
    default:
      return assertNever(outcome);
  }
}
function RadioArchiveScreen({
  onPlay,
  onQueue,
  currentTrackId,
  playing,
  onTogglePlayback,
  favoriteShowIds,
  onToggleFavorite,
  seriesId,
  onSelectSeries,
  onOpenShow,
  openExternal = openBandcampUrl,
  repository,
  seriesTravelSteps,
}: RadioArchiveScreenProps) {
  const queryClient = useQueryClient();
  const [seriesPending, startSeriesTransition] = useTransition();
  const paginationRef = useRef<HTMLDivElement>(null);
  const archiveScrollElementRef = useRef<HTMLElement | null>(null);
  const setArchivePageRoot = useCallback((element: HTMLElement | null) => {
    archiveScrollElementRef.current =
      element?.closest<HTMLElement>("[data-coda-library-scroll]") ??
      element?.parentElement ??
      null;
  }, []);
  const showsQuery = useInfiniteQuery(
    radioShowsInfiniteQueryOptions(seriesId, repository),
  );
  const [busy, setBusy] = useState<{
    id: number;
    action: "play" | "queue";
  }>();
  const [actionError, setActionError] = useState("");
  const selectedSeries = BANDCAMP_RADIO_SERIES.find(
    (series) => series.id === seriesId,
  );
  const shows = useMemo(() => {
    const uniqueShows = new Map<number, RadioShowSummary>();
    for (const page of showsQuery.data?.pages ?? []) {
      for (const show of page.results) {
        if (!uniqueShows.has(show.id)) uniqueShows.set(show.id, show);
      }
    }
    return [...uniqueShows.values()];
  }, [showsQuery.data?.pages]);
  const featured = shows[0];
  const featuredShowId = radioShowId(featured?.id);
  const featuredShowIdParam = featuredShowId
    ? stringifyRadioShowIdParam(featuredShowId)
    : undefined;
  const visibleShows = useMemo(() => shows.slice(1), [shows]);

  const loadShow = useCallback(
    async (summary: RadioShowSummary) => {
      const options = radioShowQueryOptions(summary.id, repository);
      const loaded = await queryClient.fetchQuery(options);
      const details =
        loaded.series || !summary.series
          ? loaded
          : { ...loaded, series: summary.series };
      if (details !== loaded) {
        queryClient.setQueryData(options.queryKey, details);
      }
      return details;
    },
    [queryClient, repository],
  );

  const actOnShow = useCallback(
    async (show: RadioShowSummary, action: "play" | "queue") => {
      if (busy) return;
      setBusy({ id: show.id, action });
      setActionError("");
      try {
        const details = await loadShow(show);
        const track = radioTrackFromShow(details);
        if (action === "play") onPlay(track);
        else onQueue(track);
      } catch (cause) {
        setActionError(String(cause).replace(/^Error:\s*/, ""));
      } finally {
        setBusy(undefined);
      }
    },
    [busy, loadShow, onPlay, onQueue],
  );

  const viewShow = useCallback(
    async (show: RadioShowSummary, sourceTrigger?: HTMLElement) => {
      const parsedShowId = radioShowId(show.id);
      if (!parsedShowId) {
        setActionError("Bandcamp returned an invalid Radio show ID");
        return;
      }
      const returnScrollTop =
        document.querySelector<HTMLElement>("[data-coda-library-scroll]")
          ?.scrollTop ?? 0;
      setActionError("");
      try {
        const outcome = await onOpenShow({
          returnScrollTop,
          sharedIdentityAvailable: true,
          showId: parsedShowId,
          sourceTrigger,
        });
        const failureCopy = radioShowNavigationFailureCopy(outcome);
        if (failureCopy) setActionError(failureCopy);
      } catch (cause) {
        setActionError(String(cause).replace(/^Error:\s*/, ""));
      }
    },
    [onOpenShow],
  );

  const openItem = useCallback((url: string) => {
    setActionError("");
    void openExternal(url).catch((cause) => {
      setActionError(String(cause).replace(/^Error:\s*/, ""));
    });
  }, [openExternal]);

  const actionFor = (show: RadioShowSummary) =>
    busy?.id === show.id ? busy.action : undefined;

  const playShow = useCallback(
    (show: RadioShowSummary) => void actOnShow(show, "play"),
    [actOnShow],
  );

  const queueShow = useCallback(
    (show: RadioShowSummary) => void actOnShow(show, "queue"),
    [actOnShow],
  );

  const viewShowDetails = useCallback(
    (show: RadioShowSummary, trigger: HTMLAnchorElement) =>
      void viewShow(show, trigger),
    [viewShow],
  );

  const selectSeries = useCallback(
    (nextSeriesId?: RadioSeriesId) => {
      startSeriesTransition(async () => {
        await onSelectSeries(nextSeriesId);
        setActionError("");
      });
    },
    [onSelectSeries],
  );

  const seriesNavigation = (
    <RadioSeriesNav
      selectedSeriesId={seriesId}
      pending={seriesPending}
      onSelect={selectSeries}
      seriesTravelSteps={seriesTravelSteps}
    />
  );

  useEffect(() => {
    const target = paginationRef.current;
    const Observer = globalThis.IntersectionObserver;
    if (
      !target ||
      !showsQuery.hasNextPage ||
      showsQuery.isFetchingNextPage ||
      !Observer
    ) {
      return;
    }
    const observer = new Observer(
      ([entry]) => {
        if (entry?.isIntersecting) void showsQuery.fetchNextPage();
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    showsQuery.fetchNextPage,
    showsQuery.hasNextPage,
    showsQuery.isFetchingNextPage,
  ]);

  if (showsQuery.isPending) {
    return (
      <section className="min-h-full pb-2.5">
        {seriesNavigation}
        <div className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]">
          <Spinner
            className="size-7 motion-reduce:animate-none"
            aria-label={`Tuning ${BANDCAMP_RADIO_PROVIDER}`}
          />
          <strong className="mt-3 text-base text-[#cac9c3]">
            Tuning {BANDCAMP_RADIO_PROVIDER}…
          </strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-coda-subtle-foreground">
            Loading the latest artist interviews and curated shows.
          </span>
        </div>
      </section>
    );
  }

  if (showsQuery.isError) {
    return (
      <section className="min-h-full pb-2.5">
        {seriesNavigation}
        <div className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]">
          <Radio size={30} />
          <strong className="mt-3 text-base text-[#cac9c3]">
            {BANDCAMP_RADIO_PROVIDER} is off the air
          </strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-coda-subtle-foreground">
            {String(showsQuery.error).replace(/^Error:\s*/, "")}
          </span>
          <Button
            variant="secondary"
            size="compact"
            className="mt-4 text-xs text-[#dd8973]"
            onClick={() => void showsQuery.refetch()}
            disabled={showsQuery.isFetching}
          >
            {showsQuery.isFetching ? (
              <Spinner
                aria-hidden="true"
                className="size-3.5 text-current motion-reduce:animate-none"
              />
            ) : (
              <RefreshCw size={14} />
            )}
            {showsQuery.isFetching ? "Tuning again…" : "Try again"}
          </Button>
        </div>
      </section>
    );
  }

  if (!featured) {
    return (
      <section className="min-h-full pb-2.5">
        {seriesNavigation}
        <div className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]">
          <Radio size={30} />
          <strong className="mt-3 text-base text-[#cac9c3]">
            No episodes found
          </strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-coda-subtle-foreground">
            {selectedSeries
              ? `Bandcamp did not return any ${selectedSeries.title} episodes.`
              : "Bandcamp did not return any Radio episodes."}
          </span>
        </div>
      </section>
    );
  }

  return (
    <section
      className="min-h-full pb-2.5"
      aria-live="polite"
      aria-busy={Boolean(busy)}
      ref={setArchivePageRoot}
    >
      {seriesNavigation}
      <article className="relative mb-9 grid grid-cols-[minmax(13rem,20rem)_minmax(0,1fr)] items-center gap-16 overflow-hidden rounded-xl border border-(--line) bg-[radial-gradient(circle_at_88%_7%,rgba(221,101,73,0.2),transparent_34%),radial-gradient(circle_at_5%_100%,rgba(115,77,151,0.11),transparent_38%),linear-gradient(135deg,#202325_0%,#17191b_72%)] p-12 shadow-[0_22px_58px_rgba(0,0,0,0.16)] before:pointer-events-none before:absolute before:-top-36 before:-right-24 before:size-90 before:rounded-full before:border before:border-white/4 before:shadow-[0_0_0_46px_rgba(255,255,255,0.012),0_0_0_92px_rgba(255,255,255,0.008)] before:content-[''] max-xl:grid-cols-[12rem_minmax(0,1fr)] max-xl:gap-6 max-xl:p-6 max-lg:grid-cols-[8rem_minmax(0,1fr)] max-lg:items-start max-lg:gap-4 max-lg:p-5">
        <div className="relative z-1 min-w-0 drop-shadow-[0_24px_32px_rgba(0,0,0,0.33)]">
          <RadioArtwork show={featured} eager />
          {featuredShowIdParam ? (
            <Link
              aria-label={`Open ${featured.subtitle}`}
              className="absolute inset-0 rounded-lg outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              data-radio-show-navigation-slot="artwork"
              data-radio-show-open={featured.id}
              onClick={(event) =>
                handleCodaLinkActivation(event, (trigger) =>
                  viewShow(featured, trigger),
                )
              }
              params={{ showId: featuredShowIdParam }}
              to="/radio/shows/$showId"
            />
          ) : null}
        </div>
        <div className="relative z-1 min-w-0">
          <Badge
            variant="artwork"
            className="h-auto gap-1.5 border-0 bg-transparent p-0 text-xs tracking-widest text-[#d17f6b] uppercase"
          >
            <Headphones size={13} />
            {selectedSeries ? "Latest episode" : "Latest broadcast"}
          </Badge>
          <h1
            className="m-0 max-w-2xl font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-6xl leading-none font-semibold tracking-tighter text-balance text-[#f5f2eb] max-xl:text-5xl max-lg:text-3xl"
            data-radio-show-title={featured.id}
          >
            {featuredShowIdParam ? (
              <Link
                className="inline-block max-w-full align-top outline-none hover:text-[#f09a83] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                data-coda-radio-title-text={featured.id}
                data-radio-show-navigation-slot="title"
                data-radio-show-open={featured.id}
                onClick={(event) =>
                  handleCodaLinkActivation(event, (trigger) =>
                    viewShow(featured, trigger),
                  )
                }
                params={{ showId: featuredShowIdParam }}
                to="/radio/shows/$showId"
              >
                {featured.subtitle}
              </Link>
            ) : (
              <span
                className="inline-block max-w-full align-top"
                data-coda-radio-title-text={featured.id}
              >
                {featured.subtitle}
              </span>
            )}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-[#b0b2ac]">
            <span className="inline-flex items-center gap-1">
              <Radio size={13} />
              <RadioSeriesLink show={featured} onBrowse={selectSeries} />
            </span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={13} /> {showDate(featured.publishedAt)}
            </span>
          </div>
          <p className="mt-4 mb-0 max-w-2xl text-sm/relaxed text-[#949891] max-lg:line-clamp-4">
            {featured.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              className={cn(
                currentTrackId === `radio:${featured.id}` &&
                  "bg-coda-primary-hover",
              )}
              onClick={
                currentTrackId === `radio:${featured.id}`
                  ? onTogglePlayback
                  : () => void actOnShow(featured, "play")
              }
              disabled={Boolean(busy)}
              aria-label={
                actionFor(featured) === "play"
                  ? "Loading show…"
                  : currentTrackId === `radio:${featured.id}`
                    ? `${playing ? "Pause" : "Resume"} latest show`
                    : "Play latest show"
              }
              aria-pressed={
                currentTrackId === `radio:${featured.id}` && playing
              }
            >
              {actionFor(featured) === "play" ? (
                <Spinner
                  aria-hidden="true"
                  className="size-4 text-current motion-reduce:animate-none"
                />
              ) : (
                <PlaybackIcon
                  className="size-4"
                  playing={currentTrackId === `radio:${featured.id}` && playing}
                />
              )}
              {actionFor(featured) === "play"
                ? "Loading show…"
                : currentTrackId === `radio:${featured.id}`
                  ? playing
                    ? "Pause latest show"
                    : "Resume latest show"
                  : "Play latest show"}
            </Button>
            <Button
              className={cn(
                favoriteShowIds.has(featured.id) && "text-coda-favorite",
              )}
              onClick={() => onToggleFavorite(featured)}
              disabled={Boolean(busy)}
              aria-pressed={favoriteShowIds.has(featured.id)}
              aria-label={
                favoriteShowIds.has(featured.id)
                  ? `Remove ${featured.subtitle} from favorites`
                  : `Add ${featured.subtitle} to favorites`
              }
            >
              <Heart
                size={16}
                fill={
                  favoriteShowIds.has(featured.id) ? "currentColor" : "none"
                }
              />
              {favoriteShowIds.has(featured.id) ? "Favorited" : "Favorite"}
            </Button>
            <Button
              onClick={() => void actOnShow(featured, "queue")}
              disabled={Boolean(busy)}
            >
              {actionFor(featured) === "queue" ? (
                <Spinner
                  aria-hidden="true"
                  className="size-4 text-current motion-reduce:animate-none"
                />
              ) : (
                <ListPlus size={17} />
              )}
              {actionFor(featured) === "queue" ? "Adding…" : "Add to queue"}
            </Button>
            {featuredShowIdParam ? (
              <Link
                className={buttonVariants()}
                data-radio-show-navigation-slot="tracklist"
                data-radio-show-open={featured.id}
                onClick={(event) =>
                  handleCodaLinkActivation(event, (trigger) =>
                    viewShow(featured, trigger),
                  )
                }
                params={{ showId: featuredShowIdParam }}
                to="/radio/shows/$showId"
              >
                <ListMusic size={17} />
                View tracklist
              </Link>
            ) : null}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openItem(radioEpisodeUrl(featured.id))}
                    aria-label={`Open ${featured.subtitle} on Bandcamp`}
                  />
                }
              >
                <ExternalLink size={16} />
              </TooltipTrigger>
              <TooltipContent>Open on Bandcamp</TooltipContent>
            </Tooltip>
          </div>
          {actionError ? (
            <p className="mt-2 text-xs text-[#d98374]">{actionError}</p>
          ) : null}
        </div>
      </article>

      <div className="mb-4 flex items-end justify-between gap-5">
        <div>
          <Badge
            variant="artwork"
            className="mb-1.5 h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase"
          >
            {selectedSeries ? "Series archive" : "From the archive"}
          </Badge>
          <h2 className="m-0 text-xl font-semibold tracking-tight text-[#deddd7]">
            {selectedSeries
              ? `More from ${selectedSeries.title}`
              : "More shows"}
          </h2>
        </div>
        <span className="text-xs text-[#6f736e]">
          {countLabel(shows.length, "broadcast")} loaded
        </span>
      </div>
      <ResponsiveVirtualGrid
        aria-label={`${BANDCAMP_RADIO_PROVIDER} archive`}
        className="w-full"
        getItemKey={radioShowKey}
        items={visibleShows}
        layouts={RADIO_ARCHIVE_GRID_LAYOUTS}
        scrollElementRef={archiveScrollElementRef}
        renderItem={(show) => {
          const active = currentTrackId === `radio:${show.id}`;
          return (
            <RadioCard
              show={show}
              busyAction={actionFor(show)}
              active={active}
              playing={active && playing}
              onPlay={playShow}
              onTogglePlayback={onTogglePlayback}
              onQueue={queueShow}
              onDetails={viewShowDetails}
              favorite={favoriteShowIds.has(show.id)}
              onToggleFavorite={onToggleFavorite}
              onOpenItem={openItem}
              onBrowseSeries={selectSeries}
            />
          );
        }}
      />
      {showsQuery.hasNextPage ? (
        <div className="grid min-h-20 place-items-center" ref={paginationRef}>
          <Button
            variant="secondary"
            size="compact"
            className="mt-6"
            onClick={() => void showsQuery.fetchNextPage()}
            disabled={showsQuery.isFetchingNextPage}
          >
            {showsQuery.isFetchingNextPage ? (
              <Spinner
                aria-hidden="true"
                className="size-3.5 text-current motion-reduce:animate-none"
              />
            ) : null}
            {showsQuery.isFetchingNextPage
              ? "Loading more shows…"
              : "Load more radio shows"}
          </Button>
          <span className="mt-2 text-xs text-[#5f635f]">
            More episodes load automatically as you scroll.
          </span>
        </div>
      ) : null}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[#676b66]">
        <Clock3 size={13} />
        Shows stream directly from Bandcamp. Episode audio is not copied or
        cached by Coda.
      </p>
    </section>
  );
}

export type RadioIndexScreenProps = Omit<RadioArchiveScreenProps, "seriesId">;

export function RadioIndexScreen(props: RadioIndexScreenProps) {
  return <RadioArchiveScreen {...props} />;
}

export type RadioSeriesScreenProps = Omit<RadioArchiveScreenProps, "seriesId"> &
  Readonly<{
    seriesId: RadioSeriesId;
  }>;

export function RadioSeriesScreen({
  seriesId,
  ...props
}: RadioSeriesScreenProps) {
  return <RadioArchiveScreen {...props} seriesId={seriesId} />;
}
