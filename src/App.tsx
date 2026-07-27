import {
  Airplay,
  AudioLines,
  ArrowDownUp,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Compass,
  Disc3,
  Dices,
  ExternalLink,
  GripVertical,
  Heart,
  Images,
  Library,
  ListMusic,
  ListPlus,
  Music2,
  Pause,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Repeat,
  Repeat1,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  UsersRound,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type RefObject,
  type SyntheticEvent,
  lazy,
  memo,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { genreKey, summarizeGenres } from "./genres";
import {
  clearCoverUrlCache,
  checkpointPlayerState,
  clearPlayerState,
  clearRuntimeCaches,
  beginLastFmAuthorization,
  completeLastFmAuthorization,
  connectBandcamp,
  disconnect,
  disconnectLastFm,
  fetchCoverUrl,
  fetchLibrary,
  fetchRadioShow,
  fetchStreamUrl,
  formatTime,
  getLastFmStatus,
  hasConnection,
  initials,
  invalidateCoverUrl,
  isDesktop,
  openLastFmAuthorization,
  openBandcampUrl,
  loadPlayerState,
  savePlayerState,
  scrobbleLastFm,
  updateLastFmNowPlaying,
} from "./lib";
import {
  artistKey,
  groupAlbumsByArtist,
  matchesBrowseMode,
  type ArtistGroup,
  type LibraryBrowseMode,
} from "./libraryBrowse";
import {
  clearBandcampQueryData,
  ensureAlbumQueryData,
  hydrateLibraryQuery,
  libraryQueryKey,
  libraryStateQueryOptions,
  mergeLibraryProgress,
  refreshAlbumQueryData,
  revalidateAlbumQueryData,
  shouldAutoRevalidateLibrary,
  toLibrarySummaries,
  updateLibraryData,
} from "./libraryQueries";
import {
  readLocalFavorites,
  repairLocalFavoriteMetadata,
  updateLocalFavorites,
  updateLocalRadioFavorite,
  writeLocalFavorites,
} from "./localFavorites";
import { countLabel } from "./countLabel";
import { showAirPlayPicker, supportsAirPlayPicker } from "./media";
import { NowPlayingView } from "./NowPlayingView";
import {
  RadioChapterCopy,
  type RadioChapterLocalLinks,
} from "./RadioChapterMetadata";
import { isEphemeralTrackId } from "./playerState";
import {
  createPlaybackClock,
  type PlaybackClock,
} from "./playbackClock";
import { appendUnique, keepCurrentTrack, moveItem, shuffled } from "./queue";
import {
  recommendQueueAlbum,
  type QueueRecommendation,
} from "./queueRecommendation";
import { pickRandomItem, pickWeightedItem } from "./random";
import {
  boundRadioChapters,
  nextRadioChapterTimeInTimeline,
  previousRadioChapterTimeInTimeline,
  radioAiringIndexesAt,
  radioShowIdFromTrackId,
} from "./radioPlayback";
import { radioSeriesByTitle } from "./radioSeries";
import {
  advanceRadioScrobblingWithTimeline,
  completeRadioShowScrobble,
  createRadioScrobbleProgress,
  markRadioChapterScrobble,
  markRadioShowScrobble,
  radioChapterTimelineFromBounded,
  type RadioScrobbleAction,
} from "./radioScrobbling";
import { resolveRadioChapterLibraryTargets } from "./radioNavigation";
import type {
  Album,
  ConnectionInput,
  LastFmPlaybackProgress,
  LastFmStatus,
  LastFmTrackInput,
  LocalFavoriteCollection,
  RadioScrobbleProgress,
  RadioChapter,
  RadioShowSummary,
  RepeatMode,
  SortMode,
  Track,
} from "./types";
import { transitionCodaView } from "./viewTransitions";

type Toast = { id: number; message: string; tone?: "good" | "bad" };
type LibraryView = "library" | "favorites" | "playlists" | "recent" | "discover" | "radio";
type SyncState = "checking" | "idle" | "syncing" | "error";
type PlaybackSession = {
  trackId: string;
  startedAt: number;
  listenedSeconds: number;
  lastPosition: number;
  nowPlayingSent: boolean;
  scrobbleState: "idle" | "pending" | "sent" | "failed";
};

function usePlaybackPosition(playbackClock: PlaybackClock): number {
  return useSyncExternalStore(
    playbackClock.subscribe,
    playbackClock.getSnapshot,
    playbackClock.getSnapshot,
  );
}

function useCurrentRadioChapter(
  playbackClock: PlaybackClock,
  timeline: readonly RadioChapter[],
): {
  current?: RadioChapter;
  next?: RadioChapter;
} {
  const getCurrentIndex = useCallback(
    () =>
      radioAiringIndexesAt(timeline, playbackClock.getSnapshot()).currentIndex,
    [playbackClock, timeline],
  );
  const currentIndex = useSyncExternalStore(
    playbackClock.subscribe,
    getCurrentIndex,
    getCurrentIndex,
  );
  const current = currentIndex >= 0 ? timeline[currentIndex] : undefined;
  const next = current
    ? timeline[currentIndex + 1]
    : timeline[0];
  return { current, next };
}
const ARTWORK_REFRESH_CONCURRENCY = 4;
const MAX_ARTWORK_DETAILS_PER_REFRESH = 200;
const SEARCH_QUEUE_CONCURRENCY = 6;
const QUEUE_PANEL_EXIT_MS = 240;
const PLAYER_STATE_SAVE_DEBOUNCE_MS = 450;
const PLAYER_STATE_CHECKPOINT_MS = 5_000;
const PREVIOUS_RESTART_THRESHOLD_SECONDS = 4;
const LIBRARY_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
const LIBRARY_BROWSE_OPTIONS: ReadonlyArray<{
  mode: LibraryBrowseMode;
  label: string;
  title: string;
}> = [
  { mode: "releases", label: "All releases", title: "Browse every purchase" },
  { mode: "artists", label: "Artists", title: "Group purchases by artist" },
  { mode: "albums", label: "Albums & EPs", title: "Multi-track purchases" },
  { mode: "singles", label: "Singles", title: "One-track purchases" },
];
const DiscoverView = lazy(() => import("./DiscoverView"));
const RadioView = lazy(() => import("./RadioView"));
const SavedLibraryView = lazy(() => import("./SavedLibraryView"));
const AlbumVirtualGrid = lazy(() => import("./AlbumVirtualGrid"));
const ArtistVirtualGrid = lazy(() => import("./ArtistVirtualGrid"));
const TrackQueueList = lazy(() => import("./TrackQueueList"));
const AddToPlaylistDialog = lazy(() =>
  import("./SavedLibraryView").then((module) => ({ default: module.AddToPlaylistDialog })),
);

function albumWithTracks(album: Album, tracks: Track[]): Album {
  return {
    ...album,
    coverArt: album.coverArt ?? tracks.find((track) => track.coverArt)?.coverArt,
    tracks,
  };
}

function albumWithRecoveredCover(album: Album, tracks: readonly Track[]): Album {
  if (album.coverArt) return album;
  const coverArt = tracks.find((track) => track.coverArt)?.coverArt;
  return coverArt ? { ...album, coverArt } : album;
}

function lastFmTrackInput(track: Track): LastFmTrackInput {
  return {
    artist: track.artist,
    title: track.title,
    album: track.album,
    ...(track.albumArtist ? { albumArtist: track.albumArtist } : {}),
    ...(track.musicBrainzId ? { musicBrainzId: track.musicBrainzId } : {}),
    duration: Math.max(0, Math.floor(track.duration)),
    trackNumber: Math.max(0, Math.floor(track.track)),
    chosenByUser: true,
  };
}

function persistedLastFmProgress(
  track: Track | undefined,
  session: PlaybackSession,
): LastFmPlaybackProgress | undefined {
  if (!track || track.id.startsWith("radio:") || session.trackId !== track.id) {
    return undefined;
  }
  return {
    trackId: session.trackId,
    startedAt: session.startedAt,
    listenedSeconds: session.listenedSeconds,
    lastPosition: session.lastPosition,
    nowPlayingSent: session.nowPlayingSent,
    scrobbleState: session.scrobbleState,
  };
}

function persistedRadioScrobbleProgress(
  track: Track | undefined,
  progress: RadioScrobbleProgress | undefined,
): RadioScrobbleProgress | undefined {
  if (!track?.id.startsWith("radio:") || progress?.showTrackId !== track.id) {
    return undefined;
  }
  return {
    ...progress,
    scrobbledChapterKeys: [...progress.scrobbledChapterKeys],
  };
}

function CoverArt({
  album,
  size = "card",
  fallbackArtworkUrl,
  animateChanges = false,
}: {
  album: Pick<Album, "id" | "title" | "artist" | "coverArt" | "artworkUrl" | "palette">;
  size?: "card" | "small" | "large";
  fallbackArtworkUrl?: string;
  animateChanges?: boolean;
}) {
  const [url, setUrl] = useState<string>();
  const [requestVersion, setRequestVersion] = useState(0);
  const retryCountRef = useRef(0);
  const coverIdRef = useRef(album.coverArt);

  useEffect(() => {
    const refresh = () => {
      retryCountRef.current = 0;
      setRequestVersion((version) => version + 1);
    };
    window.addEventListener("coda:refresh-artwork", refresh);
    return () => window.removeEventListener("coda:refresh-artwork", refresh);
  }, []);

  useEffect(() => {
    let active = true;
    if (coverIdRef.current !== album.coverArt) {
      coverIdRef.current = album.coverArt;
      retryCountRef.current = 0;
    }
    if (album.artworkUrl) {
      setUrl(album.artworkUrl);
      return;
    }
    if (fallbackArtworkUrl) {
      setUrl(fallbackArtworkUrl);
      return;
    }
    if (!album.coverArt || !isDesktop()) {
      setUrl(undefined);
      return;
    }
    fetchCoverUrl(album.coverArt)
      .then((value) => {
        if (active) setUrl(value);
      })
      .catch(() => {
        if (active) setUrl(undefined);
      });
    return () => {
      active = false;
    };
  }, [album.artworkUrl, album.coverArt, fallbackArtworkUrl, requestVersion]);

  const retryImage = () => {
    if (
      fallbackArtworkUrl &&
      url !== fallbackArtworkUrl
    ) {
      setUrl(fallbackArtworkUrl);
      return;
    }
    setUrl(undefined);
    if (!album.coverArt || retryCountRef.current >= 1) return;
    retryCountRef.current += 1;
    invalidateCoverUrl(album.coverArt);
    setRequestVersion((version) => version + 1);
  };

  return (
    <div
      className={`cover cover--${size} ${animateChanges ? "cover--artwork-transition" : ""}`}
      style={
        {
          "--cover-accent": album.palette[0],
          "--cover-base": album.palette[1],
        } as React.CSSProperties
      }
    >
      {url ? (
        <img
          key={url}
          src={url}
          alt={`${album.title} cover`}
          loading={size === "card" ? "lazy" : "eager"}
          decoding="async"
          draggable={false}
          onError={retryImage}
        />
      ) : (
        <>
          <span className="cover__rule" />
          <span className="cover__mark">{initials(album.title)}</span>
          <span className="cover__artist">{album.artist}</span>
        </>
      )}
    </div>
  );
}

const ClockedNowPlayingArtwork = memo(function ClockedNowPlayingArtwork({
  playbackClock,
  track,
  radioTimeline,
}: {
  playbackClock: PlaybackClock;
  track: Track;
  radioTimeline: readonly RadioChapter[];
}) {
  const { current } = useCurrentRadioChapter(
    playbackClock,
    radioTimeline,
  );
  return (
    <CoverArt
      size="large"
      album={{
        id: track.albumId,
        title: current?.title ?? track.album,
        artist: current?.artist ?? track.artist,
        coverArt: track.coverArt,
        artworkUrl: current?.artworkUrl ?? track.artworkUrl,
        palette: track.palette,
      }}
      fallbackArtworkUrl={current?.artworkUrl ? track.artworkUrl : undefined}
      animateChanges={Boolean(track.radioChapters?.length)}
    />
  );
});

const WindowTitleController = memo(function WindowTitleController({
  playbackClock,
  currentTrack,
  radioTimeline,
  nowPlayingOpen,
  selectedAlbumTitle,
  activeArtistName,
  view,
}: {
  playbackClock: PlaybackClock;
  currentTrack?: Track;
  radioTimeline: readonly RadioChapter[];
  nowPlayingOpen: boolean;
  selectedAlbumTitle?: string;
  activeArtistName?: string;
  view: LibraryView;
}) {
  const { current: currentRadioChapter } = useCurrentRadioChapter(
    playbackClock,
    radioTimeline,
  );
  const subject =
    nowPlayingOpen && currentTrack
      ? currentRadioChapter?.title ?? currentTrack.title
      : selectedAlbumTitle ??
        activeArtistName ??
        (view === "discover"
          ? "Discover"
          : view === "radio"
            ? "Bandcamp Radio"
            : currentRadioChapter?.title ?? currentTrack?.title);
  const windowTitle = subject ? `${subject} — Coda` : "Coda";

  useEffect(() => {
    document.title = windowTitle;
    if (!isDesktop()) return;
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(windowTitle))
      .catch(() => {
        // The static native title remains a safe fallback.
      });
  }, [windowTitle]);

  return null;
});

const AlbumCard = memo(function AlbumCard({
  album,
  onOpen,
  onPlay,
  onQueue,
  onArtist,
  active,
  playing,
  onTogglePlayback,
}: {
  album: Album;
  onOpen: (album: Album) => void;
  onPlay: (album: Album) => void;
  onQueue: (album: Album) => void;
  onArtist: (artist: string) => void;
  active: boolean;
  playing: boolean;
  onTogglePlayback: () => void;
}) {
  return (
    <article className="album-card">
      <div className="album-card__cover">
        <CoverArt album={album} />
        <button
          className="album-card__open"
          onClick={() => onOpen(album)}
          aria-label={`Open ${album.title}`}
        />
        <span className="album-card__play">
          <button
            className={`${active ? "is-current" : ""} ${active && playing ? "is-playing" : ""}`}
            onClick={active ? onTogglePlayback : () => onPlay(album)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${album.title}`
                : `Play ${album.title}`
            }
            aria-pressed={active && playing}
            title={active ? (playing ? "Pause album" : "Resume album") : "Play album"}
          >
            {active && playing
              ? <Pause size={19} fill="currentColor" />
              : <Play size={19} fill="currentColor" />}
          </button>
        </span>
      </div>
      <div className="album-card__meta">
        <button className="album-card__name" onClick={() => onOpen(album)}>
          {album.title}
        </button>
        <button
          className="album-card__artist"
          onClick={() => onArtist(album.artist)}
          title={`Browse ${album.artist}`}
        >
          {album.artist}
        </button>
      </div>
      <button
        className="icon-button album-card__more"
        onClick={() => onQueue(album)}
        title="Add album to queue"
        aria-label={`Add ${album.title} to queue`}
      >
        <Plus size={17} />
      </button>
    </article>
  );
});

const ArtistCard = memo(function ArtistCard({
  group,
  onOpen,
}: {
  group: ArtistGroup;
  onOpen: (group: ArtistGroup) => void;
}) {
  return (
    <button
      className="artist-card"
      onClick={() => onOpen(group)}
      aria-label={`Browse ${group.name}`}
    >
      <CoverArt album={group.representative} size="small" />
      <span className="artist-card__copy">
        <strong>{group.name}</strong>
        <span>
          {countLabel(group.releaseCount, "release")}
          {" · "}
          {countLabel(group.trackCount, "track")}
        </span>
      </span>
      <ChevronRight size={17} />
    </button>
  );
});

const ArtistHero = memo(function ArtistHero({
  group,
  loading,
  onBack,
  onPlay,
  onShuffle,
  onQueue,
  active,
  playing,
  onTogglePlayback,
}: {
  group: ArtistGroup;
  loading?: "play" | "shuffle" | "queue";
  onBack: () => void;
  onPlay: (group: ArtistGroup) => void;
  onShuffle: (group: ArtistGroup) => void;
  onQueue: (group: ArtistGroup) => void;
  active: boolean;
  playing: boolean;
  onTogglePlayback: () => void;
}) {
  return (
    <section className="artist-hero">
      <CoverArt album={group.representative} size="large" />
      <div className="artist-hero__body">
        <button className="artist-hero__back" onClick={onBack}>
          <ArrowLeft size={14} />
          All artists
        </button>
        <span className="eyebrow">Artist</span>
        <h2>{group.name}</h2>
        <p>
          {countLabel(group.releaseCount, "release")}
          {" · "}
          {countLabel(group.trackCount, "track")}
          {" · "}
          {formatTime(group.duration)}
        </p>
        <div className="artist-hero__actions">
          <button
            className={`primary-button ${active ? "is-current" : ""} ${active && playing ? "is-playing" : ""}`}
            onClick={active ? onTogglePlayback : () => onPlay(group)}
            disabled={Boolean(loading)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${group.name}`
                : "Play all"
            }
            aria-pressed={active && playing}
          >
            {loading === "play"
              ? <RefreshCw className="spin" size={16} />
              : active && playing
                ? <Pause size={16} fill="currentColor" />
                : <Play size={16} fill="currentColor" />}
            {loading === "play"
              ? "Loading…"
              : active
                ? (playing ? "Pause" : "Resume")
                : "Play all"}
          </button>
          <button
            className="secondary-button"
            onClick={() => onShuffle(group)}
            disabled={Boolean(loading)}
          >
            {loading === "shuffle" ? <RefreshCw className="spin" size={16} /> : <Shuffle size={16} />}
            {loading === "shuffle" ? "Shuffling…" : "Shuffle"}
          </button>
          <button
            className="secondary-button"
            onClick={() => onQueue(group)}
            disabled={Boolean(loading)}
          >
            {loading === "queue" ? <RefreshCw className="spin" size={16} /> : <ListPlus size={16} />}
            {loading === "queue" ? "Adding…" : "Add all"}
          </button>
        </div>
      </div>
    </section>
  );
});

