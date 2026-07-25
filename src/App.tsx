import {
  Airplay,
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Compass,
  Disc3,
  ExternalLink,
  GripVertical,
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
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  lazy,
  memo,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { genreKey, summarizeGenres } from "./genres";
import {
  clearCoverUrlCache,
  clearRuntimeCaches,
  connectBandcamp,
  disconnect,
  fetchAlbum,
  fetchCoverUrl,
  fetchLibrary,
  fetchStreamUrl,
  formatTime,
  hasConnection,
  initials,
  invalidateCoverUrl,
  isDesktop,
  readLibraryCache,
  writeLibraryCache,
} from "./lib";
import { showAirPlayPicker, supportsAirPlayPicker } from "./media";
import { appendUnique, keepCurrentTrack, moveItem, shuffled } from "./queue";
import type { Album, ConnectionInput, RepeatMode, SortMode, Track } from "./types";

type Toast = { id: number; message: string; tone?: "good" | "bad" };
type LibraryView = "library" | "recent" | "discover";
type SyncState = "checking" | "idle" | "syncing" | "error";
const ALBUM_BATCH_SIZE = 80;
const ARTWORK_REFRESH_CONCURRENCY = 4;
const MAX_ARTWORK_DETAILS_PER_REFRESH = 200;
const SEARCH_QUEUE_CONCURRENCY = 6;
const DiscoverView = lazy(() => import("./DiscoverView"));

function albumWithTracks(album: Album, tracks: Track[]): Album {
  return {
    ...album,
    coverArt: album.coverArt ?? tracks.find((track) => track.coverArt)?.coverArt,
    tracks,
  };
}

function CoverArt({
  album,
  size = "card",
}: {
  album: Pick<Album, "id" | "title" | "artist" | "coverArt" | "artworkUrl" | "palette">;
  size?: "card" | "small" | "large";
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
  }, [album.artworkUrl, album.coverArt, requestVersion]);

  const retryImage = () => {
    setUrl(undefined);
    if (!album.coverArt || retryCountRef.current >= 1) return;
    retryCountRef.current += 1;
    invalidateCoverUrl(album.coverArt);
    setRequestVersion((version) => version + 1);
  };

  return (
    <div
      className={`cover cover--${size}`}
      style={
        {
          "--cover-accent": album.palette[0],
          "--cover-base": album.palette[1],
        } as React.CSSProperties
      }
    >
      {url ? (
        <img
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

const AlbumCard = memo(function AlbumCard({
  album,
  onOpen,
  onPlay,
  onQueue,
}: {
  album: Album;
  onOpen: (album: Album) => void;
  onPlay: (album: Album) => void;
  onQueue: (album: Album) => void;
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
          <button onClick={() => onPlay(album)} aria-label={`Play ${album.title}`} title="Play album">
            <Play size={19} fill="currentColor" />
          </button>
        </span>
      </div>
      <div className="album-card__meta">
        <button className="album-card__name" onClick={() => onOpen(album)}>
          {album.title}
        </button>
        <span>{album.artist}</span>
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

function Titlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window")
      .then(async ({ getCurrentWindow }) => {
        const appWindow = getCurrentWindow();
        const update = async () => {
          const next = await appWindow.isMaximized();
          if (!disposed) setMaximized(next);
        };
        await update();
        const stop = await appWindow.onResized(() => void update());
        if (disposed) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => {
        // Standard window controls remain usable if state observation is unavailable.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const windowAction = async (action: "minimize" | "maximize" | "close") => {
    if (!isDesktop()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "maximize") {
      await appWindow.toggleMaximize();
      setMaximized(await appWindow.isMaximized());
    }
    if (action === "close") await appWindow.close();
  };
  const beginWindowDrag = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button"))
    ) {
      return;
    }
    event.preventDefault();
    if (!isDesktop()) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  };

  return (
    <div
      className="titlebar"
      onMouseDown={(event) => void beginWindowDrag(event)}
    >
      <div className="titlebar__brand">
        <span className="brand-mark"><span /></span>
        <span>CODA</span>
      </div>
      <div className="titlebar__drag" />
      <div className="titlebar__controls">
        <button
          onClick={() => windowAction("minimize")}
          aria-label="Minimize"
          title="Minimize"
        >
          <span className="window-control-icon window-control-icon--minimize" />
        </button>
        <button
          onClick={() => windowAction("maximize")}
          aria-label={maximized ? "Restore window" : "Maximize window"}
          title={maximized ? "Restore window" : "Maximize window"}
        >
          {maximized ? (
            <span className="window-control-icon window-control-icon--restore">
              <i />
              <i />
            </span>
          ) : (
            <span className="window-control-icon window-control-icon--maximize" />
          )}
        </button>
        <button
          className="titlebar__close"
          onClick={() => windowAction("close")}
          aria-label="Hide Coda to tray"
          title="Hide to tray"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}

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
        <button className={view === "recent" ? "active" : ""} onClick={() => onView("recent")}>
          <Clock3 size={18} /><span>Recently added</span>
        </button>
        <button className={view === "discover" ? "active" : ""} onClick={() => onView("discover")}>
          <Compass size={18} /><span>Discover</span>
        </button>
        <p className="eyebrow eyebrow--spaced">Listen</p>
        <button onClick={() => document.querySelector(".queue-panel")?.scrollIntoView()}>
          <ListMusic size={18} /><span>Queue</span>
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

const QueuePanel = memo(function QueuePanel({
  queue,
  currentIndex,
  currentTrack,
  onPlay,
  onRemove,
  onClear,
  onShuffle,
  onMove,
}: {
  queue: Track[];
  currentIndex: number;
  currentTrack?: Track;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onShuffle: () => void;
  onMove: (from: number, to: number) => void;
}) {
  const [dragged, setDragged] = useState<number | null>(null);
  const upcoming = queue.slice(currentIndex + 1);
  const remaining = upcoming.reduce((total, item) => total + item.duration, 0);

  const drop = (event: DragEvent, destination: number) => {
    event.preventDefault();
    if (dragged !== null) onMove(dragged, destination);
    setDragged(null);
  };

  return (
    <aside className="queue-panel">
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
        <div className="queue-now">
          <span className="queue-now__label"><span />Now playing</span>
          <button onClick={() => onPlay(currentIndex)}>
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
            <span className="queue-track__meta">
              <strong>{currentTrack.title}</strong>
              <span>{currentTrack.artist}</span>
            </span>
            <span className="queue-bars"><i /><i /><i /></span>
          </button>
        </div>
      ) : null}

      <div className="queue-list">
        {upcoming.map((track, upcomingIndex) => {
          const absoluteIndex = currentIndex + 1 + upcomingIndex;
          return (
            <div
              className="queue-track"
              key={`${track.id}-${absoluteIndex}`}
              draggable
              onDragStart={() => setDragged(absoluteIndex)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => drop(event, absoluteIndex)}
            >
              <GripVertical className="queue-track__grip" size={15} />
              <button className="queue-track__main" onClick={() => onPlay(absoluteIndex)}>
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
                <span className="queue-track__meta">
                  <strong>{track.title}</strong>
                  <span>{track.artist}</span>
                </span>
              </button>
              <span className="queue-track__duration">{formatTime(track.duration)}</span>
              <button className="icon-button queue-track__remove" onClick={() => onRemove(absoluteIndex)} aria-label={`Remove ${track.title}`} title="Remove">
                <X size={14} />
              </button>
            </div>
          );
        })}
        {!upcoming.length ? (
          <div className="queue-empty">
            <Music2 size={25} />
            <strong>{currentTrack ? "End of the queue" : "Your queue is empty"}</strong>
            <span>{currentTrack ? "Add another album or track to keep listening." : "Use the + button on any release to line up music."}</span>
          </div>
        ) : null}
      </div>

      <div className="queue-panel__footer">
        <span>{upcoming.length} {upcoming.length === 1 ? "track" : "tracks"} next</span>
        <span>{upcoming.length ? `${formatTime(remaining)} remaining` : "Queue ready"}</span>
      </div>
    </aside>
  );
});

function Player({
  track,
  playing,
  currentTime,
  duration,
  volume,
  repeat,
  onToggle,
  onPrevious,
  onNext,
  onSeek,
  onVolume,
  onRepeat,
  airPlayAvailable,
  onAirPlay,
  onShowQueue,
}: {
  track?: Track;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onRepeat: () => void;
  airPlayAvailable: boolean;
  onAirPlay: () => void;
  onShowQueue: () => void;
}) {
  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  return (
    <footer className="player">
      <div className="player__track">
        {track ? (
          <>
            <CoverArt
              size="small"
              album={{ id: track.albumId, title: track.album, artist: track.artist, coverArt: track.coverArt, artworkUrl: track.artworkUrl, palette: track.palette }}
            />
            <div>
              <strong>{track.title}</strong>
              <span>{track.artist} · {track.album}</span>
            </div>
          </>
        ) : (
          <div className="player__placeholder"><Disc3 size={20} /><span>Nothing playing</span></div>
        )}
      </div>
      <div className="player__transport">
        <div className="transport-buttons">
          <button className="icon-button" onClick={onPrevious} disabled={!track} title="Previous" aria-label="Previous"><SkipBack size={18} fill="currentColor" /></button>
          <button className="play-button" onClick={onToggle} disabled={!track} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-button" onClick={onNext} disabled={!track} title="Next" aria-label="Next"><SkipForward size={18} fill="currentColor" /></button>
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
        <button className="icon-button is-active" onClick={onShowQueue} title="Show queue" aria-label="Show queue"><ListMusic size={18} /></button>
      </div>
    </footer>
  );
}

function AlbumDialog({
  album,
  loading,
  onClose,
  onPlayAlbum,
  onQueueAlbum,
  onPlayTrack,
  onQueueTrack,
}: {
  album: Album;
  loading: boolean;
  onClose: () => void;
  onPlayAlbum: () => void;
  onQueueAlbum: () => void;
  onPlayTrack: (track: Track) => void;
  onQueueTrack: (track: Track) => void;
}) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="album-dialog" role="dialog" aria-modal="true" aria-label={album.title}>
        <button className="icon-button dialog-close" onClick={onClose} aria-label="Close album"><X size={19} /></button>
        <header className="album-dialog__hero">
          <CoverArt album={album} size="large" />
          <div>
            <span className="eyebrow">Album</span>
            <h2>{album.title}</h2>
            <p>{album.artist}</p>
            <span className="album-dialog__facts">
              {album.year ?? "—"} · {album.songCount} tracks · {formatTime(album.duration)}
            </span>
            <div className="album-dialog__actions">
              <button className="primary-button" onClick={onPlayAlbum} disabled={loading}>
                <Play size={17} fill="currentColor" /> Play album
              </button>
              <button className="secondary-button" onClick={onQueueAlbum} disabled={loading}>
                <Plus size={17} /> Add to queue
              </button>
            </div>
          </div>
        </header>
        <div className="tracklist">
          <div className="tracklist__head">
            <span>#</span><span>Title</span><span><Clock3 size={14} /></span><span />
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
            album.tracks.map((track) => (
              <div className="track-row" key={track.id}>
                <button className="track-row__number" onClick={() => onPlayTrack(track)} aria-label={`Play ${track.title}`}>
                  <span>{track.track}</span><Play size={13} fill="currentColor" />
                </button>
                <button className="track-row__title" onClick={() => onPlayTrack(track)}>
                  <strong>{track.title}</strong><span>{track.artist}</span>
                </button>
                <span>{formatTime(track.duration)}</span>
                <button className="icon-button" onClick={() => onQueueTrack(track)} title="Add to queue" aria-label={`Add ${track.title} to queue`}>
                  <Plus size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ConnectionDialog({
  connected,
  onClose,
  onConnected,
  onDisconnected,
}: {
  connected: boolean;
  onClose: () => void;
  onConnected: (albums: Album[]) => void;
  onDisconnected: () => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "error">("idle");
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input: ConnectionInput = { username: username.trim(), password };
    if (!input.username || !input.password) return;
    setError("");
    try {
      setState("connecting");
      const library = await connectBandcamp(input);
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
    const settingsUrl = "https://bandcamp.com/settings?pane=fan";
    setError("");
    try {
      if (isDesktop()) {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        await openUrl(settingsUrl);
      } else {
        window.open(settingsUrl, "_blank", "noopener,noreferrer");
      }
    } catch {
      setError("Could not open your browser. Visit bandcamp.com/settings and choose Fan.");
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-title">
        <button className="icon-button dialog-close" onClick={onClose} aria-label="Close"><X size={19} /></button>
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
        <button className="settings-link" onClick={openSettings}>
          <ExternalLink size={16} />
          Sign in and generate credentials
        </button>
        <ol className="connection-dialog__steps">
          <li>Sign in to your Bandcamp fan account in the browser.</li>
          <li>Scroll to Subsonic and choose Generate credentials.</li>
          <li>Return here and enter the generated username and password.</li>
        </ol>
        <form onSubmit={submit}>
          <label>
            Subsonic username
            <input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Generated username" />
          </label>
          <label>
            Subsonic password
            <input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Generated password" />
          </label>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button primary-button--wide" type="submit" disabled={!username.trim() || !password || state === "connecting"}>
            {state === "connecting" ? <RefreshCw className="spin" size={17} /> : <Radio size={17} />}
            {state === "connecting" ? "Connecting securely…" : "Connect Bandcamp"}
          </button>
        </form>
        {connected ? (
          <button className="danger-button" onClick={onDisconnected}>Disconnect and remove credentials</button>
        ) : null}
        <small>Bandcamp’s Subsonic service is currently in beta. Coda is an independent client and is not affiliated with Bandcamp.</small>
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
  const [albums, setAlbums] = useState<Album[]>(() => readLibraryCache());
  const [connected, setConnected] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("checking");
  const [libraryError, setLibraryError] = useState("");
  const [view, setView] = useState<LibraryView>("library");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("recent");
  const [genre, setGenre] = useState("All");
  const [albumLimit, setAlbumLimit] = useState(ALBUM_BATCH_SIZE);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(0.72);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [selectedAlbum, setSelectedAlbum] = useState<Album>();
  const [albumLoading, setAlbumLoading] = useState(false);
  const [artworkRefreshing, setArtworkRefreshing] = useState(false);
  const [queueSearchProgress, setQueueSearchProgress] = useState<{ done: number; total: number }>();
  const [libraryShuffleProgress, setLibraryShuffleProgress] = useState<{ done: number; total: number }>();
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [streamUrl, setStreamUrl] = useState<string>();
  const [airPlayAvailable, setAirPlayAvailable] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLButtonElement>(null);
  const libraryShuffleActiveRef = useRef(false);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const currentTrack = queue[currentIndex];

  const notify = useCallback((message: string, tone?: Toast["tone"]) => {
    const id = Date.now();
    setToasts((items) => [...items, { id, message, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 2800);
  }, []);

  const syncLibrary = useCallback(async (announce = true) => {
    setSyncState("syncing");
    setLibraryError("");
    try {
      const library = await fetchLibrary();
      setAlbums(library);
      setConnected(true);
      setSyncState("idle");
      if (announce) notify(`${library.length} albums synced`, "good");
    } catch (cause) {
      const message = String(cause).replace(/^Error:\s*/, "");
      setLibraryError(message);
      setSyncState("error");
      if (announce) notify(message, "bad");
    }
  }, [notify]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const available = await hasConnection();
        if (!active) return;
        setConnected(available);
        if (available) {
          await syncLibrary(false);
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
    };
  }, [syncLibrary]);

  useEffect(() => {
    if (!currentTrack || (!currentTrack.streamUrl && !connected)) {
      setStreamUrl(undefined);
      return;
    }
    if (currentTrack.streamUrl) {
      setStreamUrl(currentTrack.streamUrl);
      return;
    }
    let active = true;
    setStreamUrl(undefined);
    fetchStreamUrl(currentTrack.id)
      .then((url) => {
        if (active) setStreamUrl(url);
      })
      .catch((cause) => {
        if (active) notify(String(cause), "bad");
      });
    return () => {
      active = false;
    };
  }, [currentTrack?.id, currentTrack?.streamUrl, connected, notify]);

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

  const next = useCallback(() => {
    setCurrentTime(0);
    setCurrentIndex((index) => {
      if (repeat === "one") return index;
      if (index + 1 < queue.length) return index + 1;
      if (repeat === "all") return 0;
      setPlaying(false);
      return index;
    });
  }, [queue.length, repeat]);

  const previous = useCallback(() => {
    if (currentTime > 4) {
      setCurrentTime(0);
      if (audioRef.current) audioRef.current.currentTime = 0;
      return;
    }
    setCurrentTime(0);
    setCurrentIndex((index) => Math.max(0, index - 1));
  }, [currentTime]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        if (event.key === "Escape") (event.target as HTMLElement).blur();
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

  const visibleAlbums = useMemo(() => {
    const list = albums.filter((album) => {
      if (genre !== "All" && genreKey(album.genre) !== genreKey(genre)) return false;
      if (deferredQuery && !`${album.title} ${album.artist} ${album.genre ?? ""}`.toLowerCase().includes(deferredQuery)) return false;
      return true;
    });
    const sorted = [...list].sort((a, b) => {
      if (sort === "artist") return a.artist.localeCompare(b.artist);
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "year") return (b.year ?? 0) - (a.year ?? 0);
      return (b.addedAt ?? "").localeCompare(a.addedAt ?? "");
    });
    return view === "recent" ? sorted.slice(0, 12) : sorted;
  }, [albums, deferredQuery, genre, sort, view]);
  const renderedAlbums = visibleAlbums.slice(0, albumLimit);

  useEffect(() => {
    setAlbumLimit(ALBUM_BATCH_SIZE);
  }, [deferredQuery, genre, sort, view]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || albumLimit >= visibleAlbums.length) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setAlbumLimit((limit) => Math.min(limit + ALBUM_BATCH_SIZE, visibleAlbums.length));
        }
      },
      { rootMargin: "500px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [albumLimit, visibleAlbums.length]);

  const ensureTracks = useCallback(async (album: Album): Promise<Album> => {
    if (album.tracks?.length) {
      const hydrated = albumWithTracks(album, album.tracks);
      if (hydrated.coverArt !== album.coverArt) {
        setAlbums((items) => {
          const updated = items.map((item) => item.id === album.id ? hydrated : item);
          writeLibraryCache(updated);
          return updated;
        });
        setSelectedAlbum((item) => item?.id === album.id ? hydrated : item);
      }
      return hydrated;
    }
    setAlbumLoading(true);
    try {
      const tracks = await fetchAlbum(album);
      const hydrated = albumWithTracks(album, tracks);
      setAlbums((items) => {
        const updated = items.map((item) => item.id === album.id ? hydrated : item);
        if (hydrated.coverArt !== album.coverArt) writeLibraryCache(updated);
        return updated;
      });
      setSelectedAlbum((item) => item?.id === album.id ? hydrated : item);
      return hydrated;
    } finally {
      setAlbumLoading(false);
    }
  }, []);

  const openAlbum = useCallback(async (album: Album) => {
    setSelectedAlbum(album);
    try {
      await ensureTracks(album);
    } catch (cause) {
      notify(String(cause), "bad");
    }
  }, [ensureTracks, notify]);

  const playAlbum = useCallback(async (album: Album) => {
    try {
      const ready = await ensureTracks(album);
      if (!ready.tracks?.length) return;
      setQueue(ready.tracks);
      setCurrentIndex(0);
      setCurrentTime(0);
      setPlaying(true);
    } catch (cause) {
      notify(String(cause), "bad");
    }
  }, [ensureTracks, notify]);

  const queueAlbum = useCallback(async (album: Album) => {
    try {
      const ready = await ensureTracks(album);
      if (!ready.tracks) return;
      setQueue((items) => appendUnique(items, ready.tracks!));
      notify(`${album.title} added to queue`, "good");
    } catch (cause) {
      notify(String(cause), "bad");
    }
  }, [ensureTracks, notify]);

  const queueSearchResults = useCallback(async () => {
    if (queueSearchProgress || !visibleAlbums.length) return;
    const targets = [...visibleAlbums];
    const hydrated = new Map<string, Album>();
    const tracksByAlbum: Track[][] = Array.from({ length: targets.length }, () => []);
    let cursor = 0;
    let completed = 0;
    setQueueSearchProgress({ done: 0, total: targets.length });

    const worker = async () => {
      while (cursor < targets.length) {
        const index = cursor;
        cursor += 1;
        const album = targets[index];
        try {
          const tracks = album.tracks?.length ? album.tracks : await fetchAlbum(album);
          const ready = albumWithTracks(album, tracks);
          hydrated.set(album.id, ready);
          tracksByAlbum[index] = tracks;
        } catch {
          // Keep loading the rest when an individual release is unavailable.
        } finally {
          completed += 1;
          if (completed === targets.length || completed % 4 === 0) {
            setQueueSearchProgress({ done: completed, total: targets.length });
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
      const tracks = tracksByAlbum.flat();
      if (hydrated.size) {
        setAlbums((items) => {
          const updated = items.map((album) => hydrated.get(album.id) ?? album);
          if (Array.from(hydrated.values()).some((album) => album.coverArt)) {
            writeLibraryCache(updated);
          }
          return updated;
        });
      }
      setQueue((items) => appendUnique(items, tracks));
      notify(
        tracks.length
          ? `${tracks.length} tracks from ${hydrated.size} search results added`
          : "No playable tracks were returned for those results.",
        tracks.length ? "good" : "bad",
      );
    } finally {
      setQueueSearchProgress(undefined);
    }
  }, [notify, queueSearchProgress, visibleAlbums]);

  const shuffleLibrary = useCallback(async () => {
    if (libraryShuffleActiveRef.current || !connected || !albums.length) return;
    libraryShuffleActiveRef.current = true;
    const targets = shuffled(albums);
    const hydrated = new Map<string, Album>();
    const loadedTracks: Track[][] = Array.from({ length: targets.length }, () => []);
    let cursor = 0;
    let completed = 0;
    setLibraryShuffleProgress({ done: 0, total: targets.length });

    const worker = async () => {
      while (cursor < targets.length) {
        const index = cursor;
        cursor += 1;
        const album = targets[index];
        try {
          const tracks = album.tracks?.length ? album.tracks : await fetchAlbum(album);
          hydrated.set(album.id, albumWithTracks(album, tracks));
          loadedTracks[index] = tracks;
        } catch {
          // A removed or unavailable release should not block the rest of the shuffle.
        } finally {
          completed += 1;
          if (completed === targets.length || completed % 5 === 0) {
            setLibraryShuffleProgress({ done: completed, total: targets.length });
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
      const tracks = shuffled(loadedTracks.flat());
      if (!tracks.length) {
        notify("Bandcamp did not return any playable tracks.", "bad");
        return;
      }
      setAlbums((items) => {
        const updated = items.map((album) => hydrated.get(album.id) ?? album);
        writeLibraryCache(updated);
        return updated;
      });
      setQueue(tracks);
      setCurrentIndex(0);
      setCurrentTime(0);
      setPlaying(true);
      notify(
        `${tracks.length} tracks from ${hydrated.size} releases shuffled`,
        "good",
      );
    } finally {
      libraryShuffleActiveRef.current = false;
      setLibraryShuffleProgress(undefined);
    }
  }, [albums, connected, notify]);

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
    setCurrentTime(0);
    setPlaying(true);
  }, [currentIndex]);

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
        setCurrentTime(0);
      }
      return nextQueue;
    });
  }, []);

  const clearQueue = useCallback(() => {
    if (currentTrack) {
      setQueue((items) => keepCurrentTrack(items, currentIndex));
      setCurrentIndex(0);
      return;
    }
    setQueue([]);
    setCurrentIndex(0);
    setCurrentTime(0);
    setPlaying(false);
    setStreamUrl(undefined);
    setSelectedAlbum(undefined);
  }, [currentIndex, currentTrack]);

  const seek = useCallback((value: number) => {
    setCurrentTime(value);
    if (audioRef.current) audioRef.current.currentTime = value;
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeat((value) => value === "off" ? "all" : value === "all" ? "one" : "off");
  }, []);

  const refreshArtwork = useCallback(async () => {
    if (artworkRefreshing) return;
    setArtworkRefreshing(true);
    clearCoverUrlCache();
    window.dispatchEvent(new Event("coda:refresh-artwork"));

    const missing = albums
      .filter((album) => !album.coverArt)
      .slice(0, MAX_ARTWORK_DETAILS_PER_REFRESH);
    const recovered = new Map<string, Album>();
    let cursor = 0;

    const worker = async () => {
      while (cursor < missing.length) {
        const album = missing[cursor];
        cursor += 1;
        try {
          const tracks = await fetchAlbum(album);
          const hydrated = albumWithTracks(album, tracks);
          if (hydrated.coverArt) recovered.set(album.id, hydrated);
        } catch {
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
      if (recovered.size) {
        setAlbums((items) => {
          const updated = items.map((album) => recovered.get(album.id) ?? album);
          writeLibraryCache(updated);
          return updated;
        });
        setSelectedAlbum((album) => album ? recovered.get(album.id) ?? album : album);
      }

      const unchecked = Math.max(0, albums.filter((album) => !album.coverArt).length - missing.length);
      if (recovered.size) {
        notify(
          `${recovered.size} missing ${recovered.size === 1 ? "cover" : "covers"} recovered`,
          "good",
        );
      } else if (missing.length || unchecked) {
        notify("Artwork links refreshed; Bandcamp did not return additional missing covers.");
      } else {
        notify("Artwork refreshed", "good");
      }
    } finally {
      setArtworkRefreshing(false);
    }
  }, [albums, artworkRefreshing, notify]);

  const handleDisconnect = useCallback(async () => {
    await disconnect();
    clearRuntimeCaches();
    setConnected(false);
    setAlbums([]);
    setQueue([]);
    setCurrentIndex(0);
    setCurrentTime(0);
    setPlaying(false);
    setLibraryError("");
    setSyncState("idle");
    notify("Bandcamp credentials removed", "good");
    setConnectionOpen(false);
  }, [notify]);

  const showQueue = useCallback(() => {
    document.querySelector(".queue-panel")?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const playQueueIndex = useCallback((index: number) => {
    setCurrentIndex(index);
    setCurrentTime(0);
    setPlaying(true);
  }, []);

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
  const closeAlbum = useCallback(() => setSelectedAlbum(undefined), []);
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
    setAlbums(library);
    setConnected(true);
    setLibraryError("");
    setSyncState("idle");
    notify(`${library.length} albums synced`, "good");
  }, [notify]);

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
    syncState === "checking" || (connected && syncState === "syncing" && !albums.length);
  const hasActiveFilters = Boolean(query.trim()) || genre !== "All";

  return (
    <div className="app-shell">
      <Titlebar />
      <div className="app-body">
        <Sidebar view={view} onView={setView} connected={connected} onConnect={openConnection} />
        <main className="library-pane">
          {view === "discover" ? (
            <Suspense fallback={<LibrarySkeleton />}>
              <DiscoverView onPlay={playTrack} onQueue={queueTrack} />
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
                    ? `${albums.length} ${albums.length === 1 ? "release" : "releases"}, ready when you are.`
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
              {connected ? (
                <button
                  className="artwork-button"
                  onClick={() => void shuffleLibrary()}
                  disabled={Boolean(libraryShuffleProgress) || syncState === "syncing"}
                  title="Load every release and shuffle the whole library"
                >
                  {libraryShuffleProgress ? <RefreshCw size={15} className="spin" /> : <Shuffle size={15} />}
                  {libraryShuffleProgress
                    ? `${libraryShuffleProgress.done}/${libraryShuffleProgress.total}`
                    : "Shuffle all"}
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
                  Artwork
                </button>
              ) : null}
              <button
                className="sync-button"
                onClick={connected ? () => void syncLibrary() : openConnection}
                disabled={syncState === "checking" || syncState === "syncing"}
              >
                {syncState === "checking" || syncState === "syncing" ? <RefreshCw size={16} className="spin" /> : connected ? <RefreshCw size={16} /> : <Radio size={16} />}
                {connected ? "Sync" : "Connect"}
              </button>
            </div>
          </header>

          {connected && syncState === "error" && albums.length ? (
            <section className="sync-notice" role="status">
              <div className="sync-notice__icon"><CircleAlert size={18} /></div>
              <div>
                <strong>Showing your saved collection</strong>
                <span>{libraryError || "Bandcamp could not be reached. Your cached library is still available."}</span>
              </div>
              <button onClick={() => void syncLibrary()}>Try again <ChevronRight size={16} /></button>
            </section>
          ) : null}

          {connected && albums.length ? (
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
            </section>
          ) : null}

          <section className="album-section" aria-live="polite">
            {isInitialLoading ? (
              <LibrarySkeleton />
            ) : !connected ? (
              <EmptyState
                icon={<Radio size={28} />}
                title="Your collection starts here"
                detail="Connect the separate Subsonic credentials from your Bandcamp fan settings. Your password stays in the system vault."
                action={<button onClick={openConnection}>Connect Bandcamp <ChevronRight size={15} /></button>}
              />
            ) : syncState === "error" && !albums.length ? (
              <EmptyState
                icon={<CircleAlert size={28} />}
                title="Your collection couldn’t load"
                detail={libraryError || "Bandcamp could not be reached. Check your connection and try again."}
                action={<button onClick={() => void syncLibrary()}>Try syncing again <RefreshCw size={14} /></button>}
              />
            ) : !albums.length ? (
              <EmptyState
                icon={<Library size={28} />}
                title="No releases found"
                detail="Bandcamp connected successfully, but its Subsonic library returned no purchases yet."
                action={<button onClick={() => void syncLibrary()}>Check again <RefreshCw size={14} /></button>}
              />
            ) : (
              <>
                <div className="section-heading">
                  <h2>{genre === "All" ? "All releases" : genre}</h2>
                  <div className="section-heading__actions">
                    <span>{visibleAlbums.length} {visibleAlbums.length === 1 ? "album" : "albums"}</span>
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
                  <>
                    <div className="album-grid">
                      {renderedAlbums.map((album) => (
                        <AlbumCard key={album.id} album={album} onOpen={openAlbum} onPlay={playAlbum} onQueue={queueAlbum} />
                      ))}
                    </div>
                    {renderedAlbums.length < visibleAlbums.length ? (
                      <button
                        ref={loadMoreRef}
                        className="load-more"
                        onClick={() => setAlbumLimit((limit) => Math.min(limit + ALBUM_BATCH_SIZE, visibleAlbums.length))}
                      >
                        Load more releases
                      </button>
                    ) : null}
                  </>
                ) : (
                  <EmptyState
                    icon={<Search size={28} />}
                    title="Nothing matches those filters"
                    detail="Try a different artist, release title, or genre."
                    action={hasActiveFilters ? (
                      <button onClick={() => { setQuery(""); setGenre("All"); }}>Clear filters</button>
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
          queue={queue}
          currentIndex={currentIndex}
          currentTrack={currentTrack}
          onPlay={playQueueIndex}
          onRemove={removeQueueItem}
          onClear={clearQueue}
          onShuffle={shuffleQueue}
          onMove={moveQueueItem}
        />
      </div>
      <Player
        track={currentTrack}
        playing={playing}
        currentTime={currentTime}
        duration={currentTrack?.duration ?? 0}
        volume={volume}
        repeat={repeat}
        onToggle={togglePlayback}
        onPrevious={previous}
        onNext={next}
        onSeek={seek}
        onVolume={setVolume}
        onRepeat={cycleRepeat}
        airPlayAvailable={airPlayAvailable}
        onAirPlay={openAirPlay}
        onShowQueue={showQueue}
      />
      <audio
        ref={audioRef}
        src={streamUrl}
        preload="metadata"
        onTimeUpdate={(event) => {
          const second = Math.floor(event.currentTarget.currentTime);
          setCurrentTime((value) => Math.floor(value) === second ? value : second);
        }}
        onDurationChange={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setCurrentTime(event.currentTarget.currentTime);
        }}
        onEnded={next}
      />
      {selectedAlbum ? (
        <AlbumDialog
          album={selectedAlbum}
          loading={albumLoading}
          onClose={closeAlbum}
          onPlayAlbum={playSelectedAlbum}
          onQueueAlbum={queueSelectedAlbum}
          onPlayTrack={playTrack}
          onQueueTrack={queueTrack}
        />
      ) : null}
      {connectionOpen ? (
        <ConnectionDialog
          connected={connected}
          onClose={closeConnection}
          onConnected={handleConnected}
          onDisconnected={handleDisconnect}
        />
      ) : null}
      <div className="toast-region" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className={`toast toast--${toast.tone ?? "neutral"}`}>{toast.tone === "good" ? <Check size={16} /> : toast.tone === "bad" ? <X size={16} /> : null}{toast.message}</div>)}
      </div>
    </div>
  );
}
