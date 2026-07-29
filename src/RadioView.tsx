import {
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
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
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { countLabel } from "./countLabel";
import {
  fetchRadioShow,
  fetchRadioShows,
  formatTime,
  initials,
  openBandcampUrl,
  paletteFor,
} from "./lib";
import {
  RadioChapterArtwork,
  RadioChapterCopy,
} from "./RadioChapterMetadata";
import {
  boundRadioChapters,
  radioAiringIndexesAt,
} from "./radioPlayback";
import type { PlaybackClock } from "./playbackClock";
import type { RadioShow, RadioShowSummary, Track } from "./types";
import {
  BANDCAMP_RADIO_SERIES,
  radioEpisodeUrl,
} from "./radioSeries";
import { transitionCodaView } from "./viewTransitions";

const RADIO_STALE_TIME_MS = 10 * 60 * 1_000;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function showDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : dateFormatter.format(parsed);
}

function radioTrack(show: RadioShow): Track {
  return {
    id: `radio:${show.id}`,
    title: show.subtitle,
    artist: "Bandcamp Radio",
    album: show.title,
    albumId: `radio:${show.id}`,
    duration: show.duration,
    track: 1,
    artworkUrl: show.artworkUrl,
    streamUrl: show.streamUrl,
    radioChapters: boundRadioChapters(show.chapters),
    palette: paletteFor(`radio:${show.id}`),
  };
}

const RadioArtwork = memo(function RadioArtwork({
  show,
  eager = false,
  className,
}: {
  show: RadioShowSummary;
  eager?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid aspect-square place-items-center overflow-hidden rounded-lg border border-white/7 bg-coda-hover text-6xl font-bold text-[#a2a49f]",
        className,
      )}
    >
      {show.artworkUrl ? (
        <img
          className="size-full object-cover"
          src={show.artworkUrl}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
        />
      ) : (
        <span>{initials(show.subtitle)}</span>
      )}
    </div>
  );
});

const RadioSeriesLink = memo(function RadioSeriesLink({
  show,
  onBrowse,
}: {
  show: RadioShowSummary;
  onBrowse: (seriesId: number) => void;
}) {
  if (!show.series) {
    return <span className="inline-flex max-w-full items-center truncate">Bandcamp Radio</span>;
  }
  const series = show.series;
  return (
    <Button
      type="button"
      variant="text"
      size="compact"
      className="h-auto max-w-full justify-start overflow-hidden p-0 text-left text-inherit hover:bg-transparent hover:text-[#f09a83]"
      onClick={() => onBrowse(series.id)}
      aria-label={`Browse ${series.title} episodes`}
      title={`Browse ${series.title} in Coda`}
    >
      <span className="truncate">{series.title}</span>
    </Button>
  );
});