const Sidebar = memo(function Sidebar({
  view,
  onView,
  connected,
  onConnect,
}: {
  view: LibraryView;
  onView: (view: LibraryView) => void;
  connected: boolean;
  onConnect: () => void;
}) {
  return (
    <aside className="sidebar">
      <nav aria-label="Primary navigation">
        <p className="eyebrow">Your music</p>
        <button className={view === "library" ? "active" : ""} onClick={() => onView("library")}>
          <Library size={18} /><span>Collection</span>
        </button>
        <button className={view === "favorites" ? "active" : ""} onClick={() => onView("favorites")}>
          <Heart size={18} /><span>Favorites</span>
        </button>
        <button className={view === "playlists" ? "active" : ""} onClick={() => onView("playlists")}>
          <ListMusic size={18} /><span>Playlists</span>
        </button>
        <button className={view === "recent" ? "active" : ""} onClick={() => onView("recent")}>
          <Clock3 size={18} /><span>Recently added</span>
        </button>
        <button className={view === "discover" ? "active" : ""} onClick={() => onView("discover")}>
          <Compass size={18} /><span>Discover</span>
        </button>
        <p className="eyebrow eyebrow--spaced">Listen</p>
        <button className={view === "radio" ? "active" : ""} onClick={() => onView("radio")}>
          <Radio size={18} /><span>Bandcamp Radio</span>
        </button>
      </nav>

      <div className="sidebar__connection">
        <span className={`status-dot ${connected ? "status-dot--live" : ""}`} />
        <div>
          <strong>{connected ? "Bandcamp synced" : "Not connected"}</strong>
          <span>{connected ? "Official Subsonic beta" : "Connect to hear your music"}</span>
        </div>
        <button className="icon-button" onClick={onConnect} aria-label="Connection settings" title="Connection settings">
          <Settings2 size={17} />
        </button>
      </div>
    </aside>
  );
});

