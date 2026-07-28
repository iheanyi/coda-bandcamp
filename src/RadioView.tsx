import { Button } from "./components/ui/Button";
import { IconButton } from "./components/ui/IconButton";
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
  LoaderCircle,
  Pause,
  Play,
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
}: {
  show: RadioShowSummary;
  eager?: boolean;
}) {
  return (
    <div className="radio-artwork">
      {show.artworkUrl ? (
        <img
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
    return <span className="radio-series-link is-static">Bandcamp Radio</span>;
  }
  const series = show.series;
  return (
    <button
      type="button"
      className="radio-series-link"
      onClick={() => onBrowse(series.id)}
      aria-label={`Browse ${series.title} episodes`}
      title={`Browse ${series.title} in Coda`}
    >
      {series.title}
    </button>
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
    <nav className="radio-series-nav" aria-label="Bandcamp Radio shows">
      <div className="radio-series-nav__copy">
        <span className="eyebrow">Browse by show</span>
        <strong>Bandcamp Radio</strong>
      </div>
      <div className="radio-series-nav__tabs">
        <button
          type="button"
          className={selectedSeriesId === undefined ? "is-active" : ""}
          onClick={() => onSelect()}
          aria-pressed={selectedSeriesId === undefined}
          disabled={pending}
        >
          All shows
        </button>
        {BANDCAMP_RADIO_SERIES.map((series) => (
          <button
            type="button"
            key={series.id}
            className={selectedSeriesId === series.id ? "is-active" : ""}
            onClick={() => onSelect(series.id)}
            aria-pressed={selectedSeriesId === series.id}
            disabled={pending}
          >
            {series.title}
          </button>
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
    <article className="radio-card">
      <RadioArtwork show={show} />
      <div className="radio-card__body">
        <div className="radio-card__series">
          <RadioSeriesLink
            show={show}
            onBrowse={onBrowseSeries}
          />
        </div>
        <h3 title={show.subtitle}>{show.subtitle}</h3>
        <time dateTime={show.publishedAt}>{showDate(show.publishedAt)}</time>
        <p>{show.description}</p>
        <div className="radio-card__actions">
          <button
            className={`radio-card__play ${active ? "is-current" : ""} ${active && playing ? "is-playing" : ""}`}
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
              <LoaderCircle className="spin" size={15} />
            ) : active && playing ? (
              <Pause size={15} fill="currentColor" />
            ) : (
              <Play size={15} fill="currentColor" />
            )}
            {active ? (playing ? "Pause" : "Resume") : "Play"}
          </button>
          <IconButton className={`favorite-button ${favorite ? "is-favorite" : ""}`}
            onClick={() => onToggleFavorite(show)}
            disabled={Boolean(busyAction)}
            aria-label={
              favorite
                ? `Remove ${show.subtitle} from favorites`
                : `Add ${show.subtitle} to favorites`
            }
            aria-pressed={favorite}
            title={favorite ? "Remove from favorites" : "Add to favorites"}
          >
            <Heart size={15} fill={favorite ? "currentColor" : "none"} />
          </IconButton>
          <IconButton onClick={() => onDetails(show)}
            disabled={Boolean(busyAction)}
            aria-label={`View tracklist for ${show.subtitle}`}
            title="View tracklist"
          >
            {busyAction === "detail" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ListMusic size={15} />
            )}
          </IconButton>
          <IconButton onClick={() => onQueue(show)}
            disabled={Boolean(busyAction)}
            aria-label={`Add ${show.subtitle} to queue`}
            title="Add show to queue"
          >
            {busyAction === "queue" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ListPlus size={15} />
            )}
          </IconButton>
          <IconButton onClick={() => onOpenItem(radioEpisodeUrl(show.id))}
            aria-label={`Open ${show.subtitle} on Bandcamp`}
            title="Open on Bandcamp"
          >
            <ExternalLink size={14} />
          </IconButton>
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
    <section className="radio-detail" aria-labelledby="radio-detail-title">
      <button className="radio-detail__back" onClick={onBack}>
        <ArrowLeft size={16} />
        Back to Radio
      </button>
      <header className="radio-detail__hero">
        <div className="radio-detail__art">
          <RadioArtwork show={show} eager />
        </div>
        <div className="radio-detail__copy">
          <div className="eyebrow radio-detail__series">
            <Radio size={13} />
            <RadioSeriesLink
              show={show}
              onBrowse={onBrowseSeries}
            />
          </div>
          <h1 id="radio-detail-title">{show.subtitle}</h1>
          <div className="radio-feature__meta">
            <span><CalendarDays size={13} /> {showDate(show.publishedAt)}</span>
            <span><Clock3 size={13} /> {formatTime(show.duration)}</span>
            <span><ListMusic size={13} /> {countLabel(chapters.length, "chapter")}</span>
          </div>
          <p>{show.description}</p>
          <div className="radio-feature__actions">
            <Button variant="primary"
              className={`${activeShow ? "is-current" : ""} ${activeShow && playing ? "is-playing" : ""}`}
              onClick={activeShow ? onTogglePlayback : () => onPlay(track)}
              aria-label={activeShow ? `${playing ? "Pause" : "Resume"} show` : "Play show"}
              aria-pressed={activeShow && playing}
            >
              {activeShow && playing
                ? <Pause size={17} fill="currentColor" />
                : <Play size={17} fill="currentColor" />}
              {activeShow ? (playing ? "Pause show" : "Resume show") : "Play show"}
            </Button>
            <Button variant="secondary" onClick={() => onQueue(track)}>
              <ListPlus size={17} />
              Add to queue
            </Button>
            <Button variant="secondary"
              className={`favorite-button ${favorite ? "is-favorite" : ""}`}
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
              <Button variant="secondary"
                onClick={() => onBrowseSeries(show.series!.id)}
              >
                <Radio size={16} />
                Browse all episodes
              </Button>
            ) : null}
            <IconButton onClick={() => onOpenItem(radioEpisodeUrl(show.id))}
              aria-label={`Open ${show.subtitle} on Bandcamp`}
              title="Open on Bandcamp"
            >
              <ExternalLink size={16} />
            </IconButton>
          </div>
        </div>
      </header>

      <div className="radio-detail__heading">
        <div>
          <span className="eyebrow">Broadcast tracklist</span>
          <h2>Songs in this show</h2>
        </div>
        <span>{countLabel(chapters.length, "chapter")}</span>
      </div>
      {chapters.length ? (
        <ol className="radio-detail__chapters">
          {chapters.map((chapter, index) => {
            const activeChapter = currentChapter === chapter;
            return (
              <li
                className={`radio-detail__chapter ${activeChapter ? "is-current" : ""}`}
                key={`${chapter.timecode}-${chapter.artist}-${chapter.title}-${index}`}
              >
              <RadioChapterArtwork chapter={chapter} index={index} />
              <RadioChapterCopy
                chapter={chapter}
                className="radio-detail__chapter-copy"
                onOpen={onOpenItem}
              />
              <time>{formatTime(chapter.timecode)}</time>
              {onPlayAt ? (
                <button
                  className={`radio-detail__chapter-play ${activeChapter ? "is-current" : ""} ${activeChapter && playing ? "is-playing" : ""}`}
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
                  {activeChapter && playing
                    ? <Pause size={14} fill="currentColor" />
                    : <Play size={14} fill="currentColor" />}
                  {activeChapter ? (playing ? "Pause" : "Resume") : "Play"}
                </button>
              ) : null}
            </li>
            );
          })}
        </ol>
      ) : (
        <p className="radio-detail__empty">Bandcamp did not provide a tracklist for this show.</p>
      )}
      {actionError ? (
        <p className="radio-action-error" role="status">{actionError}</p>
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
      <section className="radio-view">
        {seriesNavigation}
        <div className="radio-status">
          <LoaderCircle className="spin" size={28} />
          <strong>Tuning Bandcamp Radio…</strong>
          <span>Loading the latest artist interviews and curated shows.</span>
        </div>
      </section>
    );
  }

  if (showsQuery.isError) {
    return (
      <section className="radio-view">
        {seriesNavigation}
        <div className="radio-status">
          <Radio size={30} />
          <strong>Bandcamp Radio is off the air</strong>
          <span>{String(showsQuery.error).replace(/^Error:\s*/, "")}</span>
          <button
            onClick={() => void showsQuery.refetch()}
            disabled={showsQuery.isFetching}
          >
            {showsQuery.isFetching
              ? <LoaderCircle className="spin" size={14} />
              : <RefreshCw size={14} />}
            {showsQuery.isFetching ? "Tuning again…" : "Try again"}
          </button>
        </div>
      </section>
    );
  }

  if (!featured) {
    return (
      <section className="radio-view">
        {seriesNavigation}
        <div className="radio-status">
          <Radio size={30} />
          <strong>No episodes found</strong>
          <span>
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
    <section className="radio-view" aria-live="polite" aria-busy={Boolean(busy)}>
      {seriesNavigation}
      <article className="radio-feature">
        <div className="radio-feature__art">
          <RadioArtwork show={featured} eager />
        </div>
        <div className="radio-feature__copy">
          <span className="eyebrow">
            <Headphones size={13} />
            {selectedSeries ? "Latest episode" : "Latest broadcast"}
          </span>
          <h1>{featured.subtitle}</h1>
          <div className="radio-feature__meta">
            <span>
              <Radio size={13} />
              <RadioSeriesLink
                show={featured}
                onBrowse={selectSeries}
              />
            </span>
            <span><CalendarDays size={13} /> {showDate(featured.publishedAt)}</span>
          </div>
          <p>{featured.description}</p>
          <div className="radio-feature__actions">
            <Button variant="primary"
              className={`${currentTrackId === `radio:${featured.id}` ? "is-current" : ""} ${currentTrackId === `radio:${featured.id}` && playing ? "is-playing" : ""}`}
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
                <LoaderCircle className="spin" size={17} />
              ) : currentTrackId === `radio:${featured.id}` && playing ? (
                <Pause size={17} fill="currentColor" />
              ) : (
                <Play size={17} fill="currentColor" />
              )}
              {actionFor(featured) === "play"
                ? "Loading show…"
                : currentTrackId === `radio:${featured.id}`
                  ? (playing ? "Pause latest show" : "Resume latest show")
                  : "Play latest show"}
            </Button>
            <Button variant="secondary"
              className={`favorite-button ${favoriteShowIds.has(featured.id) ? "is-favorite" : ""}`}
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
            <Button variant="secondary"
              onClick={() => void actOnShow(featured, "queue")}
              disabled={Boolean(busy)}
            >
              {actionFor(featured) === "queue" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ListPlus size={17} />
              )}
              {actionFor(featured) === "queue" ? "Adding…" : "Add to queue"}
            </Button>
            <Button variant="secondary"
              onClick={() => void viewShow(featured)}
              disabled={Boolean(busy)}
            >
              {actionFor(featured) === "detail" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ListMusic size={17} />
              )}
              {actionFor(featured) === "detail" ? "Loading tracklist…" : "View tracklist"}
            </Button>
            <IconButton onClick={() => openItem(radioEpisodeUrl(featured.id))}
              aria-label={`Open ${featured.subtitle} on Bandcamp`}
              title="Open on Bandcamp"
            >
              <ExternalLink size={16} />
            </IconButton>
          </div>
          {actionError ? <p className="radio-action-error">{actionError}</p> : null}
        </div>
      </article>

      <div className="section-heading radio-heading">
        <div>
          <span className="eyebrow">
            {selectedSeries ? "Series archive" : "From the archive"}
          </span>
          <h2>
            {selectedSeries ? `More from ${selectedSeries.title}` : "More shows"}
          </h2>
        </div>
        <span>{countLabel(shows.length, "broadcast")} loaded</span>
      </div>
      <div className="radio-grid">
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
        <div className="radio-pagination" ref={paginationRef}>
          <button
            className="load-more"
            onClick={() => void showsQuery.fetchNextPage()}
            disabled={showsQuery.isFetchingNextPage}
          >
            {showsQuery.isFetchingNextPage ? (
              <LoaderCircle className="spin" size={14} />
            ) : null}
            {showsQuery.isFetchingNextPage
              ? "Loading more shows…"
              : "Load more radio shows"}
          </button>
          <span>More episodes load automatically as you scroll.</span>
        </div>
      ) : null}
      <p className="radio-source-note">
        <Clock3 size={13} />
        Shows stream directly from Bandcamp. Episode audio is not copied or cached by Coda.
      </p>
    </section>
  );
}