const RadioSeriesNav = memo(function RadioSeriesNav({
  selectedSeriesId,
  pending,
  onSelect,
}: {
  selectedSeriesId?: number;
  pending: boolean;
  onSelect: (seriesId?: number) => void;
}) {
  return (
    <nav
      className="mb-4 flex items-end justify-between gap-6 max-xl:flex-col max-xl:items-start max-xl:gap-2.5"
      aria-label="Bandcamp Radio shows"
    >
      <div className="grid shrink-0 gap-1">
        <Badge variant="artwork" className="h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase">
          Browse by show
        </Badge>
        <strong className="font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-lg/tight font-semibold tracking-tight text-[#e5e3dc]">
          Bandcamp Radio
        </strong>
      </div>
      <div className="flex min-w-0 scrollbar-none gap-1 overflow-x-auto p-0.5 max-xl:w-full [&::-webkit-scrollbar]:hidden">
        <Button
          type="button"
          variant="ghost"
          size="compact"
          className={cn(
            "h-8 shrink-0 rounded-md border border-transparent px-2.5 text-xs text-[#858984] hover:border-(--line) hover:bg-white/2.5 hover:text-[#c8c8c2] disabled:cursor-wait disabled:opacity-60",
            selectedSeriesId === undefined &&
              "border-primary/20 bg-accent text-accent-foreground hover:border-primary/20 hover:bg-accent hover:text-accent-foreground",
          )}
          onClick={() => onSelect()}
          aria-pressed={selectedSeriesId === undefined}
          disabled={pending}
        >
          All shows
        </Button>
        {BANDCAMP_RADIO_SERIES.map((series) => (
          <Button
            type="button"
            key={series.id}
            variant="ghost"
            size="compact"
            className={cn(
              "h-8 shrink-0 rounded-md border border-transparent px-2.5 text-xs text-[#858984] hover:border-(--line) hover:bg-white/2.5 hover:text-[#c8c8c2] disabled:cursor-wait disabled:opacity-60",
              selectedSeriesId === series.id &&
                "border-primary/20 bg-accent text-accent-foreground hover:border-primary/20 hover:bg-accent hover:text-accent-foreground",
            )}
            onClick={() => onSelect(series.id)}
            aria-pressed={selectedSeriesId === series.id}
            disabled={pending}
          >
            {series.title}
          </Button>
        ))}
      </div>
    </nav>
  );
});

