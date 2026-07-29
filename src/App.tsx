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
import {
  AppUpdatePrompt,
  AppUpdateSettings,
  type AppUpdaterController,
  useAppUpdater,
} from "./AppUpdater";
import { AppSidebar, type AppSidebarView } from "./AppSidebar";
import { Alert } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./components/ui/drawer";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "./components/ui/native-select";
import { Separator } from "./components/ui/separator";
import { Skeleton } from "./components/ui/skeleton";
import { Slider } from "./components/ui/slider";
import { Spinner } from "./components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
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
  cachedAlbumTracks,
  clearBandcampQueryData,
  ensureAlbumQueryData,
  hydrateLibraryQuery,
  libraryQueryKey,
  libraryStateQueryOptions,
  mergeLibraryProgress,
  prefetchAlbumQueryData,
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
import {
  installMediaSessionTrackHandlers,
  showAirPlayPicker,
  supportsAirPlayPicker,
  syncMediaSessionPlayback,
} from "./media";
import { MiniPlayerBridge } from "./MiniPlayerBridge";
import { NowPlayingView } from "./NowPlayingView";
import { createSystemArtworkDataUrl } from "./systemArtwork";
import {
  RadioChapterCopy,
  type RadioChapterLocalLinks,
} from "./RadioChapterMetadata";
import { isEphemeralTrackId } from "./playerState";
import {
  createPlaybackClock,
  type PlaybackClock,
} from "./playbackClock";
import {
  activateTrack,
  appendUnique,
  keepCurrentTrack,
  moveItem,
  shuffled,
} from "./queue";
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
type LibraryView = AppSidebarView;
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
const PLAYER_STATE_SAVE_DEBOUNCE_MS = 450;
const PLAYER_STATE_CHECKPOINT_MS = 5_000;
const PREVIOUS_RESTART_THRESHOLD_SECONDS = 4;
const ALBUM_PREFETCH_DELAY_MS = 120;
const CODA_APP_NAME = import.meta.env.VITE_CODA_APP_NAME?.trim() || "Coda";
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

  const sizeClassName = size === "card"
    ? "aspect-square w-full rounded-md shadow-[0_10px_24px_rgba(0,0,0,0.24)]"
    : size === "small"
      ? "size-10 rounded-sm"
      : "size-52 rounded-md shadow-[0_20px_42px_rgba(0,0,0,0.35)]";

  return (
    <div
      data-slot="cover"
      data-cover-size={size}
      className={`relative isolate shrink-0 overflow-hidden bg-(--cover-base) text-[#f7f3e8] ${sizeClassName} ${
        animateChanges ? "[&>img]:animate-[cover-artwork-in_180ms_ease-out]" : ""
      }`}
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
          className="block size-full object-cover"
        />
      ) : (
        <>
          <span className="absolute top-[12%] left-[9%] h-1 w-[31%] bg-(--cover-accent)" />
          <span
            className={`absolute left-[9%] font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] leading-none font-semibold tracking-[-0.08em] ${
              size === "small"
                ? "top-[22%] text-xs"
                : "top-[24%] text-[clamp(18px,4vw,38px)]"
            }`}
          >
            {initials(album.title)}
          </span>
          {size === "small" ? null : (
            <span className="absolute right-[8%] bottom-[8%] left-[9%] truncate text-left text-[clamp(6px,0.75vw,9px)] font-bold tracking-widest uppercase">
              {album.artist}
            </span>
          )}
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
  const windowTitle = subject
    ? `${subject} — ${CODA_APP_NAME}`
    : CODA_APP_NAME;

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
  onPrefetch,
  onPlay,
  onQueue,
  onArtist,
  active,
  loading,
  playing,
  onTogglePlayback,
}: {
  album: Album;
  onOpen: (album: Album) => void;
  onPrefetch: (album: Album) => void;
  onPlay: (album: Album) => void;
  onQueue: (album: Album) => void;
  onArtist: (artist: string) => void;
  active: boolean;
  loading: boolean;
  playing: boolean;
  onTogglePlayback: () => void;
}) {
  const prefetchTimerRef = useRef<number | undefined>(undefined);
  const cancelScheduledPrefetch = () => {
    if (prefetchTimerRef.current === undefined) return;
    window.clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = undefined;
  };
  const schedulePrefetch = () => {
    if (prefetchTimerRef.current !== undefined) return;
    prefetchTimerRef.current = window.setTimeout(() => {
      prefetchTimerRef.current = undefined;
      onPrefetch(album);
    }, ALBUM_PREFETCH_DELAY_MS);
  };

  useEffect(() => cancelScheduledPrefetch, [album.id, onPrefetch]);

  return (
    <article
      className="group relative min-w-0 [contain-intrinsic-size:170px_235px] [content-visibility:auto]"
      onPointerEnter={schedulePrefetch}
      onPointerLeave={cancelScheduledPrefetch}
      onFocusCapture={() => {
        cancelScheduledPrefetch();
        onPrefetch(album);
      }}
    >
      <div className="relative block w-full">
        <CoverArt album={album} />
        <Button
          className="absolute inset-0 z-1 h-auto w-full cursor-pointer rounded-md border-0 bg-transparent p-0 after:absolute after:inset-0 after:rounded-md after:bg-[rgba(8,9,10,0.2)] after:opacity-0 after:transition-opacity after:duration-(--duration-coda-fast) hover:bg-transparent hover:after:opacity-100"
          onClick={() => onOpen(album)}
          aria-label={`Open ${album.title}`}
          aria-busy={loading || undefined}
          disabled={loading}
          size="compact"
          variant="text"
        />
        {loading ? (
          <span className="pointer-events-none absolute inset-0 z-3 grid place-items-center rounded-md bg-black/40">
            <Spinner
              aria-label={`Loading ${album.title}`}
              className="size-6 text-white"
            />
          </span>
        ) : null}
        <span
          className="absolute right-2 bottom-2 z-2 translate-y-1 opacity-0 transition-[opacity,transform] duration-(--duration-coda-fast) group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 data-current:translate-y-0 data-current:opacity-100"
          data-current={active || undefined}
        >
          <Button
            className={`size-10 rounded-full p-0 text-white shadow-[0_5px_15px_rgba(0,0,0,0.35)] ${
              active && playing
                ? "bg-[color-mix(in_srgb,var(--primary)_80%,#17191b)] shadow-[0_5px_15px_rgba(0,0,0,0.35),0_0_0_3px_rgba(221,101,73,0.16)]"
                : ""
            }`}
            onClick={active ? onTogglePlayback : () => onPlay(album)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${album.title}`
                : `Play ${album.title}`
            }
            aria-pressed={active && playing}
            size="icon"
            title={active ? (playing ? "Pause album" : "Resume album") : "Play album"}
            variant="primary"
          >
            {active && playing
              ? <Pause size={19} fill="currentColor" />
              : <Play size={19} fill="currentColor" />}
          </Button>
        </span>
      </div>
      <div className="flex min-w-0 flex-col pt-2.5 pr-6">
        <Button
          className="h-auto w-full min-w-0 justify-start truncate p-0 text-left text-xs font-bold text-[#e5e3dd] hover:bg-transparent hover:text-[#e5e3dd]"
          onClick={() => onOpen(album)}
          aria-busy={loading || undefined}
          disabled={loading}
          size="compact"
          variant="text"
        >
          {album.title}
        </Button>
        <Button
          className="mt-1 h-auto w-full min-w-0 justify-start truncate p-0 text-left text-xs font-medium text-[#868984] hover:bg-transparent hover:text-[#dc8973] hover:underline hover:underline-offset-2"
          onClick={() => onArtist(album.artist)}
          size="compact"
          title={`Browse ${album.artist}`}
          variant="text"
        >
          {album.artist}
        </Button>
      </div>
      <Button
        className="absolute -right-1 -bottom-1 size-7 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={() => onQueue(album)}
        size="icon-compact"
        title="Add album to queue"
        aria-label={`Add ${album.title} to queue`}
        variant="ghost"
      >
        <Plus size={17} />
      </Button>
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
    <Button
      className="group grid h-auto w-full min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-[#171a1c] p-2 text-left text-inherit [contain-intrinsic-size:62px] [content-visibility:auto] hover:border-(--line-strong) hover:bg-popover"
      onClick={() => onOpen(group)}
      aria-label={`Browse ${group.name}`}
      variant="secondary"
    >
      <CoverArt album={group.representative} size="small" />
      <span className="flex min-w-0 flex-col gap-1">
        <strong className="truncate text-xs font-bold text-[#e8e6df]">{group.name}</strong>
        <span className="truncate text-xs font-normal text-[#777b76]">
          {countLabel(group.releaseCount, "release")}
          {" · "}
          {countLabel(group.trackCount, "track")}
        </span>
      </span>
      <ChevronRight className="text-[#686c67] group-hover:text-[#d88974]" size={17} />
    </Button>
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
    <section className="relative -mt-2 mb-6 grid grid-cols-[7.5rem_minmax(0,1fr)] items-end gap-4 overflow-hidden rounded-lg border border-border bg-[radial-gradient(circle_at_88%_20%,rgba(221,101,73,0.13),transparent_38%),linear-gradient(135deg,#202426,#171a1c_72%)] p-4 *:data-[slot=cover]:size-30 *:data-[slot=cover]:rounded-lg xl:grid-cols-[9.5rem_minmax(0,1fr)] xl:gap-6 xl:p-5 xl:*:data-[slot=cover]:size-38">
      <CoverArt album={group.representative} size="large" />
      <div className="relative z-1 min-w-0">
        <Button className="mb-3 -ml-1 h-auto gap-1 p-1 text-xs text-[#8b8f89] hover:bg-transparent hover:text-[#f0eee8] xl:mb-4" onClick={onBack} size="compact" variant="text">
          <ArrowLeft size={14} />
          All artists
        </Button>
        <span className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">Artist</span>
        <h2 className="mt-1 mb-2 truncate font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-2xl leading-none font-semibold tracking-tighter text-[#f2f0e9] xl:text-3xl">{group.name}</h2>
        <p className="m-0 text-xs text-[#858983]">
          {countLabel(group.releaseCount, "release")}
          {" · "}
          {countLabel(group.trackCount, "track")}
          {" · "}
          {formatTime(group.duration)}
        </p>
        <div className="mt-3.5 flex gap-2 xl:mt-5">
          <Button
            className={`${active ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_8px_24px_rgba(221,101,73,0.16)]" : ""} ${active && playing ? "bg-[color-mix(in_srgb,var(--primary)_82%,#17191b)]" : ""}`}
            onClick={active ? onTogglePlayback : () => onPlay(group)}
            disabled={Boolean(loading)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${group.name}`
                : "Play all"
            }
            aria-pressed={active && playing}
            variant="primary"
          >
            {loading === "play"
              ? <Spinner aria-hidden="true" className="size-4 text-current" />
              : active && playing
                ? <Pause size={16} fill="currentColor" />
                : <Play size={16} fill="currentColor" />}
            {loading === "play"
              ? "Loading…"
              : active
                ? (playing ? "Pause" : "Resume")
                : "Play all"}
          </Button>
          <Button
            onClick={() => onShuffle(group)}
            disabled={Boolean(loading)}
          >
            {loading === "shuffle" ? <Spinner aria-hidden="true" className="size-4" /> : <Shuffle size={16} />}
            {loading === "shuffle" ? "Shuffling…" : "Shuffle"}
          </Button>
          <Button
            onClick={() => onQueue(group)}
            disabled={Boolean(loading)}
          >
            {loading === "queue" ? <Spinner aria-hidden="true" className="size-4" /> : <ListPlus size={16} />}
            {loading === "queue" ? "Adding…" : "Add all"}
          </Button>
        </div>
      </div>
    </section>
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
    <section className="mt-3 border-t border-white/[0.07] pt-2.5" aria-label="Show chapters">
      <header className="flex items-center justify-between px-1 pb-2 text-xs font-bold tracking-widest text-[#8d918b] uppercase">
        <span>Show chapters</span>
        <span className="text-[#686d68] tabular-nums">{chapters.length}</span>
      </header>
      <ol className="m-0 max-h-[min(16rem,30vh)] list-none overflow-x-hidden overflow-y-auto px-0.5 pb-0.5 overscroll-contain [scrollbar-color:#3b3e3f_transparent] scrollbar-thin">
        {chapters.map((chapter, chapterIndex) => {
          const isCurrent = chapterIndex === currentChapterIndex;
          const isNext = chapterIndex === nextChapterIndex;
          return (
            <li
              className="[contain-intrinsic-size:48px] [content-visibility:auto]"
              key={`${chapter.timecode}-${chapter.artist}-${chapter.title}-${chapterIndex}`}
            >
              <Button
                className={`grid h-auto min-h-12 w-full grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 py-1.5 text-left text-inherit transition-colors duration-150 hover:bg-white/4.5 focus-visible:-outline-offset-2 focus-visible:outline-primary/60 ${
                  isCurrent ? "bg-primary/10" : ""
                }`}
                ref={isCurrent ? currentChapterRef : undefined}
                onClick={() => onSeek(chapter.timecode)}
                aria-current={isCurrent ? "true" : undefined}
                aria-label={`Seek to ${chapter.title} at ${formatTime(chapter.timecode)}`}
                size="compact"
                variant="text"
              >
                <time className="text-xs text-[#777b76] tabular-nums">{formatTime(chapter.timecode)}</time>
                <span className="flex min-w-0 flex-col gap-1">
                  <strong className={`truncate text-xs font-semibold ${isCurrent ? "text-[#f0e8e2]" : isNext ? "text-[#c5c5bf]" : "text-[#d5d4ce]"}`}>{chapter.title}</strong>
                  <small className="truncate text-xs text-[#747873]">
                    {chapter.artist}
                    {chapter.album ? ` · ${chapter.album}` : ""}
                  </small>
                </span>
                {isCurrent ? (
                  <Badge className="rounded-full bg-primary/15 p-1 text-xs font-bold tracking-widest text-[#e39582] uppercase">On air</Badge>
                ) : isNext ? (
                  <Badge className="rounded-full bg-white/4.5 p-1 text-xs font-bold tracking-widest text-[#858984] uppercase">Next</Badge>
                ) : null}
              </Button>
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
  finalFocus,
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
  loadingAlbumId,
  playerVisible,
}: {
  open: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  finalFocus: RefObject<HTMLButtonElement | null>;
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
  loadingAlbumId?: string;
  playerVisible: boolean;
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
    <div className="flex min-h-full flex-col items-center justify-center px-1 pt-6 pb-7 text-center text-[#666a66]">
      <Music2 className="box-content rounded-full border border-white/[0.07] bg-coda-radio p-2 text-[#777b76]" size={25} />
      <strong className="mt-3 text-xs text-[#b9bbb5]">{currentTrack ? "End of the queue" : "Your queue is empty"}</strong>
      <span className="mt-1 max-w-64 text-balance text-xs/normal text-[#777b76]">
        {recommendation
          ? "Not sure what comes next? Let Coda pick from your collection."
          : currentTrack
            ? "Add another album or track to keep listening."
            : "Use the + button on any release to line up music."}
      </span>
      {recommendation ? (
        <div className="mt-6 grid w-full min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 overflow-hidden rounded-lg border border-white/9 bg-[radial-gradient(circle_at_0_0,rgba(221,101,73,0.09),transparent_58%),#1a1d1f] p-3 text-left shadow-[inset_0_1px_rgba(255,255,255,0.025)] *:data-[slot=cover]:self-center">
          <CoverArt size="small" album={recommendation.album} />
          <div className="flex min-w-0 flex-col justify-center">
            <span className="text-xs font-bold tracking-widest text-[#d07c67] uppercase">Try this next</span>
            <strong className="mt-1 truncate text-xs/tight text-[#deddd7]">{recommendation.album.title}</strong>
            <small className="mt-1 truncate text-xs/tight text-[#797d78]">
              {recommendation.album.artist} · {recommendation.reason}
            </small>
          </div>
          <div className="col-span-full flex gap-1.5">
            <Button
              type="button"
              className="min-h-8 flex-1 gap-1.5 border-0 bg-[#34211e] px-2.5 text-xs font-bold text-[#e9947e] hover:bg-primary/20 hover:text-[#ffc0b0]"
              onClick={onPlayRecommendation}
              disabled={recommendationLoading}
              aria-label={`Play something from ${recommendation.album.title}`}
              size="compact"
            >
              {recommendationLoading ? (
                <Spinner aria-hidden="true" className="size-3.5" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
              {recommendationLoading ? "Picking…" : "Play something"}
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button
                    type="button"
                    onClick={onAnotherRecommendation}
                    disabled={recommendationLoading}
                    aria-label="Suggest another album"
                    size="icon-compact"
                    variant="ghost"
                  />
                )}
              >
                <Dices size={15} />
              </TooltipTrigger>
              <TooltipContent>Suggest another</TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <DrawerContent
      ref={panelRef}
      finalFocus={finalFocus}
      className={`top-3! right-3! isolate w-80! max-h-none min-h-0 min-w-0 overflow-hidden rounded-lg border border-white/12 bg-coda-queue shadow-coda-queue [contain:paint] data-[swipe-direction=right]:rounded-lg xl:w-88! max-lg:top-2! max-lg:right-2! focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary/70 ${
        playerVisible
          ? "bottom-26! max-lg:bottom-25!"
          : "bottom-3! max-lg:bottom-2!"
      }`}
      aria-hidden={!open}
      tabIndex={-1}
    >
      <DrawerHeader className="flex-row items-center justify-between gap-4 bg-coda-queue px-3 pt-6 pb-4 text-left">
        <div>
          <span className="mb-2 text-xs font-bold tracking-widest text-[#777b76] uppercase">Playing next</span>
          <DrawerTitle className="m-0 font-display text-xl leading-none font-semibold">Queue</DrawerTitle>
          <DrawerDescription className="sr-only">
            Review and manage the tracks playing next.
          </DrawerDescription>
        </div>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  className="transition-[color,background-color,transform] duration-150 hover:scale-105 hover:rotate-12"
                  onClick={onShuffle}
                  disabled={queue.length < 2}
                  aria-label="Shuffle queue"
                  size="icon"
                  variant="ghost"
                />
              )}
            >
              <Shuffle size={17} />
            </TooltipTrigger>
            <TooltipContent>Shuffle queue</TooltipContent>
          </Tooltip>
          <Button
            className="h-8 px-2 text-xs font-semibold text-[#858984] hover:bg-transparent hover:text-[#e1dfd9]"
            onClick={onClear}
            disabled={queue.length <= currentIndex + 1}
            title="Clear upcoming tracks"
            size="compact"
            variant="text"
          >
            Clear next
          </Button>
        </div>
      </DrawerHeader>

      {currentTrack ? (
        <div
          className="mx-3 mb-2 overflow-hidden rounded-md border border-primary/25 bg-[linear-gradient(135deg,rgba(221,101,73,0.14),transparent_62%),#1c1a1b] p-2.5 animate-[queue-now-in_320ms_cubic-bezier(0.22,1,0.36,1)_both]"
          key={currentTrack.id}
        >
          <Badge className="mb-2 gap-1.5 bg-transparent p-0 text-xs tracking-widest text-[#d07b65] uppercase">
            <span className="size-1.5 rounded-full bg-primary" />Now playing
          </Badge>
          <div className="flex w-full min-w-0 items-center gap-2.5 text-left">
            <Button
              className="h-auto shrink-0 overflow-hidden p-0 text-left hover:bg-transparent"
              onClick={onNowPlaying}
              aria-label={`Open Now Playing for ${currentRadioChapter?.title ?? currentTrack.title}`}
              size="compact"
              title="Open Now Playing"
              variant="text"
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
            </Button>
            <div className="flex min-w-0 shrink grow basis-0 flex-col gap-1 overflow-hidden">
              {currentRadioChapter ? (
                <>
                  <RadioChapterCopy
                    chapter={currentRadioChapter}
                    className="flex min-w-0 flex-col gap-1"
                    onOpen={onOpenRadioItem}
                    localLinks={getRadioChapterLocalLinks(currentRadioChapter)}
                  />
                  {nextRadioChapter ? (
                    <span className="mt-0.5 truncate text-xs text-[#6f746f]">
                      Next: {nextRadioChapter.title}
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <Button
                    className="h-auto w-full justify-start truncate p-0 text-left text-xs font-semibold text-[#d9d8d2] hover:bg-transparent hover:text-[#d9d8d2]"
                    onClick={onNowPlaying}
                    size="compact"
                    variant="text"
                  >
                    {currentTrack.title}
                  </Button>
                  <Button
                    className="h-auto justify-start truncate p-0 text-xs text-[#7b7f7a] hover:bg-transparent hover:text-[#e28a73] hover:underline hover:underline-offset-2"
                    onClick={() => onArtist(currentTrack.artist)}
                    size="compact"
                    variant="text"
                  >
                    {currentTrack.artist}
                  </Button>
                </>
              )}
            </div>
            <span className={`ml-auto flex h-3.5 shrink-0 items-end gap-0.5 text-primary ${playing ? "" : "[&>i]:[animation-play-state:paused]"}`}>
              <i className="h-2 w-0.5 bg-current animate-[bar_750ms_ease-in-out_infinite_alternate]" />
              <i className="h-3 w-0.5 bg-current animate-[bar_750ms_ease-in-out_-320ms_infinite_alternate]" />
              <i className="h-1.5 w-0.5 bg-current animate-[bar_750ms_ease-in-out_-520ms_infinite_alternate]" />
            </span>
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
            className="min-h-0 flex-1 [touch-action:pan-y] [scrollbar-color:#343738_transparent] scrollbar-thin overflow-x-hidden overflow-y-auto overscroll-y-contain bg-coda-queue px-2 pt-0.5 pb-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary/60"
            role="region"
            tabIndex={0}
          >
            {!upcoming.length ? emptyQueue : null}
          </div>
        )}
      >
      <TrackQueueList
        aria-label="Upcoming tracks"
        className="min-h-0 flex-1 [touch-action:pan-y] [scrollbar-color:#343738_transparent] scrollbar-thin overflow-x-hidden overflow-y-auto overscroll-y-contain bg-coda-queue px-2 pt-0.5 pb-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary/60"
        empty={emptyQueue}
        getItemKey={(track, absoluteIndex) => `${track.id}-${absoluteIndex}`}
        items={upcoming}
        onMove={onMove}
        renderItem={(track, { absoluteIndex, index: upcomingIndex }) => (
          <div
            className={`group grid min-h-15 grid-cols-[1rem_minmax(0,1fr)_auto_1.5rem] items-center gap-1 rounded-md p-1.5 transition-[background-color,transform] duration-180 hover:translate-x-0.5 hover:bg-white/[0.035] max-lg:grid-cols-[0.75rem_minmax(0,1fr)_auto_1.5rem] ${
              upcomingIndex < 12
                ? "animate-[queue-track-in_300ms_cubic-bezier(0.22,1,0.36,1)_both] [animation-delay:var(--queue-delay,0ms)]"
                : ""
            }`}
            style={
              upcomingIndex < 12
                ? { "--queue-delay": `${upcomingIndex * 18}ms` } as React.CSSProperties
                : undefined
            }
          >
            <GripVertical className="cursor-grab text-[#4e5250] opacity-0 transition-[color,opacity,transform] duration-180 group-hover:translate-x-px group-hover:opacity-100" size={15} />
            <div className="flex min-w-0 items-center gap-2 text-left">
              <Button
                className="relative h-auto shrink-0 overflow-hidden p-0 text-left hover:bg-transparent"
                onClick={() => onAlbum(track)}
                aria-label={`Open ${track.album}`}
                aria-busy={loadingAlbumId === track.albumId || undefined}
                disabled={loadingAlbumId === track.albumId}
                size="compact"
                title={`Open ${track.album}`}
                variant="text"
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
                {loadingAlbumId === track.albumId ? (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40">
                    <Spinner
                      aria-label={`Loading ${track.album}`}
                      className="size-5 text-white"
                    />
                  </span>
                ) : null}
              </Button>
              <span className="flex min-w-0 flex-col gap-1">
                <Button
                  className="h-auto min-w-0 justify-start truncate p-0 text-left text-xs font-semibold text-[#d9d8d2] hover:bg-transparent hover:text-[#d9d8d2]"
                  onClick={() => onPlay(absoluteIndex)}
                  size="compact"
                  variant="text"
                >
                  {track.title}
                </Button>
                <Button
                  className="h-auto justify-start truncate p-0 text-xs text-[#7b7f7a] hover:bg-transparent hover:text-[#e28a73] hover:underline hover:underline-offset-2"
                  onClick={() => onArtist(track.artist)}
                  size="compact"
                  variant="text"
                >
                  {track.artist}
                </Button>
              </span>
            </div>
            <span className="text-xs text-[#666a66]">{formatTime(track.duration)}</span>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button
                    className="size-6 scale-100 opacity-60 transition-[color,opacity,transform] duration-180 group-hover:opacity-100 group-focus-within:scale-100 group-focus-within:opacity-100 focus-visible:scale-100 focus-visible:opacity-100"
                    onClick={() => onRemove(absoluteIndex)}
                    aria-label={`Remove ${track.title}`}
                    size="icon-compact"
                    variant="ghost"
                  />
                )}
              >
                <X size={14} />
              </TooltipTrigger>
              <TooltipContent>Remove</TooltipContent>
            </Tooltip>
          </div>
        )}
        startIndex={currentIndex + 1}
        tabIndex={0}
      />
      </Suspense>

      <DrawerFooter className="mt-0 flex-row justify-between gap-0 border-t border-border bg-coda-queue p-3 text-xs text-[#696d68]">
        <span className="animate-[queue-count-in_220ms_cubic-bezier(0.22,1,0.36,1)_both]" key={upcoming.length}>
          {countLabel(upcoming.length, "track")} next
        </span>
        <span>{upcoming.length ? `${formatTime(remaining)} remaining` : "Queue ready"}</span>
      </DrawerFooter>
    </DrawerContent>
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
  albumLoading,
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
  albumLoading: boolean;
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
    <Button
      className={`size-7 shrink-0 ${favorite ? "text-[#ef8066]" : ""}`}
      onClick={onToggleFavorite}
      size="icon-compact"
      title={favorite ? "Remove from favorites" : "Add to favorites"}
      aria-label={
        favorite
          ? `Remove ${track.title} from favorites`
          : `Add ${track.title} to favorites`
      }
      aria-pressed={favorite}
      variant="ghost"
    >
      <Heart size={17} fill={favorite ? "currentColor" : "none"} />
    </Button>
  ) : null;

  return (
    <div className="flex w-full min-w-0 items-center justify-self-start gap-3">
      {track ? (
        <>
          <Button
            className="player__art-link h-auto shrink-0 overflow-hidden rounded-sm p-0 hover:bg-transparent focus-visible:outline-primary"
            onClick={onNowPlaying}
            aria-label="Open Now Playing"
            size="compact"
            title={`Open Now Playing for ${track.title}`}
            variant="text"
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
          </Button>
          {activeChapter ? (
            <div className="flex min-w-0 flex-[0_1_auto] items-center gap-1">
              <div className="flex min-w-0 flex-[0_1_auto] flex-col gap-1">
                <div className="min-w-0" aria-live="polite">
                  <RadioChapterCopy
                    chapter={activeChapter}
                    className="flex min-w-0 flex-col gap-1"
                    onOpen={onOpenRadioItem}
                    localLinks={getRadioChapterLocalLinks(activeChapter)}
                  />
                </div>
              </div>
              {favoriteControl}
            </div>
          ) : (
            <div className="flex min-w-0 flex-[0_1_auto] flex-col gap-1">
              <div className="flex min-w-0 items-center gap-1">
                <strong className="truncate text-xs font-bold text-[#e6e4de]" title={track.title}>{track.title}</strong>
                {favoriteControl}
              </div>
              <span className="truncate text-xs text-[#7f827e]">
                <Button
                  className="h-auto p-0 text-xs text-[#7b7f7a] hover:bg-transparent hover:text-[#e28a73] hover:underline hover:underline-offset-2"
                  onClick={() => onArtist(track.artist)}
                  size="compact"
                  variant="text"
                >
                  {track.artist}
                </Button>
                {" · "}
                <Button
                  className="h-auto p-0 text-xs text-[#7b7f7a] hover:bg-transparent hover:text-[#e28a73] hover:underline hover:underline-offset-2"
                  onClick={() => onAlbum(track)}
                  aria-busy={albumLoading || undefined}
                  disabled={albumLoading}
                  size="compact"
                  variant="text"
                >
                  {albumLoading ? (
                    <Spinner
                      aria-label={`Loading ${track.album}`}
                      className="size-3.5"
                    />
                  ) : null}
                  {track.album}
                </Button>
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-[#777a76]">
          <Disc3 size={20} />
          <span className="truncate text-xs">Nothing playing</span>
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
  const positionCanPrevious = Boolean(track) && (
    currentTime > PREVIOUS_RESTART_THRESHOLD_SECONDS ||
    previousRadioChapterTimeInTimeline(radioTimeline, currentTime) !== undefined
  );
  const positionCanNext = Boolean(track) &&
    nextRadioChapterTimeInTimeline(radioTimeline, currentTime) !== undefined;

  return (
    <div className="flex w-full max-w-3xl flex-col items-stretch gap-2 justify-self-center">
      <div
        className="grid grid-cols-[repeat(5,2rem)] items-center justify-center gap-2"
        role="group"
        aria-label="Playback controls"
      >
        <span aria-hidden="true" className="size-8" />
        <Tooltip>
          <TooltipTrigger render={<Button onClick={onPrevious} disabled={!canPrevious && !positionCanPrevious} aria-label="Previous" size="icon" variant="ghost" />}>
            <SkipBack size={18} fill="currentColor" />
          </TooltipTrigger>
          <TooltipContent>Previous</TooltipContent>
        </Tooltip>
        <Button
          className="size-9 rounded-full border-0 bg-[#eeece6] p-0 text-[#17191b] transition-[background-color,transform,box-shadow] duration-(--duration-coda-fast) hover:scale-105 hover:bg-white hover:shadow-[0_5px_16px_rgba(0,0,0,0.22)] active:scale-95"
          onClick={onToggle}
          disabled={!track}
          aria-label={playing ? "Pause" : "Play"}
          size="icon"
        >
          {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </Button>
        <Tooltip>
          <TooltipTrigger render={<Button onClick={onNext} disabled={!canNext && !positionCanNext} aria-label="Next" size="icon" variant="ghost" />}>
            <SkipForward size={18} fill="currentColor" />
          </TooltipTrigger>
          <TooltipContent>Next</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button className={repeat !== "off" ? "text-primary" : ""} onClick={onRepeat} disabled={!track} aria-label={`Repeat ${repeat}`} size="icon" variant="ghost" />}>
            {repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </TooltipTrigger>
          <TooltipContent>Repeat</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid grid-cols-[2rem_minmax(6rem,1fr)_2rem] items-center gap-2">
        <span className="text-xs text-[#70746f]">{formatTime(currentTime)}</span>
        <Slider
          aria-label="Track position"
          min={0}
          max={duration || 1}
          step={1}
          value={[Math.min(currentTime, duration || 1)]}
          disabled={!track}
          onValueChange={([nextPosition]) => onSeek(nextPosition)}
        />
        <span className="text-right text-xs text-[#70746f]">{formatTime(duration)}</span>
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
  albumLoading,
  onNowPlaying,
  onOpenRadioItem,
  getRadioChapterLocalLinks,
  favorite,
  onToggleFavorite,
  onAddToPlaylist,
  queueOpen,
  queueControlRef,
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
  albumLoading: boolean;
  onNowPlaying: () => void;
  onOpenRadioItem: (url: string) => void;
  getRadioChapterLocalLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
  favorite: boolean;
  onToggleFavorite: () => void;
  onAddToPlaylist: () => void;
  queueOpen: boolean;
  queueControlRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <footer className="relative z-3 grid grid-cols-[minmax(0,1fr)_minmax(18rem,1.4fr)_minmax(0,1fr)] items-center gap-3 border-t border-(--line-strong) bg-coda-player px-3 shadow-coda-player lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1.5fr)_minmax(0,1fr)] lg:gap-6 lg:px-4">
      <PlayerTrack
        track={track}
        radioTimeline={radioTimeline}
        playbackClock={playbackClock}
        favorite={favorite}
        onToggleFavorite={onToggleFavorite}
        onArtist={onArtist}
        onAlbum={onAlbum}
        albumLoading={albumLoading}
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
      <div className="flex w-full min-w-0 items-center justify-end justify-self-end gap-0.5">
        <Tooltip>
          <TooltipTrigger render={<Button onClick={() => onVolume(volume ? 0 : 0.72)} aria-label={volume ? "Mute" : "Unmute"} size="icon" variant="ghost" />}>
            {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </TooltipTrigger>
          <TooltipContent>{volume ? "Mute" : "Unmute"}</TooltipContent>
        </Tooltip>
        <Slider
          aria-label="Volume"
          className="hidden w-20 lg:block"
          min={0}
          max={1}
          step={0.01}
          value={[volume]}
          onValueChange={([nextVolume]) => onVolume(nextVolume)}
        />
        {airPlayAvailable ? (
          <Tooltip>
            <TooltipTrigger render={<Button onClick={onAirPlay} disabled={!track} aria-label="Choose AirPlay device" size="icon" variant="ghost" />}>
              <Airplay size={18} />
            </TooltipTrigger>
            <TooltipContent>Choose AirPlay device</TooltipContent>
          </Tooltip>
        ) : null}
        {track && !track.id.startsWith("radio:") ? (
          <Tooltip>
            <TooltipTrigger render={<Button onClick={onAddToPlaylist} aria-label={`Add ${track.title} to playlist`} size="icon" variant="ghost" />}>
              <ListPlus size={17} />
            </TooltipTrigger>
            <TooltipContent>Add to playlist</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <DrawerTrigger
            render={(
              <TooltipTrigger
                render={(
                  <Button
                    className={queueOpen ? "text-primary" : ""}
                    ref={queueControlRef}
                    aria-label={queueOpen ? "Hide queue" : "Show queue"}
                    aria-pressed={queueOpen}
                    size="icon"
                    variant="ghost"
                  />
                )}
              >
                <ListMusic size={18} />
              </TooltipTrigger>
            )}
          />
          <TooltipContent>{queueOpen ? "Hide queue" : "Show queue"}</TooltipContent>
        </Tooltip>
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
    <article className="mx-auto -mt-2 mb-8 w-full max-w-4xl animate-[album-page-in_180ms_ease-out]" aria-label={`${album.title} release details`}>
      <Button className="mb-3.5 -ml-1 h-auto gap-1.5 p-1 text-xs text-[#8d918b] hover:bg-transparent hover:text-[#eceae4]" onClick={onBack} size="compact" variant="text">
        <ArrowLeft size={15} />
        Back to releases
      </Button>
      <header className="relative grid grid-cols-[10rem_minmax(0,1fr)] items-end gap-6 overflow-hidden rounded-t-xl border border-border bg-[radial-gradient(circle_at_82%_20%,rgba(221,101,73,0.13),transparent_37%),linear-gradient(135deg,#24282a,#191c1e_70%)] p-6 xl:grid-cols-[14rem_minmax(0,1fr)] xl:gap-8 xl:p-8">
        <div className="size-40 drop-shadow-[0_16px_25px_rgba(0,0,0,0.25)] *:data-[slot=cover]:size-full *:data-[slot=cover]:rounded-lg xl:size-56">
          <CoverArt album={album} size="large" />
        </div>
        <div className="min-w-0 pb-1">
            <span className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">{album.songCount === 1 ? "Single" : "Album"}</span>
            <h2 className="m-0 max-w-lg font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-3xl leading-none font-semibold tracking-tighter text-[#f1efe9] xl:text-4xl">{album.title}</h2>
            <Button
              className="mx-0 my-2 block h-auto justify-start p-0 text-sm font-semibold text-[#d98771] hover:bg-transparent hover:text-[#e28a73] hover:underline hover:underline-offset-2"
              onClick={() => onArtist(album.artist)}
              size="compact"
              variant="text"
            >
              {album.artist}
            </Button>
            <span className="text-xs text-[#7f837e]">
              {album.year ?? "Year unknown"} · {countLabel(album.songCount, "track")} · {formatTime(album.duration)}
            </span>
            <div className="mt-6 flex gap-2">
              <Button
                className={`${activeAlbum ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_8px_24px_rgba(221,101,73,0.16)]" : ""} ${activeAlbum && playing ? "bg-[color-mix(in_srgb,var(--primary)_82%,#17191b)]" : ""}`}
                onClick={activeAlbum ? onTogglePlayback : onPlayAlbum}
                disabled={loading}
                aria-label={
                  activeAlbum
                    ? `${playing ? "Pause" : "Resume"} ${album.title}`
                    : `Play ${album.songCount === 1 ? "single" : "album"}`
                }
                aria-pressed={activeAlbum && playing}
                variant="primary"
              >
                {activeAlbum && playing
                  ? <Pause size={17} fill="currentColor" />
                  : <Play size={17} fill="currentColor" />}
                {activeAlbum
                  ? (playing ? "Pause" : "Resume")
                  : `Play ${album.songCount === 1 ? "single" : "album"}`}
              </Button>
              <Button onClick={onQueueAlbum} disabled={loading}>
                <Plus size={17} /> Add to queue
              </Button>
              <Button
                onClick={() => onAddToPlaylist(album.tracks ?? [])}
                disabled={loading || !album.tracks?.length}
              >
                <ListPlus size={17} /> Add to playlist
              </Button>
              <Button
                className={favoriteAlbum ? "text-[#ef8066]" : ""}
                onClick={onToggleFavoriteAlbum}
                aria-pressed={favoriteAlbum}
              >
                <Heart size={17} fill={favoriteAlbum ? "currentColor" : "none"} />
                {favoriteAlbum ? "Favorited" : "Favorite"}
              </Button>
            </div>
        </div>
        </header>
        <section
          className="rounded-b-xl border border-t-0 border-border bg-coda-field"
          aria-label="Track list"
          aria-busy={loading || undefined}
        >
          <div className="flex items-end justify-between px-6 pt-6 pb-2">
            <div>
              <span className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">Track list</span>
              <h3 className="mt-1 mb-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base leading-none font-semibold text-[#d7d6d0]">{countLabel(album.songCount, "song")}</h3>
            </div>
            <span className="text-xs text-[#747873]">{formatTime(album.duration)}</span>
          </div>
          <div className="px-4 pt-2.5 pb-4">
          <div className="grid h-9 grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_7rem] items-center border-b border-border text-xs text-[#6f736e] uppercase">
            <span className="grid place-items-center justify-self-stretch text-center">#</span>
            <span>Title</span>
            <span className="grid place-items-center justify-self-stretch text-center leading-none" title="Duration">
              <Clock3 size={14} aria-hidden="true" />
              <span className="sr-only">Duration</span>
            </span>
            <span className="text-center">Actions</span>
          </div>
          {loading ? (
            <div className="flex min-h-44 items-center justify-center gap-2.5 text-xs text-[#898c87]">
              <Spinner className="size-5" aria-label="Loading album tracks" /> Loading tracks…
            </div>
          ) : !album.tracks?.length ? (
            <div className="flex min-h-44 flex-col items-center justify-center gap-1.5 p-6 text-center text-xs text-[#898c87]">
              <Music2 size={22} />
              <strong className="mt-1 text-xs text-[#c7c8c2]">No playable tracks returned</strong>
              <span className="max-w-80 text-xs/normal text-[#777b76]">This release may not be streamable through Bandcamp’s Subsonic beta yet.</span>
            </div>
          ) : (
            album.tracks.map((track) => {
              const activeTrack = currentTrackId === track.id;
              return (
              <div className={`group grid h-14 grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_7rem] items-center rounded-sm border-b border-white/4.5 hover:bg-white/[0.035] ${activeTrack ? "bg-primary/[0.075]" : ""}`} key={track.id}>
                <Button
                  className={`h-full rounded-none p-0 text-xs text-[#777a76] hover:bg-transparent group-hover:[&>span]:hidden group-hover:[&>svg]:block [&>svg]:hidden ${activeTrack ? "text-[#e88c75] [&>span]:hidden [&>svg]:block" : ""}`}
                  onClick={activeTrack ? onTogglePlayback : () => onPlayTrack(track)}
                  aria-label={
                    activeTrack
                      ? `${playing ? "Pause" : "Resume"} ${track.title}`
                      : `Play ${track.title}`
                  }
                  aria-pressed={activeTrack && playing}
                  variant="ghost"
                >
                  <span>{track.track}</span>
                  {activeTrack && playing
                    ? <Pause size={13} fill="currentColor" />
                    : <Play size={13} fill="currentColor" />}
                </Button>
                <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                  <Button
                    className="h-auto w-fit max-w-full min-w-0 justify-start overflow-hidden p-0 text-left focus-visible:-outline-offset-2 focus-visible:outline-primary"
                    onClick={activeTrack ? onTogglePlayback : () => onPlayTrack(track)}
                    size="compact"
                    variant="text"
                  >
                    <strong className={`block truncate text-xs ${activeTrack ? "text-[#f0d7cf]" : "text-[#d9d8d2]"}`}>{track.title}</strong>
                  </Button>
                  <Button
                    className="h-auto w-fit max-w-full justify-start truncate p-0 text-xs text-[#777b76] hover:bg-transparent hover:text-[#e28a73] hover:underline hover:underline-offset-2 focus-visible:-outline-offset-2"
                    onClick={() => onArtist(track.artist)}
                    size="compact"
                    variant="text"
                  >
                    {track.artist}
                  </Button>
                </div>
                <span className="grid place-items-center justify-self-stretch text-center text-xs text-[#777b76] tabular-nums">{formatTime(track.duration)}</span>
                <div className="grid grid-cols-[repeat(3,2rem)] justify-end">
                  <Button onClick={() => onQueueTrack(track)} size="icon" variant="ghost" title="Add to queue" aria-label={`Add ${track.title} to queue`}>
                    <Plus size={16} />
                  </Button>
                  <Button onClick={() => onAddToPlaylist([track])} size="icon" variant="ghost" title="Add to playlist" aria-label={`Add ${track.title} to playlist`}>
                    <ListPlus size={16} />
                  </Button>
                  <Button
                    className={favoriteTrackIds.has(track.id) ? "text-[#ef8066]" : ""}
                    onClick={() => onToggleFavoriteTrack(track)}
                    size="icon"
                    title={favoriteTrackIds.has(track.id) ? "Remove from favorites" : "Add to favorites"}
                    aria-label={favoriteTrackIds.has(track.id) ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}
                    aria-pressed={favoriteTrackIds.has(track.id)}
                    variant="ghost"
                  >
                    <Heart size={16} fill={favoriteTrackIds.has(track.id) ? "currentColor" : "none"} />
                  </Button>
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
  appUpdater,
  connected,
  lastFmStatus,
  onClose,
  onConnected,
  onDisconnected,
  onLastFmStatus,
}: {
  appUpdater: AppUpdaterController;
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
    <Dialog
      open
      onOpenChange={(open, details) => {
        if (open) return;
        if (dialogBusy) {
          details.cancel();
          return;
        }
        onClose();
      }}
    >
      <DialogContent
        aria-busy={dialogBusy}
        className="top-[calc(50%-(--spacing(12)))] max-h-[calc(100%-(--spacing(38)))] [scrollbar-color:#3e4142_transparent] scrollbar-thin gap-0 overflow-auto p-8"
        showCloseButton={false}
      >
        <Button
          className="absolute top-3 right-3 z-2"
          onClick={onClose}
          aria-label="Close"
          disabled={dialogBusy}
          size="icon"
          variant="ghost"
        >
          <X size={19} />
        </Button>
        <div className="mb-5 grid size-12 place-items-center rounded-full bg-accent text-[#e77b60]">
          <Radio size={24} />
        </div>
        <span className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">
          Secure connection
        </span>
        <DialogTitle
          id="connection-title"
          className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-3xl leading-none font-semibold tracking-tighter"
        >
          {connected ? "Bandcamp is connected" : "Bring in your collection"}
        </DialogTitle>
        <DialogDescription className="mt-2.5 mb-4 text-xs/normal text-[#969994]">
          Coda uses Bandcamp’s official Subsonic beta. Generate separate app credentials in
          Fan Settings, then enter them here.
        </DialogDescription>
        <div className="grid grid-cols-1 gap-2 rounded-md border border-border bg-white/2.5 px-3.5 py-3">
          <span className="flex items-center gap-2 text-xs text-[#a8aaa5]"><Check className="text-coda-success" size={15} /> Stored in your system credential vault</span>
          <span className="flex items-center gap-2 text-xs text-[#a8aaa5]"><Check className="text-coda-success" size={15} /> Requests limited to bandcamp.com</span>
          <span className="flex items-center gap-2 text-xs text-[#a8aaa5]"><Check className="text-coda-success" size={15} /> No analytics or third-party servers</span>
        </div>
        <Button
          className="my-4 h-auto justify-start gap-2 p-0 text-xs text-[#df8067] hover:bg-transparent hover:text-[#f1957d]"
          onClick={() => void openSettings()}
          disabled={settingsOpening || state === "connecting" || disconnecting}
          size="compact"
          variant="text"
        >
          {settingsOpening
            ? <Spinner aria-hidden="true" className="size-4 text-current" />
            : <ExternalLink size={16} />}
          {settingsOpening ? "Opening Bandcamp…" : "Sign in and generate credentials"}
        </Button>
        <ol className="-mt-1 mb-4 grid list-decimal gap-1 pl-6 text-xs/normal text-[#8d908b] marker:font-bold marker:text-[#cf6d55]">
          <li>Sign in to your Bandcamp fan account in the browser.</li>
          <li>Scroll to Subsonic and choose Generate credentials.</li>
          <li>Return here and enter the generated username and password.</li>
        </ol>
        {!connected ? <form className="flex flex-col gap-3" onSubmit={submit}>
          <Label className="flex-col items-stretch gap-1.5">
            Subsonic username
            <Input name="subsonic-username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Generated username" disabled={state === "connecting"} />
          </Label>
          <Label className="flex-col items-stretch gap-1.5">
            Subsonic password
            <Input name="subsonic-password" autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Generated password" disabled={state === "connecting"} />
          </Label>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <Button className="mt-1 w-full" type="submit" disabled={!username.trim() || !password || state === "connecting"} variant="primary">
            {state === "connecting" ? <Spinner aria-hidden="true" className="size-4 text-current" /> : <Radio size={17} />}
            {state === "connecting"
              ? connectLoaded
                ? `Loading ${countLabel(connectLoaded, "release")}…`
                : "Connecting securely…"
              : "Connect Bandcamp"}
          </Button>
        </form> : null}
        {connected ? (
          <>
            {error ? <Alert variant="danger">{error}</Alert> : null}
            <Button
              type="button"
              className="mt-2.5 w-full text-xs"
              onClick={() => void removeBandcamp()}
              disabled={disconnecting}
              variant="danger"
            >
              {disconnecting ? <Spinner aria-hidden="true" className="size-4 text-current" /> : null}
              {disconnecting
                ? "Disconnecting Bandcamp…"
                : "Disconnect and remove Bandcamp credentials"}
            </Button>
          </>
        ) : null}
        <Separator className="my-5" />
        <section className="grid gap-3" aria-labelledby="lastfm-settings-title">
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
            <AudioLines className="mt-px text-[#d4d2cc]" size={17} />
            <div>
              <h3 id="lastfm-settings-title" className="m-0 text-sm font-semibold text-[#deddd7]">Last.fm scrobbling</h3>
              <p className="mt-1 mb-0 text-xs/normal text-[#858984]">
                Send Now Playing updates and scrobble after half the track or four minutes,
                whichever comes first.
              </p>
            </div>
            <Badge variant={lastFmStatus.connected ? "success" : "secondary"}>
              {lastFmStatus.connected ? "Connected" : "Not connected"}
            </Badge>
          </div>
          {lastFmStatus.connected ? (
            <div className="flex items-center justify-between gap-3 pl-7">
              <span className="text-xs text-[#8f928d]">Scrobbling as <strong className="font-semibold text-[#d0d1cb]">{lastFmStatus.username}</strong></span>
              <Button
                type="button"
                onClick={() => void removeLastFm()}
                disabled={lastFmAction !== "idle"}
                size="compact"
              >
                {lastFmAction === "disconnecting" ? <Spinner aria-hidden="true" className="size-4" /> : null}
                {lastFmAction === "disconnecting" ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
          ) : lastFmStatus.configured ? (
            <div className="flex items-center justify-between gap-3 pl-7">
              {lastFmToken ? (
                <>
                  <p className="m-0 text-xs/normal text-[#858984]">Approve Coda in the browser, then return here to finish.</p>
                  <Button
                    type="button"
                    onClick={() => void finishLastFm()}
                    disabled={lastFmAction !== "idle"}
                    size="compact"
                  >
                    {lastFmAction === "finishing" ? <Spinner aria-hidden="true" className="size-4" /> : <Check size={15} />}
                    {lastFmAction === "finishing" ? "Finishing…" : "Finish connection"}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  onClick={() => void beginLastFm()}
                  disabled={lastFmAction !== "idle"}
                  size="compact"
                >
                  {lastFmAction === "starting" ? <Spinner aria-hidden="true" className="size-4" /> : <ExternalLink size={15} />}
                  {lastFmAction === "starting" ? "Opening Last.fm…" : "Connect Last.fm"}
                </Button>
              )}
            </div>
          ) : (
            <p className="mt-1 mb-0 pl-7 text-xs/normal text-[#858984]">
              Last.fm credentials have not been added to this Coda build yet.
            </p>
          )}
          {lastFmError ? <Alert variant="danger">{lastFmError}</Alert> : null}
          <small className="block pl-7 text-xs/normal text-[#656965]">The Last.fm session key is stored in your system credential vault. Coda never sees your Last.fm password.</small>
        </section>
        {appUpdater.supported ? (
          <>
            <Separator className="my-5" />
            <AppUpdateSettings updater={appUpdater} />
          </>
        ) : null}
        <small className="mt-4 block text-xs/normal text-[#656965]">Bandcamp’s Subsonic service is currently in beta. Coda is an independent client and is not affiliated with Bandcamp or Last.fm.</small>
      </DialogContent>
    </Dialog>
  );
}

function LibrarySkeleton({
  label = "Loading your collection",
}: {
  label?: string;
}) {
  const shimmerClassName =
    "relative overflow-hidden rounded-sm bg-[#202325] animate-none after:block after:h-full after:w-[45%] after:translate-x-[-120%] after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.045),transparent)] after:animate-[skeleton-shimmer_1.4s_ease-in-out_infinite] after:content-[''] motion-reduce:after:animate-none";

  return (
    <section aria-label={label} aria-live="polite">
      <div className="flex items-center justify-center gap-2 pt-7 text-xs text-muted-foreground">
        <Spinner aria-label={label} className="size-5" />
        <span aria-hidden="true">{label}…</span>
      </div>
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-3 gap-y-5 pt-6 lg:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] lg:gap-x-4 lg:gap-y-6 xl:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"
        aria-hidden="true"
      >
        {Array.from({ length: 10 }, (_, index) => (
          <div className="flex flex-col gap-2" key={index}>
            <Skeleton className={`${shimmerClassName} aspect-square w-full`} />
            <Skeleton className={`${shimmerClassName} h-2.5 w-[72%]`} />
            <Skeleton className={`${shimmerClassName} h-2 w-[48%]`} />
          </div>
        ))}
      </div>
    </section>
  );
}

function PlaylistDialogFallback() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-popover px-4 py-3 text-xs text-popover-foreground shadow-xl">
        <Spinner aria-label="Loading playlists" className="size-5" />
        <span aria-hidden="true">Loading playlists…</span>
      </div>
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
    <div className="flex min-h-72 flex-col items-center justify-center text-center text-[#696d68]">
      <span className="grid size-14 place-items-center rounded-full border border-border bg-white/[0.018] text-[#787c77]">{icon}</span>
      <h3 className="mt-4 mb-1 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base/tight font-semibold text-[#c7c8c2]">{title}</h3>
      <p className="m-0 max-w-xs text-xs text-[#777a76]">{detail}</p>
      {action}
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const { data: albums } = useQuery(libraryStateQueryOptions);
  const appUpdater = useAppUpdater();
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
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [playerStateReady, setPlayerStateReady] = useState(false);
  const [selectedAlbum, setSelectedAlbum] = useState<Album>();
  const [loadingAlbumId, setLoadingAlbumId] = useState<string>();
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
  const queuePanelRef = useRef<HTMLDivElement>(null);
  const queueControlRef = useRef<HTMLButtonElement>(null);
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
    if (!queueOpen || !queueFocusRequestedRef.current) return;
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
  }, [queueOpen]);
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
  const currentAlbum = useMemo(
    () =>
      currentTrack
        ? albums.find((album) => album.id === currentTrack.albumId)
        : undefined,
    [albums, currentTrack],
  );
  useEffect(() => {
    if (currentTrack) lastPlayedTrackRef.current = currentTrack;
  }, [currentTrack]);
  const currentRadioTimeline = useMemo(
    () => boundRadioChapters(currentTrack?.radioChapters ?? []),
    [currentTrack?.radioChapters],
  );
  const { current: currentSystemMediaChapter } = useCurrentRadioChapter(
    playbackClock,
    currentRadioTimeline,
  );
  const directSystemMediaArtworkUrl =
    currentSystemMediaChapter?.artworkUrl ??
    currentTrack?.artworkUrl ??
    currentAlbum?.artworkUrl;
  const systemMediaCoverArtId =
    currentTrack?.coverArt ?? currentAlbum?.coverArt;
  const systemMediaArtworkIdentity = currentTrack
    ? [
        currentTrack.id,
        currentSystemMediaChapter?.timecode ?? "track",
        systemMediaCoverArtId ?? "",
      ].join(":")
    : "";
  const [resolvedSystemMediaArtwork, setResolvedSystemMediaArtwork] =
    useState<{ identity: string; url: string }>();
  useEffect(() => {
    if (
      !systemMediaArtworkIdentity ||
      directSystemMediaArtworkUrl ||
      !systemMediaCoverArtId
    ) {
      return;
    }
    let active = true;
    fetchCoverUrl(systemMediaCoverArtId)
      .then((url) => {
        if (active) {
          setResolvedSystemMediaArtwork({
            identity: systemMediaArtworkIdentity,
            url,
          });
        }
      })
      .catch(() => {
        // The generated cover remains available if signed artwork refresh fails.
      });
    return () => {
      active = false;
    };
  }, [
    directSystemMediaArtworkUrl,
    systemMediaArtworkIdentity,
    systemMediaCoverArtId,
  ]);
  const systemMediaDisplay = useMemo(
    () => currentTrack
      ? {
          title: currentSystemMediaChapter?.title ?? currentTrack.title,
          artist: currentSystemMediaChapter?.artist ?? currentTrack.artist,
          album:
            currentSystemMediaChapter?.album ??
            currentTrack.album,
          artworkUrl:
            directSystemMediaArtworkUrl,
          palette: currentTrack.palette,
        }
      : undefined,
    [currentSystemMediaChapter, currentTrack, directSystemMediaArtworkUrl],
  );
  const systemMediaArtworkUrl = useMemo(
    () =>
      systemMediaDisplay?.artworkUrl ??
      (resolvedSystemMediaArtwork?.identity === systemMediaArtworkIdentity
        ? resolvedSystemMediaArtwork.url
        : undefined) ??
      (systemMediaDisplay
        ? createSystemArtworkDataUrl(systemMediaDisplay)
        : undefined),
    [
      resolvedSystemMediaArtwork,
      systemMediaArtworkIdentity,
      systemMediaDisplay,
    ],
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
  useEffect(() => {
    syncMediaSessionPlayback({
      title: systemMediaDisplay?.title,
      artist: systemMediaDisplay?.artist,
      album: systemMediaDisplay?.album,
      artworkUrl: systemMediaArtworkUrl,
      playing,
      positionSeconds: playbackClock.readExact(),
      durationSeconds: currentTrack?.duration,
    });
  }, [
    currentTrack?.duration,
    playing,
    playbackClock,
    systemMediaArtworkUrl,
    systemMediaDisplay?.album,
    systemMediaDisplay?.artist,
    systemMediaDisplay?.title,
  ]);
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

  const showMainWindow = useCallback(() => {
    if (!isDesktop()) return;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        await appWindow.unminimize();
        await appWindow.show();
        await appWindow.setFocus();
      })
      .catch(() => {
        // Native tray restore is optional; the main window stays usable.
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
  const playFromSystemMediaControls = useCallback(() => {
    if (currentTrack) setPlaying(true);
  }, [currentTrack]);
  const pauseFromSystemMediaControls = useCallback(() => {
    setPlaying(false);
  }, []);

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

  const systemMediaHandlersRef = useRef({
    onPlay: playFromSystemMediaControls,
    onPause: pauseFromSystemMediaControls,
    onPreviousTrack: previous,
    onNextTrack: next,
  });
  useEffect(() => {
    systemMediaHandlersRef.current = {
      onPlay: playFromSystemMediaControls,
      onPause: pauseFromSystemMediaControls,
      onPreviousTrack: previous,
      onNextTrack: next,
    };
  }, [
    next,
    pauseFromSystemMediaControls,
    playFromSystemMediaControls,
    previous,
  ]);
  useEffect(
    () => {
      return installMediaSessionTrackHandlers({
        onPlay: () => systemMediaHandlersRef.current.onPlay(),
        onPause: () => systemMediaHandlersRef.current.onPause(),
        onPreviousTrack: () =>
          systemMediaHandlersRef.current.onPreviousTrack(),
        onNextTrack: () => systemMediaHandlersRef.current.onNextTrack(),
      });
    },
    [],
  );

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
    }
  }, [queryClient, setAlbums]);

  const openAlbum = useCallback(async (album: Album) => {
    const sessionGeneration = bandcampSessionGenerationRef.current;
    const hasLocalTracklist = Boolean(album.tracks?.length);
    const cachedTracks = cachedAlbumTracks(queryClient, album);
    const coldLoad = cachedTracks === undefined;
    let albumForDetail = coldLoad
      ? album
      : albumWithTracks(album, cachedTracks);
    if (coldLoad) {
      setLoadingAlbumId(album.id);
    } else {
      setLoadingAlbumId((current) =>
        current === album.id ? undefined : current
      );
    }
    void transitionCodaView(
      () => setSelectedAlbum(albumForDetail),
      "page-forward",
      { skipSnapshot: coldLoad },
    );
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
    } finally {
      if (coldLoad) {
        setLoadingAlbumId((current) =>
          current === album.id ? undefined : current
        );
      }
    }
  }, [ensureTracks, notify, queryClient, setAlbums]);

  const prefetchAlbum = useCallback((album: Album) => {
    void prefetchAlbumQueryData(queryClient, album);
  }, [queryClient]);

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
    const latest = latestPlayerStateRef.current;
    const activated = activateTrack(
      latest.queue,
      latest.currentIndex,
      track,
    );
    latestPlayerStateRef.current = {
      ...latest,
      queue: activated.queue,
      currentIndex: activated.currentIndex,
    };
    setQueue(activated.queue);
    setCurrentIndex(activated.currentIndex);
    playbackClock.reset();
    setPlaying(true);
  }, [playbackClock]);

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
    setLoadingAlbumId(undefined);
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

  const changeQueueOpen = useCallback((nextOpen: boolean) => {
    if (nextOpen) queueFocusRequestedRef.current = true;
    setQueueOpen(nextOpen);
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
    }, "page-crossfade", { skipSnapshot: true });
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

  const desktopControlHandlersRef = useRef({
    onPlay: playFromSystemMediaControls,
    onPause: pauseFromSystemMediaControls,
    onTogglePlayback: togglePlayback,
    onPrevious: previous,
    onNext: next,
    onShuffleLibrary: shuffleLibrary,
  });
  useEffect(() => {
    desktopControlHandlersRef.current = {
      onPlay: playFromSystemMediaControls,
      onPause: pauseFromSystemMediaControls,
      onTogglePlayback: togglePlayback,
      onPrevious: previous,
      onNext: next,
      onShuffleLibrary: shuffleLibrary,
    };
  }, [
    next,
    pauseFromSystemMediaControls,
    playFromSystemMediaControls,
    previous,
    shuffleLibrary,
    togglePlayback,
  ]);
  useEffect(() => {
    if (!isDesktop()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const safelyUnlisten = (dispose: () => void) => {
      try {
        void Promise.resolve(dispose()).catch(() => undefined);
      } catch {
        // A rebuilding WebView may have already removed the native listener.
      }
    };
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<string>("coda://tray-control", ({ payload }) => {
          const handlers = desktopControlHandlersRef.current;
          if (payload === "play") handlers.onPlay();
          if (payload === "pause") handlers.onPause();
          if (payload === "play-pause") handlers.onTogglePlayback();
          if (payload === "previous") handlers.onPrevious();
          if (payload === "next") handlers.onNext();
          if (payload === "shuffle-library") {
            void handlers.onShuffleLibrary();
          }
        }),
      )
      .then((dispose) => {
        if (disposed) {
          safelyUnlisten(dispose);
        } else {
          unlisten = dispose;
        }
      })
      .catch(() => {
        // Tray controls are optional; in-window playback remains available.
      });
    return () => {
      disposed = true;
      if (unlisten) safelyUnlisten(unlisten);
    };
  }, []);
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
    <Drawer
      disablePointerDismissal
      modal={false}
      onOpenChange={changeQueueOpen}
      open={queueOpen}
      swipeDirection="right"
    >
    <div
      className={`grid h-full w-full min-w-[760px] bg-background ${
        nowPlayingOpen
          ? "grid-rows-[minmax(0,1fr)]"
          : "grid-rows-[minmax(0,1fr)_--spacing(23)]"
      }`}
    >
      <div
        className="relative isolate grid min-h-0 grid-cols-[9rem_minmax(22rem,1fr)] overflow-hidden lg:grid-cols-[12rem_minmax(32rem,1fr)] xl:grid-cols-[14rem_minmax(32rem,1fr)]"
        data-queue-open={queueOpen}
      >
        <AppSidebar
          view={view}
          onView={chooseView}
          connected={connected}
          onConnect={openConnection}
        />
        <main
          className={`library-pane min-w-0 overflow-auto [scrollbar-color:#393c3d_transparent] scrollbar-thin ${
            nowPlayingOpen
              ? "p-0"
              : "px-4 pt-6 pb-10 lg:px-6 lg:pt-8 lg:pb-12 xl:px-8"
          }`}
          data-coda-library-scroll
          ref={libraryPaneRef}
        >
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
              queueControlRef={queueControlRef}
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
              onArtist={browseArtist}
              onAlbum={openTrackAlbum}
              albumLoading={loadingAlbumId === currentTrack.albumId}
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
            <Suspense
              fallback={(
                <LibrarySkeleton
                  label={view === "favorites"
                    ? "Loading Favorites"
                    : "Loading Playlists"}
                />
              )}
            >
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
                loadingAlbumId={loadingAlbumId}
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
            <Suspense fallback={<LibrarySkeleton label="Opening Discover" />}>
              <DiscoverView
                onPlay={playTrack}
                onQueue={queueTrack}
                currentTrackId={currentTrack?.id}
                playing={playing}
                onTogglePlayback={togglePlayback}
              />
            </Suspense>
          ) : view === "radio" ? (
            <Suspense fallback={<LibrarySkeleton label="Tuning Bandcamp Radio" />}>
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
          <header className="flex flex-wrap items-start justify-between gap-3 lg:gap-6">
            <div>
              <span className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">{connected ? "Your Bandcamp" : "Your music"}</span>
              <h1 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-3xl lg:text-4xl leading-none font-semibold tracking-tighter text-foreground">{view === "library" ? "Collection" : "Recently added"}</h1>
              <p className="mt-2 mb-0 text-sm text-muted-foreground">
                {syncState === "checking"
                  ? "Checking your saved connection…"
                  : connected
                    ? `${countLabel(albums.length, "release")}, ready when you are.`
                    : "Connect your Bandcamp library to start listening."}
              </p>
            </div>
            <div className="mt-3 flex w-full flex-wrap justify-end gap-2 lg:w-auto">
              {connected ? (
                <label className="flex h-10 w-full flex-[1_1_100%] items-center rounded-md border border-(--line-strong) bg-coda-field px-2.5 text-[#737772] focus-within:border-primary/55 focus-within:ring-3 focus-within:ring-primary/8 lg:w-[clamp(12.5rem,22vw,18.75rem)] lg:flex-none">
                  <Search size={17} />
                  <span className="sr-only">Search collection</span>
                  <Input className="h-full flex-1 border-0 bg-transparent px-2 focus-visible:border-0 focus-visible:ring-0" ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your collection" />
                  <kbd className="grid size-5 place-items-center rounded-sm border border-(--line-strong) font-['Segoe_UI_Variable','Segoe_UI',sans-serif] text-xs leading-none text-[#777a76]">/</kbd>
                </label>
              ) : null}
              {connected && shuffleScopeAlbums.length ? (
                <Button
                  onClick={playRandomVisible}
                  disabled={randomPickLoading || Boolean(libraryShuffleProgress) || syncState === "syncing"}
                  title={`Play one random track from ${shuffleScopeName}`}
                  aria-label={`Play a random track from ${shuffleScopeName}`}
                  variant="artwork"
                >
                  {randomPickLoading ? <Spinner aria-hidden="true" className="size-4" /> : <Dices size={15} />}
                  {randomPickLoading ? "Picking…" : "Surprise me"}
                </Button>
              ) : null}
              {connected && shuffleScopeAlbums.length ? (
                <Button
                  onClick={shuffleVisible}
                  disabled={Boolean(libraryShuffleProgress) || randomPickLoading || syncState === "syncing"}
                  title={`${shuffleActionLabel} and start playing`}
                  variant="artwork"
                >
                  {libraryShuffleProgress ? <Spinner aria-hidden="true" className="size-4" /> : <Shuffle size={15} />}
                  {libraryShuffleProgress
                    ? `${libraryShuffleProgress.done}/${libraryShuffleProgress.total}`
                    : shuffleActionLabel}
                </Button>
              ) : null}
              {connected ? (
                <Button
                  onClick={() => void refreshArtwork()}
                  disabled={artworkRefreshing || syncState === "syncing"}
                  title="Retry artwork and recover missing covers"
                  variant="artwork"
                >
                  {artworkRefreshing ? <Spinner aria-hidden="true" className="size-4" /> : <Images size={15} />}
                  {artworkRefreshing ? "Refreshing…" : "Artwork"}
                </Button>
              ) : null}
              <Button
                onClick={connected ? () => void syncLibrary() : openConnection}
                disabled={syncState === "checking" || syncState === "syncing"}
                variant="primary"
              >
                {syncState === "checking" || syncState === "syncing" ? <Spinner aria-hidden="true" className="size-4 text-current" /> : connected ? <RefreshCw size={16} /> : <Radio size={16} />}
                {syncState === "checking"
                  ? "Checking…"
                  : syncState === "syncing"
                    ? "Syncing…"
                    : connected
                      ? "Sync"
                      : "Connect"}
              </Button>
            </div>
          </header>

          {connected &&
          (syncState === "error" || syncState === "syncing") &&
          Boolean(libraryError) &&
          albums.length ? (
            <section className="mt-6 grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-primary/20 bg-primary/6.5 px-3.5 py-3" role="status">
              <div className="grid size-9 place-items-center rounded-full bg-accent text-[#e68268]"><CircleAlert size={18} /></div>
              <div className="flex flex-col gap-0.5">
                <strong className="text-xs text-[#e8e5df]">Showing your saved collection</strong>
                <span className="text-xs text-muted-foreground">{libraryError || "Bandcamp could not be reached. Your cached library is still available."}</span>
              </div>
              <Button
                className="gap-1 px-2 text-xs text-[#ed8a71]"
                onClick={() => void syncLibrary()}
                disabled={syncState === "syncing"}
                size="compact"
                variant="text"
              >
                {syncState === "syncing"
                  ? <Spinner aria-hidden="true" className="size-4" />
                  : <ChevronRight size={16} />}
                {syncState === "syncing" ? "Syncing…" : "Try again"}
              </Button>
            </section>
          ) : null}

          {connected && albums.length && view === "library" && !selectedAlbum ? (
            <nav className="mt-7 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-[#171a1c] p-1 scrollbar-none [&::-webkit-scrollbar]:hidden" aria-label="Browse collection">
              {LIBRARY_BROWSE_OPTIONS.map(({ mode, label, title }) => {
                const count =
                  mode === "releases"
                    ? albums.length
                    : mode === "artists"
                      ? libraryBrowseCounts.artists
                      : libraryBrowseCounts[mode];
                return (
                  <Button
                    key={mode}
                    className="group min-h-8 gap-2 px-2.5 text-xs text-[#858984] hover:bg-transparent hover:text-[#deddd7] aria-pressed:bg-[#2a2d2f] aria-pressed:text-[#f0eee8] aria-pressed:shadow-[0_1px_4px_rgba(0,0,0,0.22)]"
                    onClick={() => chooseBrowseMode(mode)}
                    aria-pressed={browseMode === mode}
                    size="compact"
                    title={title}
                    variant="ghost"
                  >
                    {label}
                    <Badge className="border-0 bg-white/5.5 text-[#737771] group-aria-pressed:bg-accent group-aria-pressed:text-[#e78d76]" size="compact" variant="secondary">{count}</Badge>
                  </Button>
                );
              })}
            </nav>
          ) : null}

          {connected && albums.length && !selectedAlbum ? (
            <section className={`flex items-center justify-between gap-2 border-b border-border pb-3 lg:gap-4 ${view === "library" ? "mt-3" : "mt-7"}`}>
              <div className="flex min-w-0 items-center gap-1">
                <div className="flex items-center gap-1 overflow-hidden">
                  {["All", ...visibleGenreTabs].map((item) => (
                    <Button
                      key={item}
                      className="h-8 px-3 text-xs font-semibold text-[#888b86] hover:bg-transparent hover:text-[#dddcd7] aria-pressed:bg-coda-active aria-pressed:text-[#f0eee8]"
                      onClick={() => setGenre(item)}
                      aria-pressed={genreKey(genre) === genreKey(item)}
                      size="compact"
                      variant="ghost"
                    >
                      {item}
                    </Button>
                  ))}
                </div>
                {overflowGenres.length ? (
                  <div className="flex h-8 shrink-0 items-center gap-1 rounded-sm border border-border bg-muted px-2 text-[#858984]">
                    <Music2 size={14} />
                    <NativeSelect
                      className="w-auto [&_[data-slot=native-select]]:h-auto [&_[data-slot=native-select]]:max-w-24 [&_[data-slot=native-select]]:border-0 [&_[data-slot=native-select]]:bg-transparent [&_[data-slot=native-select]]:p-0 [&_[data-slot=native-select]]:pr-0 [&_[data-slot=native-select]]:text-xs [&_[data-slot=native-select-icon]]:hidden"
                      value=""
                      aria-label="More collection genres"
                      onChange={(event) => setGenre(event.target.value)}
                      size="sm"
                    >
                      <NativeSelectOption value="" disabled>More genres</NativeSelectOption>
                      {overflowGenres.map((item) => (
                        <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <ChevronDown size={13} />
                  </div>
                ) : null}
              </div>
              {effectiveBrowseMode === "artists" && !selectedArtist ? (
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#777b76] [&>svg]:max-lg:hidden"><ArrowDownUp size={14} /> Artist A–Z</span>
              ) : (
                <div className="flex items-center gap-1.5 text-[#7f837d] [&>svg]:max-lg:hidden">
                  <ArrowDownUp size={15} />
                  <NativeSelect
                    aria-label="Sort collection"
                    className="w-auto [&_[data-slot=native-select]]:h-auto [&_[data-slot=native-select]]:max-w-30 [&_[data-slot=native-select]]:border-0 [&_[data-slot=native-select]]:bg-transparent [&_[data-slot=native-select]]:p-0 [&_[data-slot=native-select]]:pr-0 [&_[data-slot=native-select]]:text-xs [&_[data-slot=native-select-icon]]:hidden"
                    value={sort}
                    onChange={(event) => setSort(event.target.value as SortMode)}
                    size="sm"
                  >
                    <NativeSelectOption value="recent">Recently added</NativeSelectOption>
                    <NativeSelectOption value="artist">Artist A–Z</NativeSelectOption>
                    <NativeSelectOption value="title">Album A–Z</NativeSelectOption>
                    <NativeSelectOption value="year">Release year</NativeSelectOption>
                  </NativeSelect>
                  <ChevronDown size={14} />
                </div>
              )}
            </section>
          ) : null}

          <section className="pt-6" aria-live="polite">
            {selectedAlbum ? (
              <AlbumDetailPage
                album={selectedAlbum}
                loading={loadingAlbumId === selectedAlbum.id}
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
                action={<Button className="mt-3 text-xs text-[#ed8a71]" onClick={openConnection} size="compact" variant="text">Connect Bandcamp <ChevronRight size={15} /></Button>}
              />
            ) : (syncState === "error" || syncState === "syncing") &&
              Boolean(libraryError) &&
              !albums.length ? (
              <EmptyState
                icon={<CircleAlert size={28} />}
                title="Your collection couldn’t load"
                detail={libraryError || "Bandcamp could not be reached. Check your connection and try again."}
                action={(
                  <Button
                    className="mt-3 text-xs text-[#ed8a71]"
                    onClick={() => void syncLibrary()}
                    disabled={syncState === "syncing"}
                    size="compact"
                    variant="text"
                  >
                    {syncState === "syncing"
                      ? <Spinner aria-hidden="true" className="size-3.5" />
                      : <RefreshCw size={14} />}
                    {syncState === "syncing" ? "Syncing…" : "Try syncing again"}
                  </Button>
                )}
              />
            ) : !albums.length ? (
              <EmptyState
                icon={<Library size={28} />}
                title="No releases found"
                detail="Bandcamp connected successfully, but its Subsonic library returned no purchases yet."
                action={(
                  <Button
                    className="mt-3 text-xs text-[#ed8a71]"
                    onClick={() => void syncLibrary()}
                    disabled={syncState === "syncing"}
                    size="compact"
                    variant="text"
                  >
                    {syncState === "syncing"
                      ? <Spinner aria-hidden="true" className="size-3.5" />
                      : <RefreshCw size={14} />}
                    {syncState === "syncing" ? "Checking…" : "Check again"}
                  </Button>
                )}
              />
            ) : effectiveBrowseMode === "artists" && !selectedArtist ? (
              <>
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base leading-none font-semibold tracking-tight">{genre === "All" ? "Artists" : `${genre} artists`}</h2>
                  <span className="text-xs text-[#6f736e]">
                    {countLabel(artistGroups.length, "artist")}
                  </span>
                </div>
                {artistGroups.length ? (
                  <Suspense fallback={<LibrarySkeleton label="Loading artists" />}>
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
                      <Button className="mt-3 text-xs text-[#ed8a71]" onClick={clearLibraryFilters} size="compact" variant="text">Clear filters</Button>
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
                <div className="mb-4 flex items-baseline justify-between">
                  <h2 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base leading-none font-semibold tracking-tight">{releaseSectionTitle}</h2>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[#6f736e]">{countLabel(visibleAlbums.length, "release")}</span>
                    {deferredQuery && visibleAlbums.length ? (
                      <Button
                        className="min-h-8 gap-1.5 border-primary/25 bg-accent px-2.5 text-xs text-[#ed9a84] hover:border-primary/40 hover:bg-primary/18 hover:text-[#ffc1b1]"
                        onClick={() => void queueSearchResults()}
                        disabled={Boolean(queueSearchProgress)}
                        size="compact"
                      >
                        {queueSearchProgress ? (
                          <><Spinner aria-hidden="true" className="size-3.5" /> Adding {queueSearchProgress.done}/{queueSearchProgress.total}</>
                        ) : (
                          <><ListPlus size={15} /> Add results to queue</>
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
                {visibleAlbums.length ? (
                  <Suspense fallback={<LibrarySkeleton label="Loading releases" />}>
                    <AlbumVirtualGrid
                      ariaLabel={releaseSectionTitle}
                      items={visibleAlbums}
                      renderItem={(album) => (
                        <AlbumCard
                          album={album}
                          onOpen={openAlbum}
                          onPrefetch={prefetchAlbum}
                          onPlay={playAlbum}
                          onQueue={queueAlbum}
                          onArtist={browseArtist}
                          active={currentTrack?.albumId === album.id}
                          loading={loadingAlbumId === album.id}
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
                      <Button className="mt-3 text-xs text-[#ed8a71]" onClick={clearLibraryFilters} size="compact" variant="text">Clear filters</Button>
                    ) : undefined}
                  />
                )}
              </>
            )}
          </section>
            </>
          )}
        </main>
        <QueuePanel
            open={queueOpen}
            panelRef={queuePanelRef}
            finalFocus={queueControlRef}
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
            loadingAlbumId={loadingAlbumId}
            playerVisible={!nowPlayingOpen}
          />
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
          albumLoading={Boolean(
            currentTrack && loadingAlbumId === currentTrack.albumId
          )}
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
          queueControlRef={queueControlRef}
        />
      )}
      <MiniPlayerBridge
        track={currentTrack}
        artwork={currentAlbum}
        radioTimeline={currentRadioTimeline}
        playbackClock={playbackClock}
        playing={playing}
        durationSeconds={currentTrack?.duration ?? 0}
        volume={volume}
        canPrevious={canPrevious}
        canNext={canNext}
        onTogglePlayback={togglePlayback}
        onPrevious={previous}
        onNext={next}
        onSeek={seek}
        onSetVolume={setVolume}
        onShowMain={showMainWindow}
      />
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
          appUpdater={appUpdater}
          connected={connected}
          lastFmStatus={lastFmStatus}
          onClose={closeConnection}
          onConnected={handleConnected}
          onDisconnected={handleDisconnect}
          onLastFmStatus={setLastFmStatus}
        />
      ) : null}
      {connectionOpen ? null : <AppUpdatePrompt updater={appUpdater} />}
      {playlistTarget?.length ? (
        <Suspense fallback={<PlaylistDialogFallback />}>
          <AddToPlaylistDialog
            tracks={playlistTarget}
            onClose={() => setPlaylistTarget(undefined)}
            onNotify={notify}
          />
        </Suspense>
      ) : null}
      <div className="pointer-events-none fixed right-4 bottom-28 z-30 flex flex-col items-end gap-2" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex max-w-xs items-center gap-2 rounded-md border border-(--line-strong) bg-[#282b2d] px-3 py-2.5 text-xs text-[#dddcd6] shadow-[0_10px_28px_rgba(0,0,0,0.3)] animate-[toast-in_180ms_ease-out] ${
              toast.tone === "good"
                ? "[&>svg]:text-coda-success"
                : toast.tone === "bad"
                  ? "[&>svg]:text-[#d77868]"
                  : ""
            }`}
          >
            {toast.tone === "good" ? <Check size={16} /> : toast.tone === "bad" ? <X size={16} /> : null}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
    </Drawer>
  );
}