const QueueRadioChapters = memo(function QueueRadioChapters({
  chapters,
  currentChapterIndex,
  nextChapterIndex,
  open,
  onSeek,
}: {
  chapters: readonly RadioChapter[] | undefined;
  currentChapterIndex: number;
  nextChapterIndex: number;
  open: boolean;
  onSeek: (position: number) => void;
}) {
  const currentChapterRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open && currentChapterIndex >= 0) {
      currentChapterRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [chapters, currentChapterIndex, open]);

  if (!chapters?.length) return null;

  return (
    <section className="queue-radio" aria-label="Show chapters">
      <header className="queue-radio__header">
        <span>Show chapters</span>
        <span>{chapters.length}</span>
      </header>
      <ol className="queue-radio__list">
        {chapters.map((chapter, chapterIndex) => {
          const isCurrent = chapterIndex === currentChapterIndex;
          const isNext = chapterIndex === nextChapterIndex;
          return (
            <li
              className={[
                "queue-radio__chapter",
                isCurrent ? "is-current" : "",
                isNext ? "is-next" : "",
              ].filter(Boolean).join(" ")}
              key={`${chapter.timecode}-${chapter.artist}-${chapter.title}-${chapterIndex}`}
            >
              <button
                ref={isCurrent ? currentChapterRef : undefined}
                onClick={() => onSeek(chapter.timecode)}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={`Seek to ${chapter.title} at ${formatTime(chapter.timecode)}`}
              >
                <time>{formatTime(chapter.timecode)}</time>
                <span className="queue-radio__chapter-copy">
                  <strong>{chapter.title}</strong>
                  <small>
                    {chapter.artist}
                    {chapter.album ? ` · ${chapter.album}` : ""}
                  </small>
                </span>
                {isCurrent ? (
                  <span className="queue-radio__state">On air</span>
                ) : isNext ? (
                  <span className="queue-radio__state">Next</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
});

const QueuePanel = memo(function QueuePanel({
  open,
  panelRef,
  queue,
  currentIndex,
  currentTrack,
  radioTimeline,
  playbackClock,
  playing,
  onPlay,
  onRemove,
  onClear,
  onShuffle,
  onMove,
  onArtist,
  onAlbum,
  onNowPlaying,
  onOpenRadioItem,
  getRadioChapterLocalLinks,
  onSeek,
  recommendation,
  recommendationLoading,
  onPlayRecommendation,
  onAnotherRecommendation,
}: {
  open: boolean;
  panelRef: RefObject<HTMLElement | null>;
  queue: Track[];
  currentIndex: number;
  currentTrack?: Track;
  radioTimeline: readonly RadioChapter[];
  playbackClock: PlaybackClock;
  playing: boolean;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onShuffle: () => void;
  onMove: (from: number, to: number) => void;
  onArtist: (artist: string) => void;
  onAlbum: (track: Track) => void;
  onNowPlaying: () => void;
  onOpenRadioItem: (url: string) => void;
  getRadioChapterLocalLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
  onSeek: (position: number) => void;
  recommendation?: QueueRecommendation;
  recommendationLoading: boolean;
  onPlayRecommendation: () => void;
  onAnotherRecommendation: () => void;
}) {
  const upcoming = queue.slice(currentIndex + 1);
  const remaining = upcoming.reduce((total, item) => total + item.duration, 0);
  const {
    current: currentRadioChapter,
    next: nextRadioChapter,
  } = useCurrentRadioChapter(
    playbackClock,
    radioTimeline,
  );
  const currentChapterIndex = currentRadioChapter
    ? radioTimeline.indexOf(currentRadioChapter)
    : -1;
  const nextChapterIndex = nextRadioChapter
    ? radioTimeline.indexOf(nextRadioChapter)
    : -1;
  const emptyQueue = (
    <div className="queue-empty">
      <Music2 size={25} />
      <strong>{currentTrack ? "End of the queue" : "Your queue is empty"}</strong>
      <span>
        {recommendation
          ? "Not sure what comes next? Let Coda pick from your collection."
          : currentTrack
            ? "Add another album or track to keep listening."
            : "Use the + button on any release to line up music."}
      </span>
      {recommendation ? (
        <div className="queue-recommendation">
          <CoverArt size="small" album={recommendation.album} />
          <div className="queue-recommendation__copy">
            <span>Try this next</span>
            <strong>{recommendation.album.title}</strong>
            <small>
              {recommendation.album.artist} · {recommendation.reason}
            </small>
          </div>
          <div className="queue-recommendation__actions">
            <button
              type="button"
              className="queue-recommendation__play"
              onClick={onPlayRecommendation}
              disabled={recommendationLoading}
              aria-label={`Play something from ${recommendation.album.title}`}
            >
              {recommendationLoading ? (
                <RefreshCw className="spin" size={14} />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
              {recommendationLoading ? "Picking…" : "Play something"}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={onAnotherRecommendation}
              disabled={recommendationLoading}
              aria-label="Suggest another album"
              title="Suggest another"
            >
              <Dices size={15} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <aside
      ref={panelRef}
      className={`queue-panel ${open ? "queue-panel--open" : "queue-panel--closing"}`}
      aria-label="Playback queue"
      aria-hidden={!open}
      inert={!open}
      tabIndex={open ? -1 : undefined}
    >
      <div className="queue-panel__header">
        <div>
          <span className="eyebrow">Playing next</span>
          <h2>Queue</h2>
        </div>
        <div>
          <button className="icon-button" onClick={onShuffle} disabled={queue.length < 2} title="Shuffle queue" aria-label="Shuffle queue">
            <Shuffle size={17} />
          </button>
          <button
            className="text-button"
            onClick={onClear}
            disabled={queue.length <= currentIndex + 1}
            title="Clear upcoming tracks"
          >
            Clear next
          </button>
        </div>
      </div>

      {currentTrack ? (
        <div
          className={`queue-now ${playing ? "queue-now--playing" : "queue-now--paused"}`}
          key={currentTrack.id}
        >
          <span className="queue-now__label"><span />Now playing</span>
          <div className="queue-now__main">
            <button
              className="queue-track__art"
              onClick={onNowPlaying}
              aria-label={`Open Now Playing for ${currentRadioChapter?.title ?? currentTrack.title}`}
              title="Open Now Playing"
            >
            <CoverArt
              size="small"
              album={{
                id: currentTrack.albumId,
                title: currentTrack.album,
                artist: currentTrack.artist,
                coverArt: currentTrack.coverArt,
                artworkUrl: currentTrack.artworkUrl,
                palette: currentTrack.palette,
              }}
            />
            </button>
            <div className="queue-track__meta">
              {currentRadioChapter ? (
                <>
                  <RadioChapterCopy
                    chapter={currentRadioChapter}
                    className="queue-now__radio-copy"
                    onOpen={onOpenRadioItem}
                    localLinks={getRadioChapterLocalLinks(currentRadioChapter)}
                  />
                  {nextRadioChapter ? (
                    <span className="queue-now__chapter-next">
                      Next: {nextRadioChapter.title}
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    className="queue-track__title"
                    onClick={onNowPlaying}
                  >
                    {currentTrack.title}
                  </button>
                  <button
                    className="metadata-link"
                    onClick={() => onArtist(currentTrack.artist)}
                  >
                    {currentTrack.artist}
                  </button>
                </>
              )}
            </div>
            <span className="queue-bars"><i /><i /><i /></span>
          </div>
          <QueueRadioChapters
            chapters={radioTimeline}
            currentChapterIndex={currentChapterIndex}
            nextChapterIndex={nextChapterIndex}
            open={open}
            onSeek={onSeek}
          />
        </div>
      ) : null}

      <Suspense
        fallback={(
          <div
            aria-label="Upcoming tracks"
            className="queue-list"
            role="region"
            tabIndex={0}
          >
            {!upcoming.length ? emptyQueue : null}
          </div>
        )}
      >
      <TrackQueueList
        aria-label="Upcoming tracks"
        className="queue-list"
        empty={emptyQueue}
        getItemKey={(track, absoluteIndex) => `${track.id}-${absoluteIndex}`}
        items={upcoming}
        onMove={onMove}
        renderItem={(track, { absoluteIndex, index: upcomingIndex }) => (
          <div
            className={`queue-track ${upcomingIndex < 12 ? "queue-track--animated" : ""}`}
            style={
              upcomingIndex < 12
                ? { "--queue-delay": `${upcomingIndex * 18}ms` } as React.CSSProperties
                : undefined
            }
          >
            <GripVertical className="queue-track__grip" size={15} />
            <div className="queue-track__main">
              <button
                className="queue-track__art"
                onClick={() => onAlbum(track)}
                aria-label={`Open ${track.album}`}
                title={`Open ${track.album}`}
              >
                <CoverArt
                  size="small"
                  album={{
                    id: track.albumId,
                    title: track.album,
                    artist: track.artist,
                    coverArt: track.coverArt,
                    artworkUrl: track.artworkUrl,
                    palette: track.palette,
                  }}
                />
              </button>
              <span className="queue-track__meta">
                <button
                  className="queue-track__title"
                  onClick={() => onPlay(absoluteIndex)}
                >
                  {track.title}
                </button>
                <button
                  className="metadata-link"
                  onClick={() => onArtist(track.artist)}
                >
                  {track.artist}
                </button>
              </span>
            </div>
            <span className="queue-track__duration">{formatTime(track.duration)}</span>
            <button className="icon-button queue-track__remove" onClick={() => onRemove(absoluteIndex)} aria-label={`Remove ${track.title}`} title="Remove">
              <X size={14} />
            </button>
          </div>
        )}
        startIndex={currentIndex + 1}
        tabIndex={0}
      />
      </Suspense>

      <div className="queue-panel__footer">
        <span className="queue-panel__count" key={upcoming.length}>
          {countLabel(upcoming.length, "track")} next
        </span>
        <span>{upcoming.length ? `${formatTime(remaining)} remaining` : "Queue ready"}</span>
      </div>
    </aside>
  );
});

const PlayerTrack = memo(function PlayerTrack({
  track,
  radioTimeline,
  playbackClock,
  favorite,
  onToggleFavorite,
  onArtist,
  onAlbum,
  onNowPlaying,
  onOpenRadioItem,
  getRadioChapterLocalLinks,
}: {
  track?: Track;
  radioTimeline: readonly RadioChapter[];
  playbackClock: PlaybackClock;
  favorite: boolean;
  onToggleFavorite: () => void;
  onArtist: (artist: string) => void;
  onAlbum: (track: Track) => void;
  onNowPlaying: () => void;
  onOpenRadioItem: (url: string) => void;
  getRadioChapterLocalLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
}) {
  const radioAiring = useCurrentRadioChapter(
    playbackClock,
    radioTimeline,
  );
  const activeChapter = radioAiring.current;
  const favoriteControl = track ? (
    <button
      className={`icon-button favorite-button player__track-favorite ${favorite ? "is-favorite" : ""}`}
      onClick={onToggleFavorite}
      title={favorite ? "Remove from favorites" : "Add to favorites"}
      aria-label={
        favorite
          ? `Remove ${track.title} from favorites`
          : `Add ${track.title} to favorites`
      }
      aria-pressed={favorite}
    >
      <Heart size={17} fill={favorite ? "currentColor" : "none"} />
    </button>
  ) : null;

  return (
    <div className="player__track">
      {track ? (
        <>
          <button
            className="player__art-link"
            onClick={onNowPlaying}
            aria-label="Open Now Playing"
            title={`Open Now Playing for ${track.title}`}
          >
            <CoverArt
              size="small"
              album={{
                id: track.albumId,
                title: activeChapter?.title ?? track.album,
                artist: activeChapter?.artist ?? track.artist,
                coverArt: track.coverArt,
                artworkUrl: activeChapter?.artworkUrl ?? track.artworkUrl,
                palette: track.palette,
              }}
              fallbackArtworkUrl={
                activeChapter?.artworkUrl ? track.artworkUrl : undefined
              }
              animateChanges={Boolean(track.radioChapters?.length)}
            />
          </button>
          {activeChapter ? (
            <div className="player__track-details">
              <div className="player__track-copy">
                <div className="player__radio-live" aria-live="polite">
                  <RadioChapterCopy
                    chapter={activeChapter}
                    className="player__radio-chapter-copy"
                    onOpen={onOpenRadioItem}
                    localLinks={getRadioChapterLocalLinks(activeChapter)}
                  />
                </div>
              </div>
              {favoriteControl}
            </div>
          ) : (
            <div className="player__track-copy">
              <div className="player__track-title-row">
                <strong title={track.title}>{track.title}</strong>
                {favoriteControl}
              </div>
              <span>
                <button
                  className="metadata-link"
                  onClick={() => onArtist(track.artist)}
                >
                  {track.artist}
                </button>
                {" · "}
                <button
                  className="metadata-link"
                  onClick={() => onAlbum(track)}
                >
                  {track.album}
                </button>
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="player__placeholder">
          <Disc3 size={20} />
          <span>Nothing playing</span>
        </div>
      )}
    </div>
  );
});

const PlayerTransport = memo(function PlayerTransport({
  track,
  radioTimeline,
  playbackClock,
  playing,
  duration,
  repeat,
  canPrevious,
  canNext,
  onToggle,
  onPrevious,
  onNext,
  onSeek,
  onRepeat,
}: {
  track?: Track;
  radioTimeline: readonly RadioChapter[];
  playbackClock: PlaybackClock;
  playing: boolean;
  duration: number;
  repeat: RepeatMode;
  canPrevious: boolean;
  canNext: boolean;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onRepeat: () => void;
}) {
  const currentTime = usePlaybackPosition(playbackClock);
  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  const positionCanPrevious = Boolean(track) && (
    currentTime > PREVIOUS_RESTART_THRESHOLD_SECONDS ||
    previousRadioChapterTimeInTimeline(radioTimeline, currentTime) !== undefined
  );
  const positionCanNext = Boolean(track) &&
    nextRadioChapterTimeInTimeline(radioTimeline, currentTime) !== undefined;

  return (
    <div className="player__transport">
      <div className="transport-buttons">
        <button className="icon-button" onClick={onPrevious} disabled={!canPrevious && !positionCanPrevious} title="Previous" aria-label="Previous"><SkipBack size={18} fill="currentColor" /></button>
        <button className="play-button" onClick={onToggle} disabled={!track} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button className="icon-button" onClick={onNext} disabled={!canNext && !positionCanNext} title="Next" aria-label="Next"><SkipForward size={18} fill="currentColor" /></button>
        <button className={`icon-button ${repeat !== "off" ? "is-active" : ""}`} onClick={onRepeat} disabled={!track} title="Repeat" aria-label={`Repeat ${repeat}`}>
          {repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
        </button>
      </div>
      <div className="progress-row">
        <span>{formatTime(currentTime)}</span>
        <label className="range" style={{ "--range-value": `${progress}%` } as React.CSSProperties}>
          <span className="sr-only">Track position</span>
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="1"
            value={Math.min(currentTime, duration || 1)}
            disabled={!track}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
        </label>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
});

function Player({
  track,
  radioTimeline,
  playing,
  playbackClock,
  duration,
  volume,
  repeat,
  onToggle,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  onSeek,
  onVolume,
  onRepeat,
  airPlayAvailable,
  onAirPlay,
  onArtist,
  onAlbum,
  onNowPlaying,
  onOpenRadioItem,
  getRadioChapterLocalLinks,
  favorite,
  onToggleFavorite,
  onAddToPlaylist,
  queueOpen,
  onToggleQueue,
}: {
  track?: Track;
  radioTimeline: readonly RadioChapter[];
  playing: boolean;
  playbackClock: PlaybackClock;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onRepeat: () => void;
  airPlayAvailable: boolean;
  onAirPlay: () => void;
  onArtist: (artist: string) => void;
  onAlbum: (track: Track) => void;
  onNowPlaying: () => void;
  onOpenRadioItem: (url: string) => void;
  getRadioChapterLocalLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
  favorite: boolean;
  onToggleFavorite: () => void;
  onAddToPlaylist: () => void;
  queueOpen: boolean;
  onToggleQueue: () => void;
}) {
  return (
    <footer className="player">
      <PlayerTrack
        track={track}
        radioTimeline={radioTimeline}
        playbackClock={playbackClock}
        favorite={favorite}
        onToggleFavorite={onToggleFavorite}
        onArtist={onArtist}
        onAlbum={onAlbum}
        onNowPlaying={onNowPlaying}
        onOpenRadioItem={onOpenRadioItem}
        getRadioChapterLocalLinks={getRadioChapterLocalLinks}
      />
      <PlayerTransport
        track={track}
        radioTimeline={radioTimeline}
        playbackClock={playbackClock}
        playing={playing}
        duration={duration}
        repeat={repeat}
        canPrevious={canPrevious}
        canNext={canNext}
        onToggle={onToggle}
        onPrevious={onPrevious}
        onNext={onNext}
        onSeek={onSeek}
        onRepeat={onRepeat}
      />
      <div className="player__volume">
        <button className="icon-button" onClick={() => onVolume(volume ? 0 : 0.72)} aria-label={volume ? "Mute" : "Unmute"}>
          {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <label className="range range--volume" style={{ "--range-value": `${volume * 100}%` } as React.CSSProperties}>
          <span className="sr-only">Volume</span>
          <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => onVolume(Number(event.target.value))} />
        </label>
        {airPlayAvailable ? (
          <button
            className="icon-button"
            onClick={onAirPlay}
            disabled={!track}
            title="Choose AirPlay device"
            aria-label="Choose AirPlay device"
          >
            <Airplay size={18} />
          </button>
        ) : null}
        {track && !track.id.startsWith("radio:") ? (
          <button
            className="icon-button"
            onClick={onAddToPlaylist}
            title="Add to playlist"
            aria-label={`Add ${track.title} to playlist`}
          >
            <ListPlus size={17} />
          </button>
        ) : null}
        <button
          className={`icon-button ${queueOpen ? "is-active" : ""}`}
          onClick={onToggleQueue}
          title={queueOpen ? "Hide queue" : "Show queue"}
          aria-label={queueOpen ? "Hide queue" : "Show queue"}
          aria-pressed={queueOpen}
        >
          <ListMusic size={18} />
        </button>
      </div>
    </footer>
  );
}

function AlbumDetailPage({
  album,
  loading,
  onBack,
  onPlayAlbum,
  onQueueAlbum,
  onPlayTrack,
  onQueueTrack,
  onArtist,
  favoriteAlbum,
  favoriteTrackIds,
  onToggleFavoriteAlbum,
  onToggleFavoriteTrack,
  onAddToPlaylist,
  currentTrackId,
  currentAlbumId,
  playing,
  onTogglePlayback,
}: {
  album: Album;
  loading: boolean;
  onBack: () => void;
  onPlayAlbum: () => void;
  onQueueAlbum: () => void;
  onPlayTrack: (track: Track) => void;
  onQueueTrack: (track: Track) => void;
  onArtist: (artist: string) => void;
  favoriteAlbum: boolean;
  favoriteTrackIds: ReadonlySet<string>;
  onToggleFavoriteAlbum: () => void;
  onToggleFavoriteTrack: (track: Track) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  currentTrackId?: string;
  currentAlbumId?: string;
  playing: boolean;
  onTogglePlayback: () => void;
}) {
  const activeAlbum = currentAlbumId === album.id;
  return (
    <article className="album-detail" aria-label={`${album.title} release details`}>
      <button className="album-detail__back" onClick={onBack}>
        <ArrowLeft size={15} />
        Back to releases
      </button>
      <header className="album-detail__hero">
        <div className="album-detail__art">
          <CoverArt album={album} size="large" />
        </div>
        <div className="album-detail__copy">
            <span className="eyebrow">{album.songCount === 1 ? "Single" : "Album"}</span>
            <h2>{album.title}</h2>
            <button
              className="album-detail__artist metadata-link"
              onClick={() => onArtist(album.artist)}
            >
              {album.artist}
            </button>
            <span className="album-detail__facts">
              {album.year ?? "Year unknown"} · {countLabel(album.songCount, "track")} · {formatTime(album.duration)}
            </span>
            <div className="album-detail__actions">
              <button
                className={`primary-button ${activeAlbum ? "is-current" : ""} ${activeAlbum && playing ? "is-playing" : ""}`}
                onClick={activeAlbum ? onTogglePlayback : onPlayAlbum}
                disabled={loading}
                aria-label={
                  activeAlbum
                    ? `${playing ? "Pause" : "Resume"} ${album.title}`
                    : `Play ${album.songCount === 1 ? "single" : "album"}`
                }
                aria-pressed={activeAlbum && playing}
              >
                {activeAlbum && playing
                  ? <Pause size={17} fill="currentColor" />
                  : <Play size={17} fill="currentColor" />}
                {activeAlbum
                  ? (playing ? "Pause" : "Resume")
                  : `Play ${album.songCount === 1 ? "single" : "album"}`}
              </button>
              <button className="secondary-button" onClick={onQueueAlbum} disabled={loading}>
                <Plus size={17} /> Add to queue
              </button>
              <button
                className="secondary-button"
                onClick={() => onAddToPlaylist(album.tracks ?? [])}
                disabled={loading || !album.tracks?.length}
              >
                <ListPlus size={17} /> Add to playlist
              </button>
              <button
                className={`secondary-button favorite-button ${favoriteAlbum ? "is-favorite" : ""}`}
                onClick={onToggleFavoriteAlbum}
                aria-pressed={favoriteAlbum}
              >
                <Heart size={17} fill={favoriteAlbum ? "currentColor" : "none"} />
                {favoriteAlbum ? "Favorited" : "Favorite"}
              </button>
            </div>
        </div>
        </header>
        <section className="album-detail__tracks" aria-label="Track list">
          <div className="album-detail__tracks-heading">
            <div>
              <span className="eyebrow">Track list</span>
              <h3>{countLabel(album.songCount, "song")}</h3>
            </div>
            <span>{formatTime(album.duration)}</span>
          </div>
          <div className="tracklist">
          <div className="tracklist__head">
            <span className="tracklist__number-heading">#</span>
            <span>Title</span>
            <span className="tracklist__duration-heading" title="Duration">
              <Clock3 size={14} aria-hidden="true" />
              <span className="sr-only">Duration</span>
            </span>
            <span className="tracklist__actions-heading">Actions</span>
          </div>
          {loading ? (
            <div className="tracklist__loading"><RefreshCw size={20} className="spin" /> Loading tracks…</div>
          ) : !album.tracks?.length ? (
            <div className="tracklist__empty">
              <Music2 size={22} />
              <strong>No playable tracks returned</strong>
              <span>This release may not be streamable through Bandcamp’s Subsonic beta yet.</span>
            </div>
          ) : (
            album.tracks.map((track) => {
              const activeTrack = currentTrackId === track.id;
              return (
              <div className={`track-row ${activeTrack ? "is-current" : ""}`} key={track.id}>
                <button
                  className={`track-row__number ${activeTrack && playing ? "is-playing" : ""}`}
                  onClick={activeTrack ? onTogglePlayback : () => onPlayTrack(track)}
                  aria-label={
                    activeTrack
                      ? `${playing ? "Pause" : "Resume"} ${track.title}`
                      : `Play ${track.title}`
                  }
                  aria-pressed={activeTrack && playing}
                >
                  <span>{track.track}</span>
                  {activeTrack && playing
                    ? <Pause size={13} fill="currentColor" />
                    : <Play size={13} fill="currentColor" />}
                </button>
                <div className="track-row__copy">
                  <button
                    className="track-row__title"
                    onClick={activeTrack ? onTogglePlayback : () => onPlayTrack(track)}
                  >
                    <strong>{track.title}</strong>
                  </button>
                  <button
                    className="track-row__artist metadata-link"
                    onClick={() => onArtist(track.artist)}
                  >
                    {track.artist}
                  </button>
                </div>
                <span className="track-row__duration">{formatTime(track.duration)}</span>
                <div className="track-row__actions">
                  <button className="icon-button" onClick={() => onQueueTrack(track)} title="Add to queue" aria-label={`Add ${track.title} to queue`}>
                    <Plus size={16} />
                  </button>
                  <button className="icon-button" onClick={() => onAddToPlaylist([track])} title="Add to playlist" aria-label={`Add ${track.title} to playlist`}>
                    <ListPlus size={16} />
                  </button>
                  <button
                    className={`icon-button favorite-button ${favoriteTrackIds.has(track.id) ? "is-favorite" : ""}`}
                    onClick={() => onToggleFavoriteTrack(track)}
                    title={favoriteTrackIds.has(track.id) ? "Remove from favorites" : "Add to favorites"}
                    aria-label={favoriteTrackIds.has(track.id) ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}
                    aria-pressed={favoriteTrackIds.has(track.id)}
                  >
                    <Heart size={16} fill={favoriteTrackIds.has(track.id) ? "currentColor" : "none"} />
                  </button>
                </div>
              </div>
              );
            })
          )}
          </div>
        </section>
    </article>
  );
}

function ConnectionDialog({
  connected,
  lastFmStatus,
  onClose,
  onConnected,
  onDisconnected,
  onLastFmStatus,
}: {
  connected: boolean;
  lastFmStatus: LastFmStatus;
  onClose: () => void;
  onConnected: (albums: Album[]) => void;
  onDisconnected: () => Promise<void>;
  onLastFmStatus: (status: LastFmStatus) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "error">("idle");
  const [connectLoaded, setConnectLoaded] = useState(0);
  const [error, setError] = useState("");
  const [settingsOpening, setSettingsOpening] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [lastFmToken, setLastFmToken] = useState("");
  const [lastFmAction, setLastFmAction] = useState<"idle" | "starting" | "finishing" | "disconnecting">("idle");
  const [lastFmError, setLastFmError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "connecting") return;
    const input: ConnectionInput = { username: username.trim(), password };
    if (!input.username || !input.password) return;
    setError("");
    setConnectLoaded(0);
    try {
      setState("connecting");
      const library = await connectBandcamp(input, ({ loaded }) => {
        setConnectLoaded(loaded);
      });
      setPassword("");
      onConnected(library);
      onClose();
    } catch (cause) {
      setState("error");
      setPassword("");
      setError(String(cause).replace(/^Error:\s*/, ""));
    }
  };

  const openSettings = async () => {
    if (settingsOpening) return;
    const settingsUrl = "https://bandcamp.com/settings?pane=fan";
    setError("");
    setSettingsOpening(true);
    try {
      if (isDesktop()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(settingsUrl);
      } else {
        window.open(settingsUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      setError("Could not open your browser. Visit bandcamp.com/settings and choose Fan.");
    } finally {
      setSettingsOpening(false);
    }
  };

  const removeBandcamp = async () => {
    if (disconnecting) return;
    setError("");
    setDisconnecting(true);
    try {
      await onDisconnected();
    } catch (cause) {
      setError(String(cause).replace(/^Error:\s*/, ""));
      setDisconnecting(false);
    }
  };

  const beginLastFm = async () => {
    setLastFmError("");
    setLastFmAction("starting");
    try {
      const authorization = await beginLastFmAuthorization();
      await openLastFmAuthorization(authorization.authorizationUrl);
      setLastFmToken(authorization.token);
    } catch (cause) {
      setLastFmError(String(cause).replace(/^Error:\s*/, ""));
    } finally {
      setLastFmAction("idle");
    }
  };

  const finishLastFm = async () => {
    if (!lastFmToken) return;
    setLastFmError("");
    setLastFmAction("finishing");
    try {
      const status = await completeLastFmAuthorization(lastFmToken);
      setLastFmToken("");
      onLastFmStatus(status);
    } catch (cause) {
      setLastFmError(String(cause).replace(/^Error:\s*/, ""));
    } finally {
      setLastFmAction("idle");
    }
  };

  const removeLastFm = async () => {
    setLastFmError("");
    setLastFmAction("disconnecting");
    try {
      onLastFmStatus(await disconnectLastFm());
      setLastFmToken("");
    } catch (cause) {
      setLastFmError(String(cause).replace(/^Error:\s*/, ""));
    } finally {
      setLastFmAction("idle");
    }
  };
  const dialogBusy =
    state === "connecting" ||
    settingsOpening ||
    disconnecting ||
    lastFmAction !== "idle";

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !dialogBusy) onClose();
    }}>
      <section
        className="connection-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
        aria-busy={dialogBusy}
      >
        <button
          className="icon-button dialog-close"
          onClick={onClose}
          aria-label="Close"
          disabled={dialogBusy}
        >
          <X size={19} />
        </button>
        <div className="connection-dialog__icon"><Radio size={24} /></div>
        <span className="eyebrow">Secure connection</span>
        <h2 id="connection-title">{connected ? "Bandcamp is connected" : "Bring in your collection"}</h2>
        <p>
          Coda uses Bandcamp’s official Subsonic beta. Generate separate app credentials in
          Fan Settings, then enter them here.
        </p>
        <div className="connection-dialog__security">
          <span><Check size={15} /> Stored in your system credential vault</span>
          <span><Check size={15} /> Requests limited to bandcamp.com</span>
          <span><Check size={15} /> No analytics or third-party servers</span>
        </div>
        <button
          className="settings-link"
          onClick={() => void openSettings()}
          disabled={settingsOpening || state === "connecting" || disconnecting}
        >
          {settingsOpening
            ? <RefreshCw className="spin" size={16} />
            : <ExternalLink size={16} />}
          {settingsOpening ? "Opening Bandcamp…" : "Sign in and generate credentials"}
        </button>
        <ol className="connection-dialog__steps">
          <li>Sign in to your Bandcamp fan account in the browser.</li>
          <li>Scroll to Subsonic and choose Generate credentials.</li>
          <li>Return here and enter the generated username and password.</li>
        </ol>
        {!connected ? <form onSubmit={submit}>
          <label>
            Subsonic username
            <input name="subsonic-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Generated username" disabled={state === "connecting"} />
          </label>
          <label>
            Subsonic password
            <input name="subsonic-password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Generated password" disabled={state === "connecting"} />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button primary-button--wide" type="submit" disabled={!username.trim() || !password || state === "connecting"}>
            {state === "connecting" ? <RefreshCw className="spin" size={17} /> : <Radio size={17} />}
            {state === "connecting"
              ? connectLoaded
                ? `Loading ${countLabel(connectLoaded, "release")}…`
                : "Connecting securely…"
              : "Connect Bandcamp"}
          </button>
        </form> : null}
        {connected ? (
          <>
            {error ? <div className="form-error">{error}</div> : null}
            <button
              type="button"
              className="danger-button"
              onClick={() => void removeBandcamp()}
              disabled={disconnecting}
            >
              {disconnecting ? <RefreshCw className="spin" size={15} /> : null}
              {disconnecting
                ? "Disconnecting Bandcamp…"
                : "Disconnect and remove Bandcamp credentials"}
            </button>
          </>
        ) : null}
        <div className="connection-dialog__divider" />
        <section className="lastfm-settings" aria-labelledby="lastfm-settings-title">
          <div className="lastfm-settings__heading">
            <AudioLines size={17} />
            <div>
              <h3 id="lastfm-settings-title">Last.fm scrobbling</h3>
              <p>
                Send Now Playing updates and scrobble after half the track or four minutes,
                whichever comes first.
              </p>
            </div>
            <span className={`service-status ${lastFmStatus.connected ? "service-status--live" : ""}`}>
              {lastFmStatus.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          {lastFmStatus.connected ? (
            <div className="lastfm-settings__connected">
              <span>Scrobbling as <strong>{lastFmStatus.username}</strong></span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void removeLastFm()}
                disabled={lastFmAction !== "idle"}
              >
                {lastFmAction === "disconnecting" ? <RefreshCw className="spin" size={15} /> : null}
                {lastFmAction === "disconnecting" ? "Disconnecting…" : "Disconnect"}
              </button>
            </div>
          ) : lastFmStatus.configured ? (
            <div className="lastfm-settings__actions">
              {lastFmToken ? (
                <>
                  <p>Approve Coda in the browser, then return here to finish.</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void finishLastFm()}
                    disabled={lastFmAction !== "idle"}
                  >
                    {lastFmAction === "finishing" ? <RefreshCw className="spin" size={15} /> : <Check size={15} />}
                    {lastFmAction === "finishing" ? "Finishing…" : "Finish connection"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void beginLastFm()}
                  disabled={lastFmAction !== "idle"}
                >
                  {lastFmAction === "starting" ? <RefreshCw className="spin" size={15} /> : <ExternalLink size={15} />}
                  {lastFmAction === "starting" ? "Opening Last.fm…" : "Connect Last.fm"}
                </button>
              )}
            </div>
          ) : (
            <p className="lastfm-settings__unavailable">
              Last.fm credentials have not been added to this Coda build yet.
            </p>
          )}
          {lastFmError ? <div className="form-error">{lastFmError}</div> : null}
          <small>The Last.fm session key is stored in your system credential vault. Coda never sees your Last.fm password.</small>
        </section>
        <small>Bandcamp’s Subsonic service is currently in beta. Coda is an independent client and is not affiliated with Bandcamp or Last.fm.</small>
      </section>
    </div>
  );
}

function LibrarySkeleton() {
  return (
    <div className="album-grid album-grid--loading" aria-label="Loading your collection">
      {Array.from({ length: 10 }, (_, index) => (
        <div className="album-skeleton" key={index}>
          <span className="album-skeleton__cover" />
          <span className="album-skeleton__line" />
          <span className="album-skeleton__line album-skeleton__line--short" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="library-empty">
      <span className="library-empty__icon">{icon}</span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const { data: albums } = useQuery(libraryStateQueryOptions);
  const setAlbums = useCallback(
    (update: React.SetStateAction<Album[]>) =>
      updateLibraryData(queryClient, update),
    [queryClient],
  );
  const [localFavorites, setLocalFavorites] = useState<LocalFavoriteCollection>(
    () => readLocalFavorites(),
  );
  const [connected, setConnected] = useState(false);
  const [lastFmStatus, setLastFmStatus] = useState<LastFmStatus>({
    configured: false,
    connected: false,
  });
  const [syncState, setSyncState] = useState<SyncState>("checking");
  const [libraryError, setLibraryError] = useState("");
  const [view, setView] = useState<LibraryView>("library");
  const [radioSeriesId, setRadioSeriesId] = useState<number>();
  const [radioRequestedShowId, setRadioRequestedShowId] = useState<number>();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [genre, setGenre] = useState("All");
  const [browseMode, setBrowseMode] = useState<LibraryBrowseMode>("releases");
  const [selectedArtist, setSelectedArtist] = useState<string>();
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playbackClock] = useState(createPlaybackClock);
  const [volume, setVolume] = useState(0.72);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [queueOpen, setQueueOpen] = useState(false);
  const [queuePresent, setQueuePresent] = useState(false);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [playerStateReady, setPlayerStateReady] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album>();
  const [albumLoading, setAlbumLoading] = useState(false);
  const [artworkRefreshing, setArtworkRefreshing] = useState(false);
  const [artistAction, setArtistAction] = useState<"play" | "shuffle" | "queue">();
  const [queueSearchProgress, setQueueSearchProgress] = useState<{ done: number; total: number }>();
  const [libraryShuffleProgress, setLibraryShuffleProgress] = useState<{ done: number; total: number }>();
  const [randomPickLoading, setRandomPickLoading] = useState(false);
  const [queueRecommendationNonce, setQueueRecommendationNonce] = useState(0);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [playlistTarget, setPlaylistTarget] = useState<Track[]>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [streamUrl, setStreamUrl] = useState<string>();
  const [airPlayAvailable, setAirPlayAvailable] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const queuePanelRef = useRef<HTMLElement>(null);
  const queueFocusRequestedRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const libraryPaneRef = useRef<HTMLElement>(null);
  const libraryShuffleActiveRef = useRef(false);
  const randomPickActiveRef = useRef(false);
  const restoreGenerationRef = useRef(0);
  const librarySyncGenerationRef = useRef(0);
  const bandcampSessionGenerationRef = useRef(0);
  const restoredPlaybackSessionRef = useRef<PlaybackSession | undefined>(undefined);
  const lastPlayedTrackRef = useRef<Track | undefined>(undefined);
  const restoredRadioScrobbleProgressRef = useRef<RadioScrobbleProgress | undefined>(
    undefined,
  );
  const pendingRestorePositionRef = useRef<{ trackId: string; position: number } | undefined>(
    undefined,
  );

  useEffect(() => {
    if (queueOpen) {
      setQueuePresent(true);
      return;
    }
    const timer = window.setTimeout(() => setQueuePresent(false), QUEUE_PANEL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [queueOpen]);

  useEffect(() => {
    if (!queueOpen || !queuePresent || !queueFocusRequestedRef.current) return;
    queueFocusRequestedRef.current = false;
    const focusPanel = () => {
      queuePanelRef.current?.focus({ preventScroll: true });
    };
    if (typeof window.requestAnimationFrame !== "function") {
      const timer = window.setTimeout(focusPanel, 0);
      return () => window.clearTimeout(timer);
    }
    const frame = window.requestAnimationFrame(focusPanel);
    return () => window.cancelAnimationFrame(frame);
  }, [queueOpen, queuePresent]);
  const playerStateErrorNotifiedRef = useRef(false);
  const playerStateWriteRef = useRef<Promise<void>>(Promise.resolve());
  const playbackSessionRef = useRef<PlaybackSession>({
    trackId: "",
    startedAt: 0,
    listenedSeconds: 0,
    lastPosition: 0,
    nowPlayingSent: false,
    scrobbleState: "idle",
  });
  const radioScrobbleProgressRef = useRef<RadioScrobbleProgress | undefined>(
    undefined,
  );
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const currentTrack = queue[currentIndex];
  useEffect(() => {
    if (currentTrack) lastPlayedTrackRef.current = currentTrack;
  }, [currentTrack]);
  const currentRadioTimeline = useMemo(
    () => boundRadioChapters(currentTrack?.radioChapters ?? []),
    [currentTrack?.radioChapters],
  );
  const currentRadioScrobbleTimeline = useMemo(
    () =>
      currentTrack?.id.startsWith("radio:")
        ? radioChapterTimelineFromBounded(currentTrack, currentRadioTimeline)
        : [],
    [currentRadioTimeline, currentTrack],
  );
  const currentRadioShowId = currentTrack
    ? radioShowIdFromTrackId(currentTrack.id)
    : undefined;
  const latestPlayerStateRef = useRef({
    queue,
    currentIndex,
    volume,
    repeatMode: repeat,
    queueOpen,
  });
  latestPlayerStateRef.current = {
    queue,
    currentIndex,
    volume,
    repeatMode: repeat,
    queueOpen,
  };

  useEffect(() => {
    if (nowPlayingOpen && !currentTrack) setNowPlayingOpen(false);
  }, [currentTrack, nowPlayingOpen]);

  useEffect(() => {
    if (!isDesktop()) return;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        await appWindow.unminimize();
        await appWindow.show();
        await appWindow.setFocus();
      })
      .catch(() => {
        // The native startup hook is the primary path; this covers delayed WebView startup.
      });
  }, []);

  const notify = useCallback((message: string, tone?: Toast["tone"]) => {
    const id = Date.now();
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 2800);
  }, []);
  const openRadioItem = useCallback((url: string) => {
    void openBandcampUrl(url).catch((cause) => {
      notify(String(cause).replace(/^Error:\s*/, ""), "bad");
    });
  }, [notify]);
  const reportPlayerStateError = useCallback((summary: string, cause: unknown) => {
    if (playerStateErrorNotifiedRef.current) return;
    playerStateErrorNotifiedRef.current = true;
    notify(`${summary}: ${String(cause).replace(/^Error:\s*/, "")}`, "bad");
  }, [notify]);

  const favoriteTrackIds = useMemo(
    () => new Set(localFavorites.songIds),
    [localFavorites.songIds],
  );
  const favoriteAlbumIds = useMemo(
    () => new Set(localFavorites.albumIds),
    [localFavorites.albumIds],
  );
  const favoriteRadioShowIds = useMemo(
    () => new Set(localFavorites.radioShowIds),
    [localFavorites.radioShowIds],
  );
  const queueRecommendation = useMemo(
    () =>
      recommendQueueAlbum(
        albums,
        currentTrack ?? lastPlayedTrackRef.current,
        favoriteAlbumIds,
        queueRecommendationNonce,
      ),
    [albums, currentTrack, favoriteAlbumIds, queueRecommendationNonce],
  );
  const localFavoriteTrackCandidates = useMemo(() => {
    const existing = new Set(localFavorites.tracks.map((track) => track.id));
    const missing = new Set(
      localFavorites.songIds.filter((id) => !existing.has(id)),
    );
    if (!missing.size) return [];
    const candidates: Track[] = [];
    const collect = (tracks: readonly Track[]) => {
      for (const track of tracks) {
        if (!missing.delete(track.id)) continue;
        candidates.push(track);
        if (!missing.size) return true;
      }
      return false;
    };
    if (collect(queue) || collect(selectedAlbum?.tracks ?? [])) return candidates;
    for (const album of albums) {
      if (collect(album.tracks ?? [])) break;
    }
    return candidates;
  }, [
    albums,
    localFavorites.songIds,
    localFavorites.tracks,
    queue,
    selectedAlbum?.tracks,
  ]);

  useEffect(() => {
    const repaired = repairLocalFavoriteMetadata(
      localFavorites,
      albums,
      localFavoriteTrackCandidates,
    );
    if (repaired === localFavorites) return;
    try {
      setLocalFavorites(writeLocalFavorites(repaired));
    } catch {
      // A disabled/full local store should not interrupt collection loading.
    }
  }, [albums, localFavoriteTrackCandidates, localFavorites]);

  const toggleFavorite = useCallback((
    id: string,
    kind: "song" | "album",
    favorite?: boolean,
  ) => {
    const active =
      kind === "song" ? favoriteTrackIds.has(id) : favoriteAlbumIds.has(id);
    const input = { id, kind, favorite: favorite ?? !active };
    const candidate = kind === "song"
      ? queue.find((track) => track.id === id) ??
        selectedAlbum?.tracks?.find((track) => track.id === id)
      : (selectedAlbum?.id === id ? selectedAlbum : undefined) ??
        albums.find((album) => album.id === id);
    try {
      const next = writeLocalFavorites(
        updateLocalFavorites(localFavorites, input, candidate),
      );
      setLocalFavorites(next);
      notify(
        input.favorite ? "Saved to Favorites on this device" : "Removed from local Favorites",
        "good",
      );
    } catch (cause) {
      notify(String(cause).replace(/^Error:\s*/, ""), "bad");
    }
  }, [
    albums,
    favoriteAlbumIds,
    favoriteTrackIds,
    localFavorites,
    notify,
    queue,
    selectedAlbum,
  ]);

  const toggleRadioFavorite = useCallback((
    show: RadioShowSummary,
    favorite?: boolean,
  ) => {
    const nextFavorite = favorite ?? !favoriteRadioShowIds.has(show.id);
    try {
      const next = writeLocalFavorites(
        updateLocalRadioFavorite(localFavorites, show, nextFavorite),
      );
      setLocalFavorites(next);
      notify(
        nextFavorite
          ? "Radio show saved to Favorites on this device"
          : "Radio show removed from local Favorites",
        "good",
      );
    } catch (cause) {
      notify(String(cause).replace(/^Error:\s*/, ""), "bad");
    }
  }, [favoriteRadioShowIds, localFavorites, notify]);

  const toggleCurrentFavorite = useCallback(() => {
    if (!currentTrack) return;
    const radioShowId = radioShowIdFromTrackId(currentTrack.id);
    if (radioShowId === undefined) {
      toggleFavorite(currentTrack.id, "song");
      return;
    }
    void queryClient.fetchQuery({
      queryKey: ["bandcamp-radio-show", radioShowId],
      queryFn: () => fetchRadioShow(radioShowId),
      staleTime: 10 * 60 * 1_000,
    }).then(
      (show) => toggleRadioFavorite(show),
      (cause) => notify(String(cause).replace(/^Error:\s*/, ""), "bad"),
    );
  }, [
    currentTrack,
    notify,
    queryClient,
    toggleFavorite,
    toggleRadioFavorite,
  ]);

  const enqueuePlayerStateWrite = useCallback((write: () => Promise<unknown>) => {
    const result = playerStateWriteRef.current
      .catch(() => undefined)
      .then(write);
    playerStateWriteRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  useEffect(() => {
    let active = true;
    const generation = restoreGenerationRef.current + 1;
    restoreGenerationRef.current = generation;

    loadPlayerState()
      .then((state) => {
        if (!active || restoreGenerationRef.current !== generation || !state) return;
        const restoredQueue = state.queue as Track[];
        const restoredTrack = restoredQueue[state.currentIndex];
        restoredPlaybackSessionRef.current = state.lastFmProgress;
        restoredRadioScrobbleProgressRef.current = state.radioScrobbleProgress;
        pendingRestorePositionRef.current =
          restoredTrack && state.positionSeconds > 0
            ? { trackId: restoredTrack.id, position: state.positionSeconds }
            : undefined;
        setQueue(restoredQueue);
        setCurrentIndex(state.currentIndex);
        playbackClock.restore(state.positionSeconds);
        setVolume(state.volume);
        setRepeat(state.repeatMode);
        setQueueOpen(Boolean(restoredTrack) && state.queueOpen);
        setPlaying(false);
      })
      .catch((cause) => {
        if (active) {
          reportPlayerStateError(
            "Coda could not restore the previous listening session",
            cause,
          );
        }
      })
      .finally(() => {
        if (active && restoreGenerationRef.current === generation) {
          setPlayerStateReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [playbackClock, reportPlayerStateError]);

  const syncLibrary = useCallback(async ({
    announce = true,
    forceFull = true,
  }: {
    announce?: boolean;
    forceFull?: boolean;
  } = {}) => {
    const generation = librarySyncGenerationRef.current + 1;
    librarySyncGenerationRef.current = generation;
    const previousLibrary =
      queryClient.getQueryData<Album[]>(libraryQueryKey) ?? [];
    setSyncState("syncing");
    try {
      const library = await fetchLibrary(
        (progress) => {
          if (librarySyncGenerationRef.current !== generation) return;
          setAlbums((current) => mergeLibraryProgress(current, progress));
        },
        { forceFull },
      );
      if (librarySyncGenerationRef.current !== generation) return;
      setAlbums(library);
      setConnected(true);
      setLibraryError("");
      setSyncState("idle");
      if (announce) notify(`${countLabel(library.length, "album")} synced`, "good");
    } catch (cause) {
      if (librarySyncGenerationRef.current !== generation) return;
      setAlbums(previousLibrary);
      const message = String(cause).replace(/^Error:\s*/, "");
      setLibraryError(message);
      setSyncState("error");
      if (announce) notify(message, "bad");
    }
  }, [notify, queryClient, setAlbums]);

  useEffect(() => {
    let active = true;
    const generation = librarySyncGenerationRef.current;
    (async () => {
      try {
        const available = await hasConnection();
        if (
          !active ||
          librarySyncGenerationRef.current !== generation
        ) return;
        setConnected(available);
        if (available) {
          const snapshot = await hydrateLibraryQuery().catch(() => undefined);
          if (
            !active ||
            librarySyncGenerationRef.current !== generation
          ) return;
          if (snapshot) {
            queryClient.setQueryData(libraryQueryKey, toLibrarySummaries(snapshot.albums), {
              updatedAt: snapshot.savedAt,
            });
            if (!shouldAutoRevalidateLibrary(snapshot)) {
              setLibraryError("");
              setSyncState("idle");
              return;
            }
          }
          await syncLibrary({ announce: false, forceFull: false });
        } else {
          clearRuntimeCaches();
          setAlbums([]);
          setSyncState("idle");
        }
      } catch (cause) {
        if (!active) return;
        setLibraryError(String(cause).replace(/^Error:\s*/, ""));
        setSyncState("error");
      }
    })();
    return () => {
      active = false;
      librarySyncGenerationRef.current += 1;
    };
  }, [queryClient, setAlbums, syncLibrary]);

  useEffect(() => {
    let active = true;
    getLastFmStatus()
      .then((status) => {
        if (active) setLastFmStatus(status);
      })
      .catch(() => {
        // Last.fm is optional; Bandcamp playback remains available.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const positionSeconds = playbackClock.readExact();
    if (currentTrack?.id.startsWith("radio:")) {
      const restoredRadio = restoredRadioScrobbleProgressRef.current;
      radioScrobbleProgressRef.current =
        restoredRadio?.showTrackId === currentTrack.id
          ? { ...restoredRadio, lastPosition: positionSeconds }
          : createRadioScrobbleProgress(currentTrack.id, positionSeconds);
      restoredRadioScrobbleProgressRef.current = undefined;
      playbackSessionRef.current = {
        trackId: "",
        startedAt: 0,
        listenedSeconds: 0,
        lastPosition: positionSeconds,
        nowPlayingSent: false,
        scrobbleState: "idle",
      };
      return;
    }
    radioScrobbleProgressRef.current = undefined;
    const restored = restoredPlaybackSessionRef.current;
    if (currentTrack && restored?.trackId === currentTrack.id) {
      playbackSessionRef.current = {
        ...restored,
        startedAt: 0,
        nowPlayingSent: false,
        lastPosition: positionSeconds,
      };
      restoredPlaybackSessionRef.current = undefined;
      return;
    }
    playbackSessionRef.current = {
      trackId: currentTrack?.id ?? "",
      startedAt: 0,
      listenedSeconds: 0,
      lastPosition: positionSeconds,
      nowPlayingSent: false,
      scrobbleState: "idle",
    };
  }, [currentTrack?.id, playbackClock]);

  const checkpointLatestPlayerState = useCallback(() => {
    const state = latestPlayerStateRef.current;
    const track = state.queue[state.currentIndex];
    if (!track || isEphemeralTrackId(track.id)) return Promise.resolve(false);
    const positionSeconds = playbackClock.readExact();
    const persistedIndex =
      state.queue
        .slice(0, state.currentIndex + 1)
        .filter((item) => !isEphemeralTrackId(item.id))
        .length - 1;
    return enqueuePlayerStateWrite(() =>
      checkpointPlayerState({
        currentIndex: persistedIndex,
        currentTrackId: track.id,
        positionSeconds,
        lastFmProgress: persistedLastFmProgress(track, playbackSessionRef.current),
        radioScrobbleProgress: persistedRadioScrobbleProgress(
          track,
          radioScrobbleProgressRef.current,
        ),
      }),
    );
  }, [enqueuePlayerStateWrite, playbackClock]);

  useEffect(() => {
    if (!playerStateReady) return;
    const timer = window.setTimeout(() => {
      const track = queue[currentIndex];
      const positionSeconds = playbackClock.readExact();
      void enqueuePlayerStateWrite(() =>
        savePlayerState({
          queue,
          currentIndex,
          positionSeconds,
          volume,
          repeatMode: repeat,
          queueOpen,
          lastFmProgress: persistedLastFmProgress(track, playbackSessionRef.current),
          radioScrobbleProgress: persistedRadioScrobbleProgress(
            track,
            radioScrobbleProgressRef.current,
          ),
        }),
      )
        .then(() => {
          playerStateErrorNotifiedRef.current = false;
        })
        .catch((cause) => {
          reportPlayerStateError("Coda could not preserve this queue", cause);
        });
    }, PLAYER_STATE_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [
    currentIndex,
    enqueuePlayerStateWrite,
    playerStateReady,
    playbackClock,
    queue,
    queueOpen,
    repeat,
    reportPlayerStateError,
    volume,
  ]);

  useEffect(() => {
    if (!playerStateReady) return;
    const interval = window.setInterval(() => {
      void checkpointLatestPlayerState()
        .then((saved) => {
          if (saved) playerStateErrorNotifiedRef.current = false;
        })
        .catch((cause) => {
          reportPlayerStateError("Coda could not checkpoint playback", cause);
        });
    }, PLAYER_STATE_CHECKPOINT_MS);
    return () => window.clearInterval(interval);
  }, [checkpointLatestPlayerState, playerStateReady, reportPlayerStateError]);

  useEffect(() => {
    if (!playerStateReady || playing) return;
    void checkpointLatestPlayerState()
      .then((saved) => {
        if (saved) playerStateErrorNotifiedRef.current = false;
      })
      .catch((cause) => {
        reportPlayerStateError("Coda could not checkpoint paused playback", cause);
      });
  }, [
    checkpointLatestPlayerState,
    playerStateReady,
    playing,
    reportPlayerStateError,
  ]);

  useEffect(() => {
    if (!currentTrack) {
      setStreamUrl(undefined);
      return;
    }
    if (currentTrack.streamUrl) {
      setStreamUrl(currentTrack.streamUrl);
      return;
    }

    const radioShowId = radioShowIdFromTrackId(currentTrack.id);
    if (radioShowId !== undefined) {
      let active = true;
      setStreamUrl(undefined);
      queryClient.fetchQuery({
        queryKey: ["bandcamp-radio-show", radioShowId],
        queryFn: () => fetchRadioShow(radioShowId),
        staleTime: 10 * 60 * 1_000,
      })
        .then((show) => {
          if (!active) return;
          const refreshedTrack: Track = {
            ...currentTrack,
            title: show.subtitle,
            artist: "Bandcamp Radio",
            album: show.title,
            albumId: `radio:${show.id}`,
            duration: show.duration,
            artworkUrl: show.artworkUrl,
            streamUrl: show.streamUrl,
            radioChapters: boundRadioChapters(show.chapters),
          };
          setQueue((items) =>
            items.map((item, index) =>
              index === currentIndex && item.id === currentTrack.id
                ? refreshedTrack
                : item,
            ),
          );
          setStreamUrl(show.streamUrl);
        })
        .catch((cause) => {
          if (active) {
            setPlaying(false);
            notify(
              `Coda could not resume this Radio show: ${String(cause).replace(/^Error:\s*/, "")}`,
              "bad",
            );
          }
        });
      return () => {
        active = false;
      };
    }

    if (!connected) {
      setStreamUrl(undefined);
      return;
    }

    let active = true;
    setStreamUrl(undefined);
    fetchStreamUrl(currentTrack.id)
      .then((url) => {
        if (active) setStreamUrl(url);
      })
      .catch((cause) => {
        if (active) {
          setPlaying(false);
          notify(String(cause), "bad");
        }
      });
    return () => {
      active = false;
    };
  }, [
    connected,
    currentIndex,
    currentTrack?.id,
    currentTrack?.streamUrl,
    notify,
    queryClient,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.setAttribute("x-webkit-airplay", "allow");
    const updateAvailability = () => setAirPlayAvailable(supportsAirPlayPicker(audio));
    updateAvailability();
    audio.addEventListener("webkitplaybacktargetavailabilitychanged", updateAvailability);
    return () =>
      audio.removeEventListener("webkitplaybacktargetavailabilitychanged", updateAvailability);
  }, []);

  const openAirPlay = useCallback(() => {
    if (!showAirPlayPicker(audioRef.current)) {
      notify("AirPlay is not available on this device.", "bad");
    }
  }, [notify]);

  const dispatchRadioScrobbleActions = useCallback((
    showTrackId: string,
    actions: readonly RadioScrobbleAction[],
  ) => {
    for (const action of actions) {
      if (action.kind === "now-playing") {
        updateLastFmNowPlaying(action.track).catch(() => {
          notify("Last.fm could not update this Radio chapter.", "bad");
        });
        continue;
      }
      scrobbleLastFm(action.track, action.timestamp)
        .then(() => {
          const progress = radioScrobbleProgressRef.current;
          if (progress?.showTrackId === showTrackId) {
            radioScrobbleProgressRef.current = markRadioChapterScrobble(
              progress,
              action.chapterKey,
              "sent",
            );
          }
        })
        .catch(() => {
          const progress = radioScrobbleProgressRef.current;
          if (progress?.showTrackId === showTrackId) {
            radioScrobbleProgressRef.current = markRadioChapterScrobble(
              progress,
              action.chapterKey,
              "failed",
            );
          }
          notify("Last.fm could not scrobble this Radio chapter.", "bad");
        });
    }
  }, [notify]);

  const handleAudioPlaying = useCallback(() => {
    if (!currentTrack) return;
    const positionSeconds =
      audioRef.current?.currentTime ?? playbackClock.readExact();
    if (currentTrack.id.startsWith("radio:")) {
      const progress =
        radioScrobbleProgressRef.current ??
        createRadioScrobbleProgress(currentTrack.id, positionSeconds);
      const advanced = advanceRadioScrobblingWithTimeline(
        currentTrack,
        currentRadioScrobbleTimeline,
        progress,
        positionSeconds,
        true,
        lastFmStatus.connected,
      );
      radioScrobbleProgressRef.current = advanced.progress;
      dispatchRadioScrobbleActions(currentTrack.id, advanced.actions);
      return;
    }
    const session = playbackSessionRef.current;
    if (session.trackId !== currentTrack.id) return;
    if (!session.startedAt) {
      session.startedAt = Math.floor(Date.now() / 1000);
    }
    if (!lastFmStatus.connected || session.nowPlayingSent) return;
    session.nowPlayingSent = true;
    updateLastFmNowPlaying(lastFmTrackInput(currentTrack)).catch(() => {
      if (playbackSessionRef.current === session) {
        notify("Last.fm could not update Now Playing.", "bad");
      }
    });
  }, [
    currentTrack,
    currentRadioScrobbleTimeline,
    dispatchRadioScrobbleActions,
    lastFmStatus.connected,
    notify,
    playbackClock,
  ]);

  const handleAudioSeeking = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    const positionSeconds = event.currentTarget.currentTime;
    playbackClock.seek(positionSeconds);
    playbackSessionRef.current.lastPosition = positionSeconds;
    if (radioScrobbleProgressRef.current) {
      radioScrobbleProgressRef.current = {
        ...radioScrobbleProgressRef.current,
        lastPosition: positionSeconds,
      };
    }
  }, [playbackClock]);

  const handleAudioLoadedMetadata = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    const pending = pendingRestorePositionRef.current;
    if (!pending || pending.trackId !== currentTrack?.id) return;
    const duration = event.currentTarget.duration;
    const maximum = Number.isFinite(duration) && duration > 0
      ? Math.max(0, duration - 0.25)
      : pending.position;
    const position = Math.min(Math.max(0, pending.position), maximum);
    playbackSessionRef.current.lastPosition = position;
    if (radioScrobbleProgressRef.current) {
      radioScrobbleProgressRef.current = {
        ...radioScrobbleProgressRef.current,
        lastPosition: position,
      };
    }
    event.currentTarget.currentTime = position;
    playbackClock.restore(position);
    pendingRestorePositionRef.current = undefined;
  }, [currentTrack?.id, playbackClock]);

  const handleAudioTimeUpdate = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    const position = event.currentTarget.currentTime;
    playbackClock.updateFromMedia(position);

    const track = currentTrack;
    if (!track) return;
    if (track.id.startsWith("radio:")) {
      const progress =
        radioScrobbleProgressRef.current ??
        createRadioScrobbleProgress(track.id, position);
      const advanced = advanceRadioScrobblingWithTimeline(
        track,
        currentRadioScrobbleTimeline,
        progress,
        position,
        playing,
        lastFmStatus.connected,
      );
      radioScrobbleProgressRef.current = advanced.progress;
      dispatchRadioScrobbleActions(track.id, advanced.actions);
      return;
    }

    const session = playbackSessionRef.current;
    if (session.trackId !== track.id) return;
    const delta = position - session.lastPosition;
    session.lastPosition = position;
    if (playing && delta > 0 && delta <= 10) {
      session.listenedSeconds += delta;
    }
    const threshold = Math.min(track.duration / 2, 240);
    if (
      !lastFmStatus.connected ||
      track.duration <= 30 ||
      !session.startedAt ||
      session.listenedSeconds < threshold ||
      session.scrobbleState !== "idle"
    ) {
      return;
    }

    session.scrobbleState = "pending";
    scrobbleLastFm(lastFmTrackInput(track), session.startedAt)
      .then(() => {
        if (playbackSessionRef.current === session) {
          session.scrobbleState = "sent";
        }
      })
      .catch(() => {
        if (playbackSessionRef.current === session) {
          session.scrobbleState = "failed";
          notify("Last.fm could not scrobble this track.", "bad");
        }
      });
  }, [
    currentTrack,
    currentRadioScrobbleTimeline,
    dispatchRadioScrobbleActions,
    lastFmStatus.connected,
    notify,
    playbackClock,
    playing,
  ]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !streamUrl) return;
    if (playing) {
      audio.play().catch(() => setPlaying(false));
    } else {
      audio.pause();
    }
  }, [playing, streamUrl]);

  const togglePlayback = useCallback(() => {
    if (currentTrack) setPlaying((value) => !value);
  }, [currentTrack]);

  const advanceQueue = useCallback(() => {
    playbackClock.reset();
    setCurrentIndex((index) => {
      if (repeat === "one") return index;
      if (index + 1 < queue.length) return index + 1;
      if (repeat === "all") return 0;
      setPlaying(false);
      return index;
    });
  }, [playbackClock, queue.length, repeat]);

  const next = useCallback(() => {
    if (!currentTrack) return;
    const playbackSeconds =
      audioRef.current?.currentTime ?? playbackClock.readExact();
    const chapterTime = nextRadioChapterTimeInTimeline(
      currentRadioTimeline,
      playbackSeconds,
    );
    if (chapterTime !== undefined) {
      playbackClock.seek(chapterTime);
      if (audioRef.current) audioRef.current.currentTime = chapterTime;
      return;
    }
    const canAdvance =
      currentIndex + 1 < queue.length ||
      (repeat === "all" && queue.length > 1);
    if (!canAdvance) return;
    playbackClock.reset();
    setCurrentIndex((index) =>
      index + 1 < queue.length ? index + 1 : 0,
    );
  }, [
    currentIndex,
    currentRadioTimeline,
    currentTrack,
    playbackClock,
    queue.length,
    repeat,
  ]);

  const handleAudioEnded = useCallback((event: SyntheticEvent<HTMLAudioElement>) => {
    const track = currentTrack;
    if (track?.id.startsWith("radio:")) {
      const progress =
        radioScrobbleProgressRef.current ??
        createRadioScrobbleProgress(track.id, event.currentTarget.currentTime);
      const advanced = advanceRadioScrobblingWithTimeline(
        track,
        currentRadioScrobbleTimeline,
        progress,
        event.currentTarget.currentTime,
        true,
        lastFmStatus.connected,
      );
      dispatchRadioScrobbleActions(track.id, advanced.actions);
      const completed = completeRadioShowScrobble(
        track,
        advanced.progress,
        lastFmStatus.connected,
      );
      radioScrobbleProgressRef.current = completed.progress;
      if (
        completed.action ||
        advanced.actions.some((action) => action.kind === "chapter-scrobble")
      ) {
        void checkpointLatestPlayerState().catch(() => {
          // The normal periodic checkpoint remains a fallback.
        });
      }
      if (completed.action) {
        const showTrackId = track.id;
        scrobbleLastFm(completed.action.track, completed.action.timestamp)
          .then(() => {
            const latest = radioScrobbleProgressRef.current;
            if (latest?.showTrackId === showTrackId) {
              radioScrobbleProgressRef.current = markRadioShowScrobble(latest, "sent");
            }
          })
          .catch(() => {
            const latest = radioScrobbleProgressRef.current;
            if (latest?.showTrackId === showTrackId) {
              radioScrobbleProgressRef.current = markRadioShowScrobble(latest, "failed");
            }
            notify("Last.fm could not scrobble this completed Radio show.", "bad");
          });
      }
    }
    advanceQueue();
  }, [
    currentTrack,
    currentRadioScrobbleTimeline,
    checkpointLatestPlayerState,
    dispatchRadioScrobbleActions,
    lastFmStatus.connected,
    advanceQueue,
    notify,
  ]);

  const previous = useCallback(() => {
    if (!currentTrack) return;
    const playbackSeconds =
      audioRef.current?.currentTime ?? playbackClock.readExact();
    const chapterTime = previousRadioChapterTimeInTimeline(
      currentRadioTimeline,
      playbackSeconds,
      PREVIOUS_RESTART_THRESHOLD_SECONDS,
    );
    if (chapterTime !== undefined) {
      playbackClock.seek(chapterTime);
      if (audioRef.current) audioRef.current.currentTime = chapterTime;
      return;
    }
    if (playbackSeconds > PREVIOUS_RESTART_THRESHOLD_SECONDS) {
      playbackClock.reset();
      if (audioRef.current) audioRef.current.currentTime = 0;
      return;
    }
    const canMoveBack =
      currentIndex > 0 ||
      (repeat === "all" && queue.length > 1);
    if (!canMoveBack) return;
    playbackClock.reset();
    setCurrentIndex((index) =>
      index > 0 ? index - 1 : queue.length - 1,
    );
  }, [
    currentIndex,
    currentRadioTimeline,
    currentTrack,
    playbackClock,
    queue.length,
    repeat,
  ]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const interactiveTarget = target?.closest(
        "button, input, textarea, select, a, [contenteditable='true'], [role='slider']",
      );
      if (interactiveTarget) {
        if (
          event.key === "Escape" &&
          (target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement ||
            target?.isContentEditable)
        ) {
          target?.blur();
        }
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        togglePlayback();
      }
      if (event.key === "/" || (event.ctrlKey && event.key.toLowerCase() === "k")) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.altKey && event.key === "ArrowRight") next();
      if (event.altKey && event.key === "ArrowLeft") previous();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [next, previous, togglePlayback]);

  const genreSummary = useMemo(() => summarizeGenres(albums), [albums]);
  const visibleGenreTabs = useMemo(
    () =>
      genre === "All" || genreSummary.featured.some((item) => genreKey(item) === genreKey(genre))
        ? genreSummary.featured
        : [...genreSummary.featured, genre],
    [genre, genreSummary.featured],
  );
  const overflowGenres = useMemo(
    () =>
      genreSummary.all.filter(
        (item) => !visibleGenreTabs.some((visible) => genreKey(visible) === genreKey(item)),
      ),
    [genreSummary.all, visibleGenreTabs],
  );

  useEffect(() => {
    if (
      genre !== "All" &&
      !genreSummary.all.some((item) => genreKey(item) === genreKey(genre))
    ) {
      setGenre("All");
    }
  }, [genre, genreSummary.all]);

  const effectiveBrowseMode = view === "library" ? browseMode : "releases";
  const albumSearchIndex = useMemo(
    () =>
      new Map(
        albums.map((album) => [
          album.id,
          `${album.title} ${album.artist} ${album.genre ?? ""}`.toLowerCase(),
        ]),
      ),
    [albums],
  );
  const matchingAlbums = useMemo(() => {
    const list = albums.filter((album) => {
      if (genre !== "All" && genreKey(album.genre) !== genreKey(genre)) return false;
      if (
        deferredQuery &&
        !albumSearchIndex.get(album.id)?.includes(deferredQuery)
      ) return false;
      if (!matchesBrowseMode(album, effectiveBrowseMode)) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      if (sort === "artist") return LIBRARY_COLLATOR.compare(a.artist, b.artist);
      if (sort === "title") return LIBRARY_COLLATOR.compare(a.title, b.title);
      if (sort === "year") return (b.year ?? 0) - (a.year ?? 0);
      return (b.addedAt ?? "").localeCompare(a.addedAt ?? "");
    });
    return view === "recent" ? sorted.slice(0, 12) : sorted;
  }, [
    albumSearchIndex,
    albums,
    deferredQuery,
    effectiveBrowseMode,
    genre,
    sort,
    view,
  ]);
  const artistGroups = useMemo(() => groupAlbumsByArtist(matchingAlbums), [matchingAlbums]);
  const visibleAlbums = useMemo(
    () =>
      effectiveBrowseMode === "artists" && selectedArtist
        ? matchingAlbums.filter((album) => artistKey(album.artist) === selectedArtist)
        : matchingAlbums,
    [effectiveBrowseMode, matchingAlbums, selectedArtist],
  );
  const activeArtist = useMemo(
    () => artistGroups.find((group) => group.key === selectedArtist),
    [artistGroups, selectedArtist],
  );
  const canPrevious = Boolean(currentTrack) && (
    currentIndex > 0 ||
    (repeat === "all" && queue.length > 1)
  );
  const canNext = Boolean(currentTrack) && (
    currentIndex + 1 < queue.length ||
    (repeat === "all" && queue.length > 1)
  );

  const libraryBrowseCounts = useMemo(
    () => {
      const artists = new Set<string>();
      let albumCount = 0;
      let singleCount = 0;
      for (const album of albums) {
        artists.add(artistKey(album.artist));
        if (matchesBrowseMode(album, "albums")) albumCount += 1;
        if (matchesBrowseMode(album, "singles")) singleCount += 1;
      }
      return {
        artists: artists.size,
        albums: albumCount,
        singles: singleCount,
      };
    },
    [albums],
  );
  useEffect(() => {
    if (
      effectiveBrowseMode === "artists" &&
      selectedArtist &&
      !artistGroups.some((group) => group.key === selectedArtist)
    ) {
      setSelectedArtist(undefined);
    }
  }, [artistGroups, effectiveBrowseMode, selectedArtist]);

  const ensureTracks = useCallback(async (
    album: Album,
    sessionGeneration = bandcampSessionGenerationRef.current,
  ): Promise<Album | undefined> => {
    if (bandcampSessionGenerationRef.current !== sessionGeneration) return undefined;
    const hasLocalTracklist = Boolean(album.tracks?.length);
    if (!hasLocalTracklist) setAlbumLoading(true);
    try {
      const tracks = await ensureAlbumQueryData(queryClient, album);
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return undefined;
      const hydrated = albumWithTracks(album, tracks);
      setAlbums((items) =>
        items.map((item) =>
          item.id === album.id ? albumWithRecoveredCover(item, tracks) : item
        ),
      );
      setSelectedAlbum((item) => item?.id === album.id ? hydrated : item);
      return hydrated;
    } catch (cause) {
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return undefined;
      throw cause;
    } finally {
      if (
        !hasLocalTracklist &&
        bandcampSessionGenerationRef.current === sessionGeneration
      ) {
        setAlbumLoading(false);
      }
    }
  }, [queryClient, setAlbums]);

  const openAlbum = useCallback(async (album: Album) => {
    const sessionGeneration = bandcampSessionGenerationRef.current;
    const hasLocalTracklist = Boolean(album.tracks?.length);
    let albumForDetail = album;
    void transitionCodaView(() => setSelectedAlbum(albumForDetail), "page-forward");
    try {
      const ready = await ensureTracks(album, sessionGeneration);
      if (
        !ready ||
        bandcampSessionGenerationRef.current !== sessionGeneration
      ) return;
      albumForDetail = ready;
      setSelectedAlbum((item) => item?.id === album.id ? albumForDetail : item);
      if (
        hasLocalTracklist &&
        bandcampSessionGenerationRef.current === sessionGeneration
      ) {
        void revalidateAlbumQueryData(queryClient, album)
          .then((tracks) => {
            if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
            if (!tracks.length && albumForDetail.tracks?.length) return;
            const refreshed = albumWithTracks(albumForDetail, tracks);
            setAlbums((items) =>
              items.map((item) =>
                item.id === album.id
                  ? albumWithRecoveredCover(item, tracks)
                  : item
              ),
            );
            setSelectedAlbum((item) => item?.id === album.id ? refreshed : item);
          })
          .catch(() => {
            // Keep the usable local tracklist when background revalidation fails.
          });
      }
    } catch (cause) {
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
      notify(String(cause), "bad");
    }
  }, [ensureTracks, notify, queryClient, setAlbums]);

  const openTrackAlbum = useCallback((track: Track) => {
    if (track.id.startsWith("radio:")) {
      const series = radioSeriesByTitle(track.album);
      setNowPlayingOpen(false);
      setView("radio");
      setRadioSeriesId(series?.id);
      setRadioRequestedShowId(radioShowIdFromTrackId(track.id));
      setSelectedAlbum(undefined);
      setSelectedArtist(undefined);
      return;
    }
    const album = albums.find((item) => item.id === track.albumId);
    if (album) {
      setNowPlayingOpen(false);
      setView("library");
      void openAlbum(album);
      return;
    }
    notify(`Could not find ${track.album} in this library`, "bad");
  }, [albums, notify, openAlbum]);

  const playAlbum = useCallback(async (album: Album) => {
    const sessionGeneration = bandcampSessionGenerationRef.current;
    try {
      const ready = await ensureTracks(album, sessionGeneration);
      if (
        !ready?.tracks?.length ||
        bandcampSessionGenerationRef.current !== sessionGeneration
      ) return;
      setQueue(ready.tracks);
      setCurrentIndex(0);
      playbackClock.reset();
      setPlaying(true);
    } catch (cause) {
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
      notify(String(cause), "bad");
    }
  }, [ensureTracks, notify, playbackClock]);

  const queueAlbum = useCallback(async (album: Album) => {
    const sessionGeneration = bandcampSessionGenerationRef.current;
    try {
      const ready = await ensureTracks(album, sessionGeneration);
      if (
        !ready?.tracks ||
        bandcampSessionGenerationRef.current !== sessionGeneration
      ) return;
      setQueue((items) => appendUnique(items, ready.tracks!));
      notify(`${album.title} added to queue`, "good");
    } catch (cause) {
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
      notify(String(cause), "bad");
    }
  }, [ensureTracks, notify]);

  const loadArtistTracks = useCallback(async (
    group: ArtistGroup,
    action: "play" | "shuffle" | "queue",
  ) => {
    if (artistAction || !connected) return;
    const sessionGeneration = bandcampSessionGenerationRef.current;
    setArtistAction(action);
    const tracksByAlbum: Track[][] = Array.from({ length: group.albums.length }, () => []);
    const recoveredCovers = new Map<string, Album>();
    let cursor = 0;

    const worker = async () => {
      while (
        bandcampSessionGenerationRef.current === sessionGeneration &&
        cursor < group.albums.length
      ) {
        const index = cursor;
        cursor += 1;
        const album = group.albums[index];
        try {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          const tracks = await ensureAlbumQueryData(queryClient, album);
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          tracksByAlbum[index] = tracks;
          recoveredCovers.set(album.id, albumWithRecoveredCover(album, tracks));
        } catch {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          // One unavailable purchase should not block the rest of an artist.
        }
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(SEARCH_QUEUE_CONCURRENCY, group.albums.length) },
          () => worker(),
        ),
      );
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
      const tracks = tracksByAlbum.flat();
      if (!tracks.length) {
        notify(`No playable tracks were returned for ${group.name}.`, "bad");
        return;
      }
      setAlbums((items) =>
        items.map((album) => recoveredCovers.get(album.id) ?? album),
      );
      if (action === "play" || action === "shuffle") {
        setQueue(action === "shuffle" ? shuffled(tracks) : tracks);
        setCurrentIndex(0);
        playbackClock.reset();
        setPlaying(true);
        notify(
          action === "shuffle"
            ? `Shuffling ${countLabel(tracks.length, "track")} by ${group.name}`
            : `Playing ${group.name}`,
          "good",
        );
      } else {
        setQueue((items) => appendUnique(items, tracks));
        notify(`${countLabel(tracks.length, `${group.name} track`)} added to queue`, "good");
      }
    } finally {
      if (bandcampSessionGenerationRef.current === sessionGeneration) {
        setArtistAction(undefined);
      }
    }
  }, [artistAction, connected, notify, playbackClock, queryClient, setAlbums]);

  const queueSearchResults = useCallback(async () => {
    if (!connected || queueSearchProgress || !visibleAlbums.length) return;
    const sessionGeneration = bandcampSessionGenerationRef.current;
    const targets = [...visibleAlbums];
    const recoveredCovers = new Map<string, Album>();
    const tracksByAlbum: Track[][] = Array.from({ length: targets.length }, () => []);
    let cursor = 0;
    let completed = 0;
    setQueueSearchProgress({ done: 0, total: targets.length });

    const worker = async () => {
      while (
        bandcampSessionGenerationRef.current === sessionGeneration &&
        cursor < targets.length
      ) {
        const index = cursor;
        cursor += 1;
        const album = targets[index];
        try {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          const tracks = await ensureAlbumQueryData(queryClient, album);
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          recoveredCovers.set(album.id, albumWithRecoveredCover(album, tracks));
          tracksByAlbum[index] = tracks;
        } catch {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          // Keep loading the rest when an individual release is unavailable.
        } finally {
          if (bandcampSessionGenerationRef.current === sessionGeneration) {
            completed += 1;
            if (completed === targets.length || completed % 4 === 0) {
              setQueueSearchProgress({ done: completed, total: targets.length });
            }
          }
        }
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(SEARCH_QUEUE_CONCURRENCY, targets.length) },
          () => worker(),
        ),
      );
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
      const tracks = tracksByAlbum.flat();
      if (recoveredCovers.size) {
        setAlbums((items) =>
          items.map((album) => recoveredCovers.get(album.id) ?? album),
        );
      }
      setQueue((items) => appendUnique(items, tracks));
      notify(
        tracks.length
          ? `${countLabel(tracks.length, "track")} from ${countLabel(recoveredCovers.size, "search result")} added`
          : "No playable tracks were returned for those results.",
        tracks.length ? "good" : "bad",
      );
    } finally {
      if (bandcampSessionGenerationRef.current === sessionGeneration) {
        setQueueSearchProgress(undefined);
      }
    }
  }, [connected, notify, queryClient, queueSearchProgress, setAlbums, visibleAlbums]);

  const shuffleLibrary = useCallback(async (
    scopeAlbums: readonly Album[] = albums,
    scopeName = "entire library",
  ) => {
    if (libraryShuffleActiveRef.current || !connected || !scopeAlbums.length) return;
    const sessionGeneration = bandcampSessionGenerationRef.current;
    libraryShuffleActiveRef.current = true;
    const targets = shuffled([...scopeAlbums]);
    const recoveredCovers = new Map<string, Album>();
    const loadedTracks: Track[][] = Array.from({ length: targets.length }, () => []);
    let cursor = 0;
    let completed = 0;
    setLibraryShuffleProgress({ done: 0, total: targets.length });

    const worker = async () => {
      while (
        bandcampSessionGenerationRef.current === sessionGeneration &&
        cursor < targets.length
      ) {
        const index = cursor;
        cursor += 1;
        const album = targets[index];
        try {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          const tracks = await ensureAlbumQueryData(queryClient, album);
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          recoveredCovers.set(album.id, albumWithRecoveredCover(album, tracks));
          loadedTracks[index] = tracks;
        } catch {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          // A removed or unavailable release should not block the rest of the shuffle.
        } finally {
          if (bandcampSessionGenerationRef.current === sessionGeneration) {
            completed += 1;
            if (completed === targets.length || completed % 5 === 0) {
              setLibraryShuffleProgress({ done: completed, total: targets.length });
            }
          }
        }
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(SEARCH_QUEUE_CONCURRENCY, targets.length) },
          () => worker(),
        ),
      );
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
      const tracks = shuffled(loadedTracks.flat());
      if (!tracks.length) {
        notify("Bandcamp did not return any playable tracks.", "bad");
        return;
      }
      setAlbums((items) =>
        items.map((album) => recoveredCovers.get(album.id) ?? album),
      );
      setQueue(tracks);
      setCurrentIndex(0);
      playbackClock.reset();
      setPlaying(true);
      notify(
        `${countLabel(tracks.length, "track")} from ${scopeName} shuffled`,
        "good",
      );
    } finally {
      if (bandcampSessionGenerationRef.current === sessionGeneration) {
        libraryShuffleActiveRef.current = false;
        setLibraryShuffleProgress(undefined);
      }
    }
  }, [albums, connected, notify, playbackClock, queryClient, setAlbums]);

  const playTrack = useCallback((track: Track) => {
    setQueue((items) => {
      const existing = items.findIndex((item) => item.id === track.id);
      if (existing >= 0) {
        setCurrentIndex(existing);
        return items;
      }
      const insertion = Math.min(currentIndex + 1, items.length);
      const copy = [...items];
      copy.splice(insertion, 0, track);
      setCurrentIndex(insertion);
      return copy;
    });
    playbackClock.reset();
    setPlaying(true);
  }, [currentIndex, playbackClock]);

  const playTrackAt = useCallback((track: Track, position: number) => {
    const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
    const alreadyLoaded = currentTrack?.id === track.id && Boolean(audioRef.current);
    if (!alreadyLoaded && safePosition > 0) {
      pendingRestorePositionRef.current = { trackId: track.id, position: safePosition };
    }
    playTrack(track);
    playbackClock.seek(safePosition);
    if (alreadyLoaded && audioRef.current) {
      audioRef.current.currentTime = safePosition;
    }
  }, [currentTrack?.id, playTrack, playbackClock]);

  const playTracks = useCallback((tracks: Track[]) => {
    if (!tracks.length) return;
    setQueue(tracks);
    setCurrentIndex(0);
    playbackClock.reset();
    setPlaying(true);
    notify(`Playing ${countLabel(tracks.length, "track")}`, "good");
  }, [notify, playbackClock]);

  const queueTracks = useCallback((tracks: Track[]) => {
    if (!tracks.length) return;
    setQueue((items) => appendUnique(items, tracks));
    notify(`${countLabel(tracks.length, "track")} added to queue`, "good");
  }, [notify]);

  const playRandomTrack = useCallback(async (
    scopeAlbums: readonly Album[],
    scopeName: string,
  ) => {
    if (randomPickActiveRef.current || !connected || !scopeAlbums.length) return;
    const sessionGeneration = bandcampSessionGenerationRef.current;
    randomPickActiveRef.current = true;
    setRandomPickLoading(true);
    const remaining = [...scopeAlbums];

    try {
      while (
        bandcampSessionGenerationRef.current === sessionGeneration &&
        remaining.length
      ) {
        const album = pickWeightedItem(
          remaining,
          (item) => Math.max(1, item.songCount),
        );
        if (!album) break;
        remaining.splice(remaining.findIndex((item) => item.id === album.id), 1);

        try {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          const ready = await ensureTracks(album, sessionGeneration);
          if (
            !ready ||
            bandcampSessionGenerationRef.current !== sessionGeneration
          ) return;
          const track = pickRandomItem(ready.tracks ?? []);
          if (!track) continue;
          playTrack(track);
          notify(`Playing ${track.title} by ${track.artist}.`, "good");
          return;
        } catch {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          // Keep trying when a purchased release is no longer playable.
        }
      }
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
      notify(`No playable tracks were found in ${scopeName}.`, "bad");
    } finally {
      if (bandcampSessionGenerationRef.current === sessionGeneration) {
        randomPickActiveRef.current = false;
        setRandomPickLoading(false);
      }
    }
  }, [connected, ensureTracks, notify, playTrack]);

  const removeQueueItem = useCallback((index: number) => {
    setQueue((items) => {
      const nextQueue = items.filter((_, itemIndex) => itemIndex !== index);
      setCurrentIndex((activeIndex) => {
        if (!nextQueue.length) return 0;
        if (index < activeIndex) return activeIndex - 1;
        return Math.min(activeIndex, nextQueue.length - 1);
      });
      if (!nextQueue.length) {
        setPlaying(false);
        playbackClock.reset();
      }
      return nextQueue;
    });
  }, [playbackClock]);

  const clearQueue = useCallback(() => {
    if (currentTrack) {
      setQueue((items) => keepCurrentTrack(items, currentIndex));
      setCurrentIndex(0);
      return;
    }
    setQueue([]);
    setCurrentIndex(0);
    playbackClock.reset();
    setPlaying(false);
    setStreamUrl(undefined);
    setSelectedAlbum(undefined);
  }, [currentIndex, currentTrack, playbackClock]);

  const seek = useCallback((value: number) => {
    playbackClock.seek(value);
    if (audioRef.current) audioRef.current.currentTime = value;
  }, [playbackClock]);

  const cycleRepeat = useCallback(() => {
    setRepeat((value) => value === "off" ? "all" : value === "all" ? "one" : "off");
  }, []);

  const refreshArtwork = useCallback(async () => {
    if (!connected || artworkRefreshing) return;
    const sessionGeneration = bandcampSessionGenerationRef.current;
    setArtworkRefreshing(true);
    clearCoverUrlCache();
    window.dispatchEvent(new Event("coda:refresh-artwork"));

    const missing = albums
      .filter((album) => !album.coverArt)
      .slice(0, MAX_ARTWORK_DETAILS_PER_REFRESH);
    const recovered = new Map<string, Album>();
    let cursor = 0;

    const worker = async () => {
      while (
        bandcampSessionGenerationRef.current === sessionGeneration &&
        cursor < missing.length
      ) {
        const album = missing[cursor];
        cursor += 1;
        try {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          const tracks = await refreshAlbumQueryData(queryClient, album);
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          const hydrated = albumWithRecoveredCover(album, tracks);
          if (hydrated.coverArt) recovered.set(album.id, hydrated);
        } catch {
          if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
          // A single unavailable release should not stop the artwork refresh.
        }
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(ARTWORK_REFRESH_CONCURRENCY, missing.length) },
          () => worker(),
        ),
      );
      if (bandcampSessionGenerationRef.current !== sessionGeneration) return;
      if (recovered.size) {
        setAlbums((items) =>
          items.map((album) => recovered.get(album.id) ?? album),
        );
        setSelectedAlbum((album) => album ? recovered.get(album.id) ?? album : album);
      }

      const unchecked = Math.max(0, albums.filter((album) => !album.coverArt).length - missing.length);
      if (recovered.size) {
        notify(
          `${countLabel(recovered.size, "missing cover")} recovered`,
          "good",
        );
      } else if (missing.length || unchecked) {
        notify("Artwork links refreshed; Bandcamp did not return additional missing covers.");
      } else {
        notify("Artwork refreshed", "good");
      }
    } finally {
      if (bandcampSessionGenerationRef.current === sessionGeneration) {
        setArtworkRefreshing(false);
      }
    }
  }, [albums, artworkRefreshing, connected, notify, queryClient, setAlbums]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
    bandcampSessionGenerationRef.current += 1;
    librarySyncGenerationRef.current += 1;
    restoreGenerationRef.current += 1;
    libraryShuffleActiveRef.current = false;
    randomPickActiveRef.current = false;
    setPlayerStateReady(false);
    clearRuntimeCaches();
    setConnected(false);
    setAlbums([]);
    setAlbumLoading(false);
    setArtworkRefreshing(false);
    setArtistAction(undefined);
    setQueueSearchProgress(undefined);
    setLibraryShuffleProgress(undefined);
    setRandomPickLoading(false);
    setQueue([]);
    setCurrentIndex(0);
    playbackClock.reset();
    setPlaying(false);
    setNowPlayingOpen(false);
    pendingRestorePositionRef.current = undefined;
    restoredPlaybackSessionRef.current = undefined;
    restoredRadioScrobbleProgressRef.current = undefined;
    radioScrobbleProgressRef.current = undefined;
    setLibraryError("");
    setSyncState("idle");
    clearBandcampQueryData(queryClient);
    await enqueuePlayerStateWrite(clearPlayerState).catch(() => {
      notify("Bandcamp disconnected, but Coda could not clear the saved player session.", "bad");
    });
    notify("Bandcamp credentials removed", "good");
    setConnectionOpen(false);
  }, [enqueuePlayerStateWrite, notify, playbackClock, queryClient]);

  const toggleQueue = useCallback(() => {
    setQueueOpen((open) => {
      const next = !open;
      if (next) queueFocusRequestedRef.current = true;
      return next;
    });
  }, []);

  const playQueueIndex = useCallback((index: number) => {
    setCurrentIndex(index);
    playbackClock.reset();
    setPlaying(true);
  }, [playbackClock]);

  const shuffleQueue = useCallback(() => {
    setQueue((items) => {
      const head = items[currentIndex] ? [items[currentIndex]] : [];
      setCurrentIndex(0);
      return [...head, ...shuffled(items.slice(currentIndex + 1))];
    });
  }, [currentIndex]);

  const moveQueueItem = useCallback((from: number, to: number) => {
    setQueue((items) => moveItem(items, from, to));
  }, []);

  const openConnection = useCallback(() => setConnectionOpen(true), []);
  const closeConnection = useCallback(() => setConnectionOpen(false), []);
  const closeAlbum = useCallback(() => {
    void transitionCodaView(() => setSelectedAlbum(undefined), "page-back");
  }, []);
  const openNowPlaying = useCallback(() => {
    if (currentTrack) {
      void transitionCodaView(() => setNowPlayingOpen(true), "now-playing");
    }
  }, [currentTrack]);
  const backFromNowPlaying = useCallback(() => {
    const restoreFocus = () => {
      document.querySelector<HTMLButtonElement>(".player__art-link")?.focus({
        preventScroll: true,
      });
    };
    void transitionCodaView(() => setNowPlayingOpen(false), "now-playing").then(() => {
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(restoreFocus);
      } else {
        setTimeout(restoreFocus, 0);
      }
    });
  }, []);
  const playSelectedAlbum = useCallback(() => {
    if (selectedAlbum) void playAlbum(selectedAlbum);
  }, [playAlbum, selectedAlbum]);
  const queueSelectedAlbum = useCallback(() => {
    if (selectedAlbum) void queueAlbum(selectedAlbum);
  }, [queueAlbum, selectedAlbum]);
  const queueTrack = useCallback((track: Track) => {
    setQueue((items) => appendUnique(items, [track]));
    notify(`${track.title} added to queue`, "good");
  }, [notify]);
  const handleConnected = useCallback((library: Album[]) => {
    bandcampSessionGenerationRef.current += 1;
    librarySyncGenerationRef.current += 1;
    setAlbums(library);
    setConnected(true);
    setPlayerStateReady(true);
    setLibraryError("");
    setSyncState("idle");
    notify(`${countLabel(library.length, "album")} synced`, "good");
  }, [notify]);
  const chooseView = useCallback((nextView: LibraryView) => {
    if (
      nextView === view &&
      !selectedAlbum &&
      !selectedArtist &&
      !nowPlayingOpen
    ) {
      return;
    }
    void transitionCodaView(() => {
      setNowPlayingOpen(false);
      setView(nextView);
      setSelectedAlbum(undefined);
      if (nextView === "radio") {
        setRadioSeriesId(undefined);
        setRadioRequestedShowId(undefined);
      }
      if (nextView !== "library") {
        setBrowseMode("releases");
        setSelectedArtist(undefined);
      }
    }, "page-crossfade");
  }, [nowPlayingOpen, selectedAlbum, selectedArtist, view]);
  const chooseBrowseMode = useCallback((mode: LibraryBrowseMode) => {
    setNowPlayingOpen(false);
    setBrowseMode(mode);
    setSelectedArtist(undefined);
    setSelectedAlbum(undefined);
  }, []);
  const openArtist = useCallback((group: ArtistGroup) => {
    void transitionCodaView(() => setSelectedArtist(group.key), "page-forward");
  }, []);
  const backToArtists = useCallback(() => {
    void transitionCodaView(() => setSelectedArtist(undefined), "page-back");
  }, []);
  const browseArtist = useCallback((artist: string) => {
    void transitionCodaView(() => {
      setNowPlayingOpen(false);
      if (artist === "Bandcamp Radio") {
        setView("radio");
        setRadioSeriesId(undefined);
        setRadioRequestedShowId(undefined);
        setSelectedAlbum(undefined);
        setSelectedArtist(undefined);
        return;
      }
      setView("library");
      setBrowseMode("artists");
      setSelectedArtist(artistKey(artist));
      setQuery("");
      setGenre("All");
      setSelectedAlbum(undefined);
    }, "page-forward");
  }, []);
  const browseRadioSeries = useCallback((seriesId?: number) => {
    void transitionCodaView(() => {
      setRadioSeriesId(seriesId);
      setRadioRequestedShowId(undefined);
      setNowPlayingOpen(false);
      setView("radio");
      setSelectedAlbum(undefined);
      setSelectedArtist(undefined);
    }, "page-forward");
  }, []);
  const openRadioShow = useCallback((show: RadioShowSummary) => {
    void transitionCodaView(() => {
      setRadioSeriesId(show.series?.id);
      setRadioRequestedShowId(show.id);
      setNowPlayingOpen(false);
      setView("radio");
      setSelectedAlbum(undefined);
      setSelectedArtist(undefined);
    }, "page-forward");
  }, []);
  const getRadioChapterLocalLinks = useCallback(
    (chapter: RadioChapter): RadioChapterLocalLinks => {
      const targets = resolveRadioChapterLibraryTargets(chapter, albums);
      const openLocalAlbum = targets.album
        ? () => {
            setNowPlayingOpen(false);
            setView("library");
            setSelectedArtist(undefined);
            void openAlbum(targets.album!);
          }
        : undefined;

      return {
        track: openLocalAlbum,
        album: openLocalAlbum,
        artist: targets.artist
          ? () => browseArtist(targets.artist!)
          : undefined,
      };
    },
    [albums, browseArtist, openAlbum],
  );
  const clearLibraryFilters = useCallback(() => {
    setQuery("");
    setGenre("All");
    setBrowseMode("releases");
    setSelectedArtist(undefined);
  }, []);
  const playArtist = useCallback((group: ArtistGroup) => {
    void loadArtistTracks(group, "play");
  }, [loadArtistTracks]);
  const shuffleArtist = useCallback((group: ArtistGroup) => {
    void loadArtistTracks(group, "shuffle");
  }, [loadArtistTracks]);
  const queueArtist = useCallback((group: ArtistGroup) => {
    void loadArtistTracks(group, "queue");
  }, [loadArtistTracks]);

  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("coda://tray-control", ({ payload }) => {
          if (payload === "play-pause") togglePlayback();
          if (payload === "previous") previous();
          if (payload === "next") next();
          if (payload === "shuffle-library") void shuffleLibrary();
        }),
      )
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch(() => {
        // Tray controls are optional; in-window playback remains available.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [next, previous, shuffleLibrary, togglePlayback]);
  const isInitialLoading =
    syncState === "checking" ||
    (connected && syncState === "syncing" && !albums.length && !libraryError);
  const hasActiveFilters =
    Boolean(query.trim()) ||
    genre !== "All" ||
    browseMode !== "releases" ||
    Boolean(selectedArtist);
  const browseTitle =
    effectiveBrowseMode === "singles"
      ? "Singles"
      : effectiveBrowseMode === "albums"
        ? "Albums & EPs"
        : "All releases";
  const releaseSectionTitle = activeArtist
    ? "Releases"
    : genre === "All"
      ? browseTitle
      : `${browseTitle} · ${genre}`;
  const shuffleScopeAlbums = selectedAlbum ? [selectedAlbum] : visibleAlbums;
  const shuffleActionLabel = selectedAlbum
    ? "Shuffle album"
    : activeArtist
      ? "Shuffle artist"
      : query.trim()
        ? "Shuffle results"
        : genre !== "All"
          ? "Shuffle genre"
          : view === "recent"
            ? "Shuffle recent"
            : effectiveBrowseMode === "singles"
              ? "Shuffle singles"
              : effectiveBrowseMode === "albums"
                ? "Shuffle albums"
                : effectiveBrowseMode === "artists"
                  ? "Shuffle artists"
                  : "Shuffle collection";
  const shuffleScopeName = selectedAlbum
    ? selectedAlbum.title
    : activeArtist
      ? activeArtist.name
      : query.trim()
        ? "the current results"
        : genre !== "All"
          ? genre
          : view === "recent"
            ? "recent additions"
            : effectiveBrowseMode === "singles"
              ? "the singles view"
              : effectiveBrowseMode === "albums"
                ? "the albums view"
                : effectiveBrowseMode === "artists"
                  ? "the visible artists"
                  : "the collection";
  const shuffleVisible = useCallback(() => {
    void shuffleLibrary(shuffleScopeAlbums, shuffleScopeName);
  }, [shuffleLibrary, shuffleScopeAlbums, shuffleScopeName]);
  const playRandomVisible = useCallback(() => {
    void playRandomTrack(shuffleScopeAlbums, shuffleScopeName);
  }, [playRandomTrack, shuffleScopeAlbums, shuffleScopeName]);
  const playQueueRecommendation = useCallback(() => {
    if (!queueRecommendation) return;
    void playRandomTrack(
      [queueRecommendation.album],
      queueRecommendation.album.title,
    );
  }, [playRandomTrack, queueRecommendation]);
  const showAnotherQueueRecommendation = useCallback(() => {
    setQueueRecommendationNonce((nonce) => nonce + 1);
  }, []);

  return (
    <div className={`app-shell ${nowPlayingOpen ? "app-shell--now-playing" : ""}`}>
      <div className={`app-body ${queueOpen ? "" : "app-body--queue-closed"}`}>
        <Sidebar
          view={view}
          onView={chooseView}
          connected={connected}
          onConnect={openConnection}
        />
        <main className="library-pane" ref={libraryPaneRef}>
          {nowPlayingOpen && currentTrack ? (
            <NowPlayingView
              track={currentTrack}
              queue={queue}
              currentIndex={currentIndex}
              playing={playing}
              playbackClock={playbackClock}
              radioTimeline={currentRadioTimeline}
              duration={currentTrack.duration}
              volume={volume}
              repeat={repeat}
              artwork={(
                <ClockedNowPlayingArtwork
                  playbackClock={playbackClock}
                  track={currentTrack}
                  radioTimeline={currentRadioTimeline}
                />
              )}
              airPlayAvailable={airPlayAvailable}
              queueOpen={queueOpen}
              onBack={backFromNowPlaying}
              onToggle={togglePlayback}
              onPrevious={previous}
              onNext={next}
              canPrevious={canPrevious}
              canNext={canNext}
              onSeek={seek}
              onVolume={setVolume}
              onRepeat={cycleRepeat}
              onAirPlay={openAirPlay}
              onToggleQueue={toggleQueue}
              onArtist={browseArtist}
              onAlbum={openTrackAlbum}
              onPlayQueueIndex={playQueueIndex}
              onRadioSeries={browseRadioSeries}
              recommendation={queueRecommendation}
              recommendationArtwork={
                queueRecommendation ? (
                  <CoverArt
                    album={queueRecommendation.album}
                    size="small"
                  />
                ) : undefined
              }
              recommendationLoading={randomPickLoading}
              onPlayRecommendation={playQueueRecommendation}
              onAnotherRecommendation={showAnotherQueueRecommendation}
              getRadioChapterLocalLinks={getRadioChapterLocalLinks}
              favorite={
                currentRadioShowId !== undefined
                  ? favoriteRadioShowIds.has(currentRadioShowId)
                  : favoriteTrackIds.has(currentTrack.id)
              }
              onToggleFavorite={toggleCurrentFavorite}
              onAddToPlaylist={
                currentRadioShowId === undefined
                  ? () => setPlaylistTarget([currentTrack])
                  : undefined
              }
            />
          ) : view === "favorites" || view === "playlists" ? (
            <Suspense fallback={<LibrarySkeleton />}>
              <SavedLibraryView
                mode={view}
                connected={connected}
                favorites={localFavorites}
                favoritesLoading={false}
                favoritesLocal
                onRefreshFavorites={() => setLocalFavorites(readLocalFavorites())}
                onToggleFavorite={(id, kind, favorite) => toggleFavorite(id, kind, favorite)}
                onToggleRadioFavorite={(show, favorite) =>
                  toggleRadioFavorite(show, favorite)}
                currentTrackId={currentTrack?.id}
                playing={playing}
                onTogglePlayback={togglePlayback}
                onPlayTracks={playTracks}
                onQueueTracks={queueTracks}
                onPlayTrack={playTrack}
                onQueueTrack={queueTrack}
                onOpenAlbum={(album) => {
                  setView("library");
                  void openAlbum(album);
                }}
                onOpenTrackAlbum={openTrackAlbum}
                onOpenArtist={browseArtist}
                onOpenRadioShow={openRadioShow}
                onOpenRadioSeries={browseRadioSeries}
                onAddToPlaylist={setPlaylistTarget}
                onNotify={notify}
              />
            </Suspense>
          ) : view === "discover" ? (
            <Suspense fallback={<LibrarySkeleton />}>
              <DiscoverView
                onPlay={playTrack}
                onQueue={queueTrack}
                currentTrackId={currentTrack?.id}
                playing={playing}
                onTogglePlayback={togglePlayback}
              />
            </Suspense>
          ) : view === "radio" ? (
            <Suspense fallback={<LibrarySkeleton />}>
              <RadioView
                onPlay={playTrack}
                onPlayAt={playTrackAt}
                onQueue={queueTrack}
                currentTrackId={currentTrack?.id}
                playbackClock={playbackClock}
                playing={playing}
                onTogglePlayback={togglePlayback}
                favoriteShowIds={favoriteRadioShowIds}
                onToggleFavorite={toggleRadioFavorite}
                selectedSeriesId={radioSeriesId}
                onSelectSeries={setRadioSeriesId}
                requestedShowId={radioRequestedShowId}
                onRequestedShowChange={setRadioRequestedShowId}
              />
            </Suspense>
          ) : (
            <>
          <header className="library-header">
            <div>
              <span className="eyebrow">{connected ? "Your Bandcamp" : "Your music"}</span>
              <h1>{view === "library" ? "Collection" : "Recently added"}</h1>
              <p>
                {syncState === "checking"
                  ? "Checking your saved connection…"
                  : connected
                    ? `${countLabel(albums.length, "release")}, ready when you are.`
                    : "Connect your Bandcamp library to start listening."}
              </p>
            </div>
            <div className="library-header__actions">
              {connected ? (
                <label className="search-box">
                  <Search size={17} />
                  <span className="sr-only">Search collection</span>
                  <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your collection" />
                  <kbd>/</kbd>
                </label>
              ) : null}
              {connected && shuffleScopeAlbums.length ? (
                <button
                  className="artwork-button"
                  onClick={playRandomVisible}
                  disabled={randomPickLoading || Boolean(libraryShuffleProgress) || syncState === "syncing"}
                  title={`Play one random track from ${shuffleScopeName}`}
                  aria-label={`Play a random track from ${shuffleScopeName}`}
                >
                  {randomPickLoading ? <RefreshCw size={15} className="spin" /> : <Dices size={15} />}
                  {randomPickLoading ? "Picking…" : "Surprise me"}
                </button>
              ) : null}
              {connected && shuffleScopeAlbums.length ? (
                <button
                  className="artwork-button"
                  onClick={shuffleVisible}
                  disabled={Boolean(libraryShuffleProgress) || randomPickLoading || syncState === "syncing"}
                  title={`${shuffleActionLabel} and start playing`}
                >
                  {libraryShuffleProgress ? <RefreshCw size={15} className="spin" /> : <Shuffle size={15} />}
                  {libraryShuffleProgress
                    ? `${libraryShuffleProgress.done}/${libraryShuffleProgress.total}`
                    : shuffleActionLabel}
                </button>
              ) : null}
              {connected ? (
                <button
                  className="artwork-button"
                  onClick={() => void refreshArtwork()}
                  disabled={artworkRefreshing || syncState === "syncing"}
                  title="Retry artwork and recover missing covers"
                >
                  {artworkRefreshing ? <RefreshCw size={15} className="spin" /> : <Images size={15} />}
                  {artworkRefreshing ? "Refreshing…" : "Artwork"}
                </button>
              ) : null}
              <button
                className="sync-button"
                onClick={connected ? () => void syncLibrary() : openConnection}
                disabled={syncState === "checking" || syncState === "syncing"}
              >
                {syncState === "checking" || syncState === "syncing" ? <RefreshCw size={16} className="spin" /> : connected ? <RefreshCw size={16} /> : <Radio size={16} />}
                {syncState === "checking"
                  ? "Checking…"
                  : syncState === "syncing"
                    ? "Syncing…"
                    : connected
                      ? "Sync"
                      : "Connect"}
              </button>
            </div>
          </header>

          {connected &&
          (syncState === "error" || syncState === "syncing") &&
          Boolean(libraryError) &&
          albums.length ? (
            <section className="sync-notice" role="status">
              <div className="sync-notice__icon"><CircleAlert size={18} /></div>
              <div>
                <strong>Showing your saved collection</strong>
                <span>{libraryError || "Bandcamp could not be reached. Your cached library is still available."}</span>
              </div>
              <button
                onClick={() => void syncLibrary()}
                disabled={syncState === "syncing"}
              >
                {syncState === "syncing"
                  ? <RefreshCw className="spin" size={16} />
                  : <ChevronRight size={16} />}
                {syncState === "syncing" ? "Syncing…" : "Try again"}
              </button>
            </section>
          ) : null}

          {connected && albums.length && view === "library" && !selectedAlbum ? (
            <nav className="browse-tabs" aria-label="Browse collection">
              {LIBRARY_BROWSE_OPTIONS.map(({ mode, label, title }) => {
                const count =
                  mode === "releases"
                    ? albums.length
                    : mode === "artists"
                      ? libraryBrowseCounts.artists
                      : libraryBrowseCounts[mode];
                return (
                  <button
                    key={mode}
                    className={browseMode === mode ? "active" : ""}
                    onClick={() => chooseBrowseMode(mode)}
                    aria-pressed={browseMode === mode}
                    title={title}
                  >
                    {label}
                    <span>{count}</span>
                  </button>
                );
              })}
            </nav>
          ) : null}

          {connected && albums.length && !selectedAlbum ? (
            <section className="filter-row">
              <div className="genre-filter">
                <div className="genre-tabs">
                  {["All", ...visibleGenreTabs].map((item) => (
                    <button
                      key={item}
                      className={genreKey(genre) === genreKey(item) ? "active" : ""}
                      onClick={() => setGenre(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                {overflowGenres.length ? (
                  <label className="genre-picker">
                    <Music2 size={14} />
                    <span className="sr-only">More collection genres</span>
                    <select
                      value=""
                      aria-label="More collection genres"
                      onChange={(event) => setGenre(event.target.value)}
                    >
                      <option value="" disabled>More genres</option>
                      {overflowGenres.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </select>
                    <ChevronDown size={13} />
                  </label>
                ) : null}
              </div>
              {effectiveBrowseMode === "artists" && !selectedArtist ? (
                <span className="artist-sort-note"><ArrowDownUp size={14} /> Artist A–Z</span>
              ) : (
                <label className="sort-control">
                  <ArrowDownUp size={15} />
                  <span className="sr-only">Sort collection</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
                    <option value="recent">Recently added</option>
                    <option value="artist">Artist A–Z</option>
                    <option value="title">Album A–Z</option>
                    <option value="year">Release year</option>
                  </select>
                  <ChevronDown size={14} />
                </label>
              )}
            </section>
          ) : null}

          <section className="album-section" aria-live="polite">
            {selectedAlbum ? (
              <AlbumDetailPage
                album={selectedAlbum}
                loading={albumLoading}
                onBack={closeAlbum}
                onPlayAlbum={playSelectedAlbum}
                onQueueAlbum={queueSelectedAlbum}
                onPlayTrack={playTrack}
                onQueueTrack={queueTrack}
                onArtist={browseArtist}
                favoriteAlbum={favoriteAlbumIds.has(selectedAlbum.id)}
                favoriteTrackIds={favoriteTrackIds}
                onToggleFavoriteAlbum={() => toggleFavorite(selectedAlbum.id, "album")}
                onToggleFavoriteTrack={(track) => toggleFavorite(track.id, "song")}
                onAddToPlaylist={setPlaylistTarget}
                currentTrackId={currentTrack?.id}
                currentAlbumId={currentTrack?.albumId}
                playing={playing}
                onTogglePlayback={togglePlayback}
              />
            ) : isInitialLoading ? (
              <LibrarySkeleton />
            ) : !connected ? (
              <EmptyState
                icon={<Radio size={28} />}
                title="Your collection starts here"
                detail="Connect the separate Subsonic credentials from your Bandcamp fan settings. Your password stays in the system vault."
                action={<button onClick={openConnection}>Connect Bandcamp <ChevronRight size={15} /></button>}
              />
            ) : (syncState === "error" || syncState === "syncing") &&
              Boolean(libraryError) &&
              !albums.length ? (
              <EmptyState
                icon={<CircleAlert size={28} />}
                title="Your collection couldn’t load"
                detail={libraryError || "Bandcamp could not be reached. Check your connection and try again."}
                action={(
                  <button
                    onClick={() => void syncLibrary()}
                    disabled={syncState === "syncing"}
                  >
                    <RefreshCw
                      className={syncState === "syncing" ? "spin" : ""}
                      size={14}
                    />
                    {syncState === "syncing" ? "Syncing…" : "Try syncing again"}
                  </button>
                )}
              />
            ) : !albums.length ? (
              <EmptyState
                icon={<Library size={28} />}
                title="No releases found"
                detail="Bandcamp connected successfully, but its Subsonic library returned no purchases yet."
                action={(
                  <button
                    onClick={() => void syncLibrary()}
                    disabled={syncState === "syncing"}
                  >
                    <RefreshCw
                      className={syncState === "syncing" ? "spin" : ""}
                      size={14}
                    />
                    {syncState === "syncing" ? "Checking…" : "Check again"}
                  </button>
                )}
              />
            ) : effectiveBrowseMode === "artists" && !selectedArtist ? (
              <>
                <div className="section-heading">
                  <h2>{genre === "All" ? "Artists" : `${genre} artists`}</h2>
                  <span>
                    {countLabel(artistGroups.length, "artist")}
                  </span>
                </div>
                {artistGroups.length ? (
                  <Suspense fallback={<LibrarySkeleton />}>
                    <ArtistVirtualGrid
                      items={artistGroups}
                      renderItem={(group) => (
                        <ArtistCard group={group} onOpen={openArtist} />
                      )}
                      scrollElementRef={libraryPaneRef}
                    />
                  </Suspense>
                ) : (
                  <EmptyState
                    icon={<UsersRound size={28} />}
                    title="No artists match those filters"
                    detail="Try another artist name, release title, or genre."
                    action={hasActiveFilters ? (
                      <button onClick={clearLibraryFilters}>Clear filters</button>
                    ) : undefined}
                  />
                )}
              </>
            ) : (
              <>
                {activeArtist ? (
                  <ArtistHero
                    group={activeArtist}
                    loading={artistAction}
                    onBack={backToArtists}
                    onPlay={playArtist}
                    onShuffle={shuffleArtist}
                    onQueue={queueArtist}
                    active={activeArtist.albums.some((album) => album.id === currentTrack?.albumId)}
                    playing={playing}
                    onTogglePlayback={togglePlayback}
                  />
                ) : null}
                <div className="section-heading">
                  <h2>{releaseSectionTitle}</h2>
                  <div className="section-heading__actions">
                    <span>{countLabel(visibleAlbums.length, "release")}</span>
                    {deferredQuery && visibleAlbums.length ? (
                      <button
                        className="queue-results-button"
                        onClick={() => void queueSearchResults()}
                        disabled={Boolean(queueSearchProgress)}
                      >
                        {queueSearchProgress ? (
                          <><RefreshCw className="spin" size={14} /> Adding {queueSearchProgress.done}/{queueSearchProgress.total}</>
                        ) : (
                          <><ListPlus size={15} /> Add results to queue</>
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
                {visibleAlbums.length ? (
                  <Suspense fallback={<LibrarySkeleton />}>
                    <AlbumVirtualGrid
                      ariaLabel={releaseSectionTitle}
                      items={visibleAlbums}
                      renderItem={(album) => (
                        <AlbumCard
                          album={album}
                          onOpen={openAlbum}
                          onPlay={playAlbum}
                          onQueue={queueAlbum}
                          onArtist={browseArtist}
                          active={currentTrack?.albumId === album.id}
                          playing={playing}
                          onTogglePlayback={togglePlayback}
                        />
                      )}
                      scrollElementRef={libraryPaneRef}
                    />
                  </Suspense>
                ) : (
                  <EmptyState
                    icon={<Search size={28} />}
                    title="Nothing matches those filters"
                    detail={
                      effectiveBrowseMode === "singles"
                        ? "No one-track purchases match. Try another artist, title, or genre."
                        : effectiveBrowseMode === "albums"
                          ? "No multi-track purchases match. Try another artist, title, or genre."
                          : "Try a different artist, release title, or genre."
                    }
                    action={hasActiveFilters ? (
                      <button onClick={clearLibraryFilters}>Clear filters</button>
                    ) : undefined}
                  />
                )}
              </>
            )}
          </section>
            </>
          )}
        </main>
        {queuePresent ? (
          <QueuePanel
            open={queueOpen}
            panelRef={queuePanelRef}
            queue={queue}
            currentIndex={currentIndex}
            currentTrack={currentTrack}
            radioTimeline={currentRadioTimeline}
            playbackClock={playbackClock}
            playing={playing}
            onPlay={playQueueIndex}
            onRemove={removeQueueItem}
            onClear={clearQueue}
            onShuffle={shuffleQueue}
            onMove={moveQueueItem}
            onArtist={browseArtist}
            onAlbum={openTrackAlbum}
            onNowPlaying={openNowPlaying}
            onOpenRadioItem={openRadioItem}
            getRadioChapterLocalLinks={getRadioChapterLocalLinks}
            onSeek={seek}
            recommendation={queueRecommendation}
            recommendationLoading={randomPickLoading}
            onPlayRecommendation={playQueueRecommendation}
            onAnotherRecommendation={showAnotherQueueRecommendation}
          />
        ) : null}
      </div>
      {nowPlayingOpen && currentTrack ? null : (
        <Player
          track={currentTrack}
          radioTimeline={currentRadioTimeline}
          playing={playing}
          playbackClock={playbackClock}
          duration={currentTrack?.duration ?? 0}
          volume={volume}
          repeat={repeat}
          onToggle={togglePlayback}
          onPrevious={previous}
          onNext={next}
          canPrevious={canPrevious}
          canNext={canNext}
          onSeek={seek}
          onVolume={setVolume}
          onRepeat={cycleRepeat}
          airPlayAvailable={airPlayAvailable}
          onAirPlay={openAirPlay}
          onArtist={browseArtist}
          onAlbum={openTrackAlbum}
          onNowPlaying={openNowPlaying}
          onOpenRadioItem={openRadioItem}
          getRadioChapterLocalLinks={getRadioChapterLocalLinks}
          favorite={currentTrack
            ? currentRadioShowId !== undefined
              ? favoriteRadioShowIds.has(currentRadioShowId)
              : favoriteTrackIds.has(currentTrack.id)
            : false}
          onToggleFavorite={toggleCurrentFavorite}
          onAddToPlaylist={() => {
            if (currentTrack) setPlaylistTarget([currentTrack]);
          }}
          queueOpen={queueOpen}
          onToggleQueue={toggleQueue}
        />
      )}
      <audio
        ref={audioRef}
        src={streamUrl}
        preload="metadata"
        onPlaying={handleAudioPlaying}
        onSeeking={handleAudioSeeking}
        onLoadedMetadata={handleAudioLoadedMetadata}
        onTimeUpdate={handleAudioTimeUpdate}
        onDurationChange={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) {
            playbackClock.updateFromMedia(event.currentTarget.currentTime);
          }
        }}
        onEnded={handleAudioEnded}
      />
      <WindowTitleController
        playbackClock={playbackClock}
        currentTrack={currentTrack}
        radioTimeline={currentRadioTimeline}
        nowPlayingOpen={nowPlayingOpen}
        selectedAlbumTitle={selectedAlbum?.title}
        activeArtistName={activeArtist?.name}
        view={view}
      />
      {connectionOpen ? (
        <ConnectionDialog
          connected={connected}
          lastFmStatus={lastFmStatus}
          onClose={closeConnection}
          onConnected={handleConnected}
          onDisconnected={handleDisconnect}
          onLastFmStatus={setLastFmStatus}
        />
      ) : null}
      {playlistTarget?.length ? (
        <Suspense fallback={null}>
          <AddToPlaylistDialog
            tracks={playlistTarget}
            onClose={() => setPlaylistTarget(undefined)}
            onNotify={notify}
          />
        </Suspense>
      ) : null}
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.tone ?? "neutral"}`}>{toast.tone === "good" ? <Check size={16} /> : toast.tone === "bad" ? <X size={16} /> : null}{toast.message}</div>)}
      </div>
    </div>
  );
}
