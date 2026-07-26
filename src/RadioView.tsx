import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { type CSSProperties, memo, useCallback, useState } from "react";
import { countLabel } from "./countLabel";
import {
  fetchRadioShow,
  fetchRadioShows,
  formatTime,
  initials,
  openBandcampUrl,
  paletteFor,
} from "./lib";
import { boundRadioChapters, radioAiringAt } from "./radioPlayback";
import type { RadioShow, RadioShowSummary, Track } from "./types";
import { transitionCodaView } from "./viewTransitions";

const INITIAL_SHOW_LIMIT = 24;
const SHOW_PAGE_SIZE = 24;
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
  const palette = paletteFor(`radio:${show.id}`);
  return (
    <div
      className="radio-artwork"
      style={
        {
          "--cover-accent": palette[0],
          "--cover-base": palette[1],
        } as CSSProperties
      }
    >
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
}) {
  return (
    <article className="radio-card">
      <RadioArtwork show={show} />
      <div className="radio-card__body">
        <span className="radio-card__series">Bandcamp Radio</span>
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
          <button
            className={`icon-button favorite-button ${favorite ? "is-favorite" : ""}`}
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
          </button>
          <button
            className="icon-button"
            onClick={() => onDetails(show)}
            disabled={Boolean(busyAction)}
            aria-label={`View tracklist for ${show.subtitle}`}
            title="View tracklist"
          >
            {busyAction === "detail" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ListMusic size={15} />
            )}
          </button>
          <button
            className="icon-button"
            onClick={() => onQueue(show)}
            disabled={Boolean(busyAction)}
            aria-label={`Add ${show.subtitle} to queue`}
            title="Add show to queue"
          >
            {busyAction === "queue" ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <ListPlus size={15} />
            )}
          </button>
          <button
            className="icon-button"
            onClick={() => void openBandcampUrl(`https://bandcamp.com/radio?show=${show.id}`)}
            aria-label={`Open ${show.subtitle} on Bandcamp`}
            title="Open on Bandcamp"
          >
            <ExternalLink size={14} />
          </button>
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
  currentTime,
  playing,
  onTogglePlayback,
  onOpenItem,
  favorite,
  onToggleFavorite,
}: {
  show: RadioShow;
  actionError: string;
  onBack: () => void;
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onPlayAt?: (track: Track, position: number) => void;
  currentTrackId?: string;
  currentTime: number;
  playing: boolean;
  onTogglePlayback: () => void;
  onOpenItem: (url: string) => void;
  favorite: boolean;
  onToggleFavorite: (show: RadioShowSummary) => void;
}) {
  const track = radioTrack(show);
  const chapters = track.radioChapters ?? [];
  const activeShow = currentTrackId === track.id;
  const currentChapter = activeShow
    ? radioAiringAt(chapters, currentTime).current
    : undefined;

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
          <span className="eyebrow"><Radio size={13} /> Bandcamp Radio</span>
          <h1 id="radio-detail-title">{show.subtitle}</h1>
          <div className="radio-feature__meta">
            <span><CalendarDays size={13} /> {showDate(show.publishedAt)}</span>
            <span><Clock3 size={13} /> {formatTime(show.duration)}</span>
            <span><ListMusic size={13} /> {countLabel(chapters.length, "chapter")}</span>
          </div>
          <p>{show.description}</p>
          <div className="radio-feature__actions">
            <button
              className={`primary-button ${activeShow ? "is-current" : ""} ${activeShow && playing ? "is-playing" : ""}`}
              onClick={activeShow ? onTogglePlayback : () => onPlay(track)}
              aria-label={activeShow ? `${playing ? "Pause" : "Resume"} show` : "Play show"}
              aria-pressed={activeShow && playing}
            >
              {activeShow && playing
                ? <Pause size={17} fill="currentColor" />
                : <Play size={17} fill="currentColor" />}
              {activeShow ? (playing ? "Pause show" : "Resume show") : "Play show"}
            </button>
            <button className="secondary-button" onClick={() => onQueue(track)}>
              <ListPlus size={17} />
              Add to queue
            </button>
            <button
              className={`secondary-button favorite-button ${favorite ? "is-favorite" : ""}`}
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
            </button>
            <button
              className="icon-button"
              onClick={() =>
                onOpenItem(`https://bandcamp.com/radio?show=${show.id}`)
              }
              aria-label={`Open ${show.subtitle} on Bandcamp`}
              title="Open on Bandcamp"
            >
              <ExternalLink size={16} />
            </button>
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
              <span className="radio-detail__chapter-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="radio-detail__chapter-copy">
                {chapter.itemUrl ? (
                  <button
                    className="metadata-link radio-detail__chapter-link"
                    onClick={() => onOpenItem(chapter.itemUrl!)}
                    aria-label={`Open ${chapter.title} by ${chapter.artist} on Bandcamp`}
                    title="Open on Bandcamp"
                  >
                    {chapter.title}
                    <ExternalLink size={13} aria-hidden="true" />
                  </button>
                ) : (
                  <strong>{chapter.title}</strong>
                )}
                <span>
                  {chapter.artist}
                  {chapter.album ? ` · ${chapter.album}` : ""}
                </span>
              </div>
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
  currentTime,
  playing,
  onTogglePlayback,
  favoriteShowIds,
  onToggleFavorite,
}: {
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onPlayAt?: (track: Track, position: number) => void;
  currentTrackId?: string;
  currentTime: number;
  playing: boolean;
  onTogglePlayback: () => void;
  favoriteShowIds: ReadonlySet<number>;
  onToggleFavorite: (show: RadioShowSummary) => void;
}) {
  const queryClient = useQueryClient();
  const showsQuery = useQuery({
    queryKey: ["bandcamp-radio"],
    queryFn: fetchRadioShows,
    staleTime: RADIO_STALE_TIME_MS,
  });
  const [showLimit, setShowLimit] = useState(INITIAL_SHOW_LIMIT);
  const [busy, setBusy] = useState<{
    id: number;
    action: "play" | "queue" | "detail";
  }>();
  const [selectedShow, setSelectedShow] = useState<RadioShow>();
  const [actionError, setActionError] = useState("");
  const shows = showsQuery.data ?? [];
  const featured = shows[0];
  const visibleShows = shows.slice(1, showLimit + 1);

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
        const details = await loadShow(show.id);
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
        const details = await loadShow(show.id);
        void transitionCodaView(() => setSelectedShow(details), "page-forward");
      } catch (cause) {
        setActionError(String(cause).replace(/^Error:\s*/, ""));
      } finally {
        setBusy(undefined);
      }
    },
    [busy, loadShow],
  );

  const openItem = useCallback((url: string) => {
    setActionError("");
    void openBandcampUrl(url).catch((cause) => {
      setActionError(String(cause).replace(/^Error:\s*/, ""));
    });
  }, []);

  const actionFor = (show: RadioShowSummary) =>
    busy?.id === show.id ? busy.action : undefined;

  if (showsQuery.isPending) {
    return (
      <section className="radio-view">
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
        <div className="radio-status">
          <Radio size={30} />
          <strong>No shows are broadcasting yet</strong>
          <span>Bandcamp did not return any Radio episodes.</span>
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
            setActionError("");
          }, "page-back");
        }}
        onPlay={onPlay}
        onQueue={onQueue}
        onPlayAt={onPlayAt}
        currentTrackId={currentTrackId}
        currentTime={currentTime}
        playing={playing}
        onTogglePlayback={onTogglePlayback}
        onOpenItem={openItem}
        favorite={favoriteShowIds.has(selectedShow.id)}
        onToggleFavorite={onToggleFavorite}
      />
    );
  }

  return (
    <section className="radio-view" aria-live="polite" aria-busy={Boolean(busy)}>
      <article className="radio-feature">
        <div className="radio-feature__art">
          <RadioArtwork show={featured} eager />
        </div>
        <div className="radio-feature__copy">
          <span className="eyebrow"><Headphones size={13} /> Latest broadcast</span>
          <h1>{featured.subtitle}</h1>
          <div className="radio-feature__meta">
            <span><Radio size={13} /> Bandcamp Radio</span>
            <span><CalendarDays size={13} /> {showDate(featured.publishedAt)}</span>
          </div>
          <p>{featured.description}</p>
          <div className="radio-feature__actions">
            <button
              className={`primary-button ${currentTrackId === `radio:${featured.id}` ? "is-current" : ""} ${currentTrackId === `radio:${featured.id}` && playing ? "is-playing" : ""}`}
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
            </button>
            <button
              className={`secondary-button favorite-button ${favoriteShowIds.has(featured.id) ? "is-favorite" : ""}`}
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
            </button>
            <button
              className="secondary-button"
              onClick={() => void actOnShow(featured, "queue")}
              disabled={Boolean(busy)}
            >
              {actionFor(featured) === "queue" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ListPlus size={17} />
              )}
              {actionFor(featured) === "queue" ? "Adding…" : "Add to queue"}
            </button>
            <button
              className="secondary-button"
              onClick={() => void viewShow(featured)}
              disabled={Boolean(busy)}
            >
              {actionFor(featured) === "detail" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <ListMusic size={17} />
              )}
              {actionFor(featured) === "detail" ? "Loading tracklist…" : "View tracklist"}
            </button>
            <button
              className="icon-button"
              onClick={() => openItem(`https://bandcamp.com/radio?show=${featured.id}`)}
              aria-label={`Open ${featured.subtitle} on Bandcamp`}
              title="Open on Bandcamp"
            >
              <ExternalLink size={16} />
            </button>
          </div>
          {actionError ? <p className="radio-action-error">{actionError}</p> : null}
        </div>
      </article>

      <div className="section-heading radio-heading">
        <div>
          <span className="eyebrow">From the archive</span>
          <h2>More shows</h2>
        </div>
        <span>{countLabel(shows.length, "broadcast")}</span>
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
          />
        ))}
      </div>
      {visibleShows.length < Math.max(0, shows.length - 1) ? (
        <button
          className="load-more"
          onClick={() =>
            setShowLimit((limit) => Math.min(limit + SHOW_PAGE_SIZE, shows.length))
          }
        >
          Load more radio shows
        </button>
      ) : null}
      <p className="radio-source-note">
        <Clock3 size={13} />
        Shows stream directly from Bandcamp. Episode audio is not copied or cached by Coda.
      </p>
    </section>
  );
}