const RadioCard = memo(function RadioCard({
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
}: {
  show: RadioShowSummary;
  busyAction?: "play" | "queue" | "detail";
  active: boolean;
  playing: boolean;
  onPlay: (show: RadioShowSummary) => void;
  onTogglePlayback: () => void;
  onQueue: (show: RadioShowSummary) => void;
  onDetails: (show: RadioShowSummary) => void;
  favorite: boolean;
  onToggleFavorite: (show: RadioShowSummary) => void;
  onOpenItem: (url: string) => void;
  onBrowseSeries: (seriesId: number) => void;
}) {
  return (
    <article className="group/card min-w-0 overflow-hidden rounded-lg border border-(--line) bg-white/2 transition-[transform,border-color,background-color] duration-(--duration-coda-standard) ease-coda-enter [contain-intrinsic-size:24rem_15rem] [content-visibility:auto] hover:-translate-y-0.5 hover:border-(--line-strong) hover:bg-white/4 motion-reduce:transition-none">
      <RadioArtwork
        show={show}
        className="rounded-none border-x-0 border-t-0 text-3xl"
      />
      <div className="flex min-h-44 flex-col p-3.5">
        <div className="min-h-3.5 text-xs font-bold tracking-widest text-[#cb7560] uppercase">
          <RadioSeriesLink
            show={show}
            onBrowse={onBrowseSeries}
          />
        </div>
        <h3
          className="mt-1.5 mb-1 truncate font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base/tight font-semibold text-[#ebe9e3]"
          title={show.subtitle}
        >
          {show.subtitle}
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
              <Spinner aria-hidden="true" className="size-4 text-current motion-reduce:animate-none" />
            ) : (
              <PlaybackIcon
                className="size-4"
                playing={active && playing}
              />
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
            <TooltipContent>{favorite ? "Remove from favorites" : "Add to favorites"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-compact"
                  className="size-8"
                  onClick={() => onDetails(show)}
                  disabled={Boolean(busyAction)}
                  aria-label={`View tracklist for ${show.subtitle}`}
                />
              }
            >
              {busyAction === "detail" ? (
                <Spinner aria-hidden="true" className="size-4 text-current motion-reduce:animate-none" />
              ) : (
                <ListMusic size={15} />
              )}
            </TooltipTrigger>
            <TooltipContent>View tracklist</TooltipContent>
          </Tooltip>
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
                <Spinner aria-hidden="true" className="size-4 text-current motion-reduce:animate-none" />
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

const RadioDetail = memo(function RadioDetail({
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
  onBrowseSeries: (seriesId: number) => void;
}) {
  const track = useMemo(() => radioTrack(show), [show]);
  const chapters = track.radioChapters ?? [];
  const activeShow = currentTrackId === track.id;
  const getCurrentChapterIndex = useCallback(
    () =>
      activeShow
        ? radioAiringIndexesAt(chapters, playbackClock.getSnapshot()).currentIndex
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

  return (
    <section
      className="mx-auto w-full max-w-5xl animate-[saved-page-in_180ms_ease-out] pt-2 pb-12 motion-reduce:animate-none"
      aria-labelledby="radio-detail-title"
    >
      <Button
        variant="text"
        size="compact"
        className="mb-3.5 -ml-1 h-auto gap-1.5 p-1 text-xs text-[#969994] hover:bg-transparent hover:text-foreground"
        onClick={onBack}
      >
        <ArrowLeft size={16} />
        Back to Radio
      </Button>
      <header className="grid min-h-76 grid-cols-[16rem_minmax(0,1fr)] items-center gap-12 overflow-hidden rounded-xl border border-(--line) bg-[radial-gradient(circle_at_78%_5%,rgba(221,101,73,0.15),transparent_40%),linear-gradient(140deg,#25292b,#181b1d_72%)] p-8 max-xl:min-h-64 max-xl:grid-cols-[12rem_minmax(0,1fr)] max-xl:gap-6 max-xl:p-6 max-lg:min-h-48 max-lg:grid-cols-[8rem_minmax(0,1fr)] max-lg:gap-4 max-lg:p-5">
        <div className="aspect-square w-64 drop-shadow-[0_22px_30px_rgba(0,0,0,0.32)] max-xl:w-48 max-lg:w-32 [&>div]:size-full">
          <RadioArtwork show={show} eager />
        </div>
        <div className="min-w-0">
          <Badge
            variant="artwork"
            className="h-auto gap-1.5 border-0 bg-transparent p-0 text-xs tracking-widest text-[#d47761] uppercase"
          >
            <Radio size={13} />
            <RadioSeriesLink
              show={show}
              onBrowse={onBrowseSeries}
            />
          </Badge>
          <h1
            id="radio-detail-title"
            className="m-0 max-w-2xl font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-5xl/tight font-semibold tracking-tighter text-balance text-[#f3f0ea] max-lg:text-3xl"
          >
            {show.subtitle}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-[#b0b2ac]">
            <span className="inline-flex items-center gap-1"><CalendarDays size={13} /> {showDate(show.publishedAt)}</span>
            <span className="inline-flex items-center gap-1"><Clock3 size={13} /> {formatTime(show.duration)}</span>
            <span className="inline-flex items-center gap-1"><ListMusic size={13} /> {countLabel(chapters.length, "chapter")}</span>
          </div>
          <p className="mt-4 mb-0 line-clamp-4 max-w-2xl text-sm/relaxed text-[#999c97] max-lg:line-clamp-3">
            {show.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              className={cn(activeShow && "bg-coda-primary-hover")}
              onClick={activeShow ? onTogglePlayback : () => onPlay(track)}
              aria-label={activeShow ? `${playing ? "Pause" : "Resume"} show` : "Play show"}
              aria-pressed={activeShow && playing}
            >
              <PlaybackIcon
                className="size-4"
                playing={activeShow && playing}
              />
              {activeShow ? (playing ? "Pause show" : "Resume show") : "Play show"}
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
            {show.series ? (
              <Button
                onClick={() => onBrowseSeries(show.series!.id)}
              >
                <Radio size={16} />
                Browse all episodes
              </Button>
            ) : null}
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
          <Badge variant="artwork" className="mb-1.5 h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase">
            Broadcast tracklist
          </Badge>
          <h2 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-lg/tight font-semibold text-[#deddd7]">
            Songs in this show
          </h2>
        </div>
        <span className="text-xs text-[#777b76]">{countLabel(chapters.length, "chapter")}</span>
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
                    activeChapter && "border-primary/30 bg-primary/15 text-[#ec947d]",
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
                  title={activeChapter ? (playing ? "Pause" : "Resume") : "Play from here"}
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
        <p className="mt-2.5 text-xs text-[#d28070]" role="status">{actionError}</p>
      ) : null}
    </section>
  );
});

export default function RadioView({
  onPlay,
  onQueue,
  onPlayAt,
  currentTrackId,
  playbackClock,
  playing,
  onTogglePlayback,
  favoriteShowIds,
  onToggleFavorite,
  selectedSeriesId,
  onSelectSeries,
  requestedShowId,
  onRequestedShowChange,
}: {
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onPlayAt?: (track: Track, position: number) => void;
  currentTrackId?: string;
  playbackClock: PlaybackClock;
  playing: boolean;
  onTogglePlayback: () => void;
  favoriteShowIds: ReadonlySet<number>;
  onToggleFavorite: (show: RadioShowSummary) => void;
  selectedSeriesId?: number;
  onSelectSeries: (seriesId?: number) => void;
  requestedShowId?: number;
  onRequestedShowChange: (showId?: number) => void;
}) {
  const queryClient = useQueryClient();
  const [seriesPending, startSeriesTransition] = useTransition();
  const paginationRef = useRef<HTMLDivElement>(null);
  const showsQuery = useInfiniteQuery({
    queryKey: ["bandcamp-radio", selectedSeriesId ?? "all"],
    queryFn: ({ pageParam }) =>
      fetchRadioShows({
        seriesId: selectedSeriesId,
        cursor: pageParam ?? undefined,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) =>
      page.hasMore && page.cursor ? page.cursor : undefined,
    staleTime: RADIO_STALE_TIME_MS,
  });
  const [busy, setBusy] = useState<{
    id: number;
    action: "play" | "queue" | "detail";
  }>();
  const [selectedShow, setSelectedShow] = useState<RadioShow>();
  const [actionError, setActionError] = useState("");
  const selectedSeries = BANDCAMP_RADIO_SERIES.find(
    (series) => series.id === selectedSeriesId,
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
  const visibleShows = shows.slice(1);

  const loadShow = useCallback(
    (id: number) =>
      queryClient.fetchQuery({
        queryKey: ["bandcamp-radio-show", id],
        queryFn: () => fetchRadioShow(id),
        staleTime: RADIO_STALE_TIME_MS,
      }),
    [queryClient],
  );

  const actOnShow = useCallback(
    async (show: RadioShowSummary, action: "play" | "queue") => {
      if (busy) return;
      setBusy({ id: show.id, action });
      setActionError("");
      try {
        const loaded = await loadShow(show.id);
        const details = loaded.series || !show.series
          ? loaded
          : { ...loaded, series: show.series };
        const track = radioTrack(details);
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
    async (show: RadioShowSummary) => {
      if (busy) return;
      setBusy({ id: show.id, action: "detail" });
      setActionError("");
      try {
        const loaded = await loadShow(show.id);
        const details = loaded.series || !show.series
          ? loaded
          : { ...loaded, series: show.series };
        void transitionCodaView(() => {
          onRequestedShowChange(show.id);
          setSelectedShow(details);
        }, "page-forward");
      } catch (cause) {
        setActionError(String(cause).replace(/^Error:\s*/, ""));
      } finally {
        setBusy(undefined);
      }
    },
    [busy, loadShow, onRequestedShowChange],
  );

  const openItem = useCallback((url: string) => {
    setActionError("");
    void openBandcampUrl(url).catch((cause) => {
      setActionError(String(cause).replace(/^Error:\s*/, ""));
    });
  }, []);

  const actionFor = (show: RadioShowSummary) =>
    busy?.id === show.id ? busy.action : undefined;

  const selectSeries = useCallback((seriesId?: number) => {
    startSeriesTransition(() => {
      onSelectSeries(seriesId);
      onRequestedShowChange(undefined);
      setSelectedShow(undefined);
      setActionError("");
    });
  }, [onRequestedShowChange, onSelectSeries]);

  useEffect(() => {
    if (!requestedShowId || selectedShow?.id === requestedShowId) return;
    let active = true;
    setBusy({ id: requestedShowId, action: "detail" });
    setActionError("");
    void loadShow(requestedShowId)
      .then((show) => {
        if (active) setSelectedShow(show);
      })
      .catch((cause) => {
        if (!active) return;
        setActionError(String(cause).replace(/^Error:\s*/, ""));
        onRequestedShowChange(undefined);
      })
      .finally(() => {
        if (!active) return;
        setBusy((current) =>
          current?.id === requestedShowId && current.action === "detail"
            ? undefined
            : current,
        );
      });
    return () => {
      active = false;
    };
  }, [
    loadShow,
    onRequestedShowChange,
    requestedShowId,
    selectedShow?.id,
  ]);

  const seriesNavigation = (
    <RadioSeriesNav
      selectedSeriesId={selectedSeriesId}
      pending={seriesPending}
      onSelect={selectSeries}
    />
  );

  useEffect(() => {
    const target = paginationRef.current;
    if (
      !target ||
      selectedShow ||
      !showsQuery.hasNextPage ||
      showsQuery.isFetchingNextPage ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void showsQuery.fetchNextPage();
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [
    selectedShow,
    showsQuery.fetchNextPage,
    showsQuery.hasNextPage,
    showsQuery.isFetchingNextPage,
  ]);

  if (showsQuery.isPending) {
    return (
      <section className="min-h-full animate-[radio-view-in_320ms_var(--ease-coda-enter)] pb-2.5 motion-reduce:animate-none">
        {seriesNavigation}
        <div className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]">
          <Spinner className="size-7 motion-reduce:animate-none" aria-label="Tuning Bandcamp Radio" />
          <strong className="mt-3 text-base text-[#cac9c3]">Tuning Bandcamp Radio…</strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-[#777b76]">
            Loading the latest artist interviews and curated shows.
          </span>
        </div>
      </section>
    );
  }

  if (showsQuery.isError) {
    return (
      <section className="min-h-full animate-[radio-view-in_320ms_var(--ease-coda-enter)] pb-2.5 motion-reduce:animate-none">
        {seriesNavigation}
        <div className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]">
          <Radio size={30} />
          <strong className="mt-3 text-base text-[#cac9c3]">Bandcamp Radio is off the air</strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-[#777b76]">
            {String(showsQuery.error).replace(/^Error:\s*/, "")}
          </span>
          <Button
            variant="secondary"
            size="compact"
            className="mt-4 text-xs text-[#dd8973]"
            onClick={() => void showsQuery.refetch()}
            disabled={showsQuery.isFetching}
          >
            {showsQuery.isFetching
              ? <Spinner aria-hidden="true" className="size-3.5 text-current motion-reduce:animate-none" />
              : <RefreshCw size={14} />}
            {showsQuery.isFetching ? "Tuning again…" : "Try again"}
          </Button>
        </div>
      </section>
    );
  }

  if (
    requestedShowId &&
    !selectedShow &&
    busy?.id === requestedShowId &&
    busy.action === "detail"
  ) {
    return (
      <section
        className="min-h-full animate-[radio-view-in_320ms_var(--ease-coda-enter)] pb-2.5 motion-reduce:animate-none"
        aria-busy="true"
        aria-live="polite"
      >
        {seriesNavigation}
        <div className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]">
          <Spinner
            className="size-7 motion-reduce:animate-none"
            aria-label="Loading Radio show details"
          />
          <strong className="mt-3 text-base text-[#cac9c3]">
            Loading show details…
          </strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-[#777b76]">
            Fetching the episode audio and tracklist from Bandcamp.
          </span>
        </div>
      </section>
    );
  }

  if (!featured) {
    return (
      <section className="min-h-full animate-[radio-view-in_320ms_var(--ease-coda-enter)] pb-2.5 motion-reduce:animate-none">
        {seriesNavigation}
        <div className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]">
          <Radio size={30} />
          <strong className="mt-3 text-base text-[#cac9c3]">No episodes found</strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-[#777b76]">
            {selectedSeries
              ? `Bandcamp did not return any ${selectedSeries.title} episodes.`
              : "Bandcamp did not return any Radio episodes."}
          </span>
        </div>
      </section>
    );
  }

  if (selectedShow) {
    return (
      <RadioDetail
        show={selectedShow}
        actionError={actionError}
        onBack={() => {
          void transitionCodaView(() => {
            setSelectedShow(undefined);
            onRequestedShowChange(undefined);
            setActionError("");
          }, "page-back");
        }}
        onPlay={onPlay}
        onQueue={onQueue}
        onPlayAt={onPlayAt}
        currentTrackId={currentTrackId}
        playbackClock={playbackClock}
        playing={playing}
        onTogglePlayback={onTogglePlayback}
        onOpenItem={openItem}
        favorite={favoriteShowIds.has(selectedShow.id)}
        onToggleFavorite={onToggleFavorite}
        onBrowseSeries={selectSeries}
      />
    );
  }

  return (
    <section
      className="min-h-full animate-[radio-view-in_320ms_var(--ease-coda-enter)] pb-2.5 motion-reduce:animate-none"
      aria-live="polite"
      aria-busy={Boolean(busy)}
    >
      {seriesNavigation}
      <article className="relative mb-9 grid grid-cols-[minmax(13rem,20rem)_minmax(0,1fr)] items-center gap-16 overflow-hidden rounded-xl border border-(--line) bg-[radial-gradient(circle_at_88%_7%,rgba(221,101,73,0.2),transparent_34%),radial-gradient(circle_at_5%_100%,rgba(115,77,151,0.11),transparent_38%),linear-gradient(135deg,#202325_0%,#17191b_72%)] p-12 shadow-[0_22px_58px_rgba(0,0,0,0.16)] before:pointer-events-none before:absolute before:-top-36 before:-right-24 before:size-90 before:rounded-full before:border before:border-white/4 before:shadow-[0_0_0_46px_rgba(255,255,255,0.012),0_0_0_92px_rgba(255,255,255,0.008)] before:content-[''] max-xl:grid-cols-[12rem_minmax(0,1fr)] max-xl:gap-6 max-xl:p-6 max-lg:grid-cols-[8rem_minmax(0,1fr)] max-lg:items-start max-lg:gap-4 max-lg:p-5">
        <div className="relative z-1 min-w-0 drop-shadow-[0_24px_32px_rgba(0,0,0,0.33)]">
          <RadioArtwork show={featured} eager />
        </div>
        <div className="relative z-1 min-w-0">
          <Badge
            variant="artwork"
            className="h-auto gap-1.5 border-0 bg-transparent p-0 text-xs tracking-widest text-[#d17f6b] uppercase"
          >
            <Headphones size={13} />
            {selectedSeries ? "Latest episode" : "Latest broadcast"}
          </Badge>
          <h1 className="m-0 max-w-2xl font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-6xl leading-none font-semibold tracking-tighter text-balance text-[#f5f2eb] max-xl:text-5xl max-lg:text-3xl">
            {featured.subtitle}
          </h1>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-semibold text-[#b0b2ac]">
            <span className="inline-flex items-center gap-1">
              <Radio size={13} />
              <RadioSeriesLink
                show={featured}
                onBrowse={selectSeries}
              />
            </span>
            <span className="inline-flex items-center gap-1"><CalendarDays size={13} /> {showDate(featured.publishedAt)}</span>
          </div>
          <p className="mt-4 mb-0 max-w-2xl text-sm/relaxed text-[#949891] max-lg:line-clamp-4">
            {featured.description}
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              className={cn(
                currentTrackId === `radio:${featured.id}` && "bg-coda-primary-hover",
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
              aria-pressed={currentTrackId === `radio:${featured.id}` && playing}
            >
              {actionFor(featured) === "play" ? (
                <Spinner aria-hidden="true" className="size-4 text-current motion-reduce:animate-none" />
              ) : (
                <PlaybackIcon
                  className="size-4"
                  playing={
                    currentTrackId === `radio:${featured.id}` && playing
                  }
                />
              )}
              {actionFor(featured) === "play"
                ? "Loading show…"
                : currentTrackId === `radio:${featured.id}`
                  ? (playing ? "Pause latest show" : "Resume latest show")
                  : "Play latest show"}
            </Button>
            <Button
              className={cn(favoriteShowIds.has(featured.id) && "text-[#ef8066]")}
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
                fill={favoriteShowIds.has(featured.id) ? "currentColor" : "none"}
              />
              {favoriteShowIds.has(featured.id) ? "Favorited" : "Favorite"}
            </Button>
            <Button
              onClick={() => void actOnShow(featured, "queue")}
              disabled={Boolean(busy)}
            >
              {actionFor(featured) === "queue" ? (
                <Spinner aria-hidden="true" className="size-4 text-current motion-reduce:animate-none" />
              ) : (
                <ListPlus size={17} />
              )}
              {actionFor(featured) === "queue" ? "Adding…" : "Add to queue"}
            </Button>
            <Button
              onClick={() => void viewShow(featured)}
              disabled={Boolean(busy)}
            >
              {actionFor(featured) === "detail" ? (
                <Spinner aria-hidden="true" className="size-4 text-current motion-reduce:animate-none" />
              ) : (
                <ListMusic size={17} />
              )}
              {actionFor(featured) === "detail" ? "Loading tracklist…" : "View tracklist"}
            </Button>
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
          {actionError ? <p className="mt-2 text-xs text-[#d98374]">{actionError}</p> : null}
        </div>
      </article>

      <div className="mb-4 flex items-end justify-between gap-5">
        <div>
          <Badge variant="artwork" className="mb-1.5 h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase">
            {selectedSeries ? "Series archive" : "From the archive"}
          </Badge>
          <h2 className="m-0 text-xl font-semibold tracking-tight text-[#deddd7]">
            {selectedSeries ? `More from ${selectedSeries.title}` : "More shows"}
          </h2>
        </div>
        <span className="text-xs text-[#6f736e]">{countLabel(shows.length, "broadcast")} loaded</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3.5 max-lg:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
        {visibleShows.map((show) => (
          <RadioCard
            key={show.id}
            show={show}
            busyAction={actionFor(show)}
            active={currentTrackId === `radio:${show.id}`}
            playing={playing}
            onPlay={(item) => void actOnShow(item, "play")}
            onTogglePlayback={onTogglePlayback}
            onQueue={(item) => void actOnShow(item, "queue")}
            onDetails={(item) => void viewShow(item)}
            favorite={favoriteShowIds.has(show.id)}
            onToggleFavorite={onToggleFavorite}
            onOpenItem={openItem}
            onBrowseSeries={selectSeries}
          />
        ))}
      </div>
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
              <Spinner aria-hidden="true" className="size-3.5 text-current motion-reduce:animate-none" />
            ) : null}
            {showsQuery.isFetchingNextPage
              ? "Loading more shows…"
              : "Load more radio shows"}
          </Button>
          <span className="mt-2 text-xs text-[#5f635f]">More episodes load automatically as you scroll.</span>
        </div>
      ) : null}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[#676b66]">
        <Clock3 size={13} />
        Shows stream directly from Bandcamp. Episode audio is not copied or cached by Coda.
      </p>
    </section>
  );
}
