import {
  ArrowLeft,
  Check,
  HardDrive,
  Heart,
  ListMusic,
  ListPlus,
  Music2,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { ToastNotifier } from "@/components/ui/toast";
import {
  createPlaylist,
  deletePlaylist,
  fetchCoverUrl,
  fetchPlaylist,
  fetchPlaylists,
  fetchRadioShow,
  formatTime,
  invalidateCoverUrl,
  paletteFor,
  updatePlaylist,
} from "./lib";
import { countLabel } from "./countLabel";
import { shuffled } from "./queue";
import {
  createNavigationTransactionState,
  replaceNavigationTransaction,
  resolveNavigationReturnFocus,
  resolveNavigationReturnScrollTop,
  settleNavigationTransaction,
} from "./navigationTransaction";
import { boundRadioChapters } from "./radioPlayback";
import type {
  Album,
  LocalFavoriteCollection,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistUpdateInput,
  RadioShow,
  RadioShowSummary,
  Track,
} from "./types";
import { transitionCodaView } from "./viewTransitions";
import { VirtualizedSavedTrackList } from "./VirtualizedSavedTrackList";
import { cn } from "@/lib/utils";

export const PLAYLISTS_QUERY_KEY = ["bandcamp", "playlists"] as const;
const playlistQueryKey = (playlistId: string) =>
  [...PLAYLISTS_QUERY_KEY, playlistId] as const;

type SavedLibraryViewProps = {
  mode: "favorites" | "playlists";
  connected: boolean;
  favorites?: LocalFavoriteCollection;
  favoritesLoading: boolean;
  favoritesError?: string;
  favoritesLocal?: boolean;
  loadingAlbumId?: string;
  onRefreshFavorites: () => void;
  onToggleFavorite: (id: string, kind: "song" | "album", favorite: boolean) => void;
  onToggleRadioFavorite: (show: RadioShowSummary, favorite: boolean) => void;
  currentTrackId?: string;
  playing: boolean;
  onTogglePlayback: () => void;
  onPlayTracks: (tracks: Track[]) => void;
  onQueueTracks: (tracks: Track[]) => void;
  onPlayTrack: (track: Track) => void;
  onQueueTrack: (track: Track) => void;
  onOpenAlbum: (album: Album, trigger: HTMLElement) => void;
  onOpenTrackAlbum: (track: Track, trigger: HTMLElement) => void;
  onOpenArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
  ) => void;
  onOpenRadioShow: (show: RadioShowSummary) => void;
  onOpenRadioSeries: (seriesId?: number) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onNotify: ToastNotifier;
};

const RADIO_STALE_TIME_MS = 10 * 60 * 1_000;
const playlistTrackKey = (track: Track, index: number) => `${track.id}-${index}`;
const favoriteTrackKey = (track: Track) => track.id;
const radioDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const eyebrowClassName =
  "mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase";
const metadataLinkClassName =
  "h-auto min-w-0 max-w-[48%] cursor-pointer truncate rounded-none border-0 bg-transparent p-0 text-left text-xs font-normal text-[#777b76] hover:text-accent-foreground";
const savedPageClassName =
  "mx-auto min-h-full w-full max-w-5xl pt-2 pb-12";

type PlaylistListMutationContext = {
  optimisticId?: string;
  previousPlaylists?: PlaylistSummary[];
};

type PlaylistDetailMutationContext = PlaylistListMutationContext & {
  previousPlaylist?: PlaylistDetail;
};

function playlistSummary(playlist: PlaylistDetail): PlaylistSummary {
  const { tracks: _tracks, ...summary } = playlist;
  return summary;
}

function upsertPlaylistSummary(
  playlists: PlaylistSummary[] | undefined,
  playlist: PlaylistSummary,
): PlaylistSummary[] {
  const current = playlists ?? [];
  const existing = current.findIndex((item) => item.id === playlist.id);
  if (existing < 0) return [playlist, ...current];
  return current.map((item, index) => index === existing ? playlist : item);
}

function replaceOptimisticPlaylist(
  playlists: PlaylistSummary[] | undefined,
  optimisticId: string | undefined,
  playlist: PlaylistSummary,
): PlaylistSummary[] {
  if (!optimisticId) return upsertPlaylistSummary(playlists, playlist);
  const current = playlists ?? [];
  const optimisticIndex = current.findIndex((item) => item.id === optimisticId);
  if (optimisticIndex < 0) return upsertPlaylistSummary(current, playlist);
  return current.map((item, index) => index === optimisticIndex ? playlist : item);
}

function optimisticPlaylistId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `optimistic:${randomId ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function isOptimisticPlaylist(playlist: PlaylistSummary): boolean {
  return playlist.id.startsWith("optimistic:");
}

function restorePlaylistList(
  queryClient: QueryClient,
  previousPlaylists: PlaylistSummary[] | undefined,
): void {
  if (previousPlaylists === undefined) {
    queryClient.removeQueries({
      queryKey: PLAYLISTS_QUERY_KEY,
      exact: true,
    });
    return;
  }
  queryClient.setQueryData(PLAYLISTS_QUERY_KEY, previousPlaylists);
}

function restorePlaylistMutation(
  queryClient: QueryClient,
  playlistId: string,
  context: PlaylistDetailMutationContext,
): void {
  restorePlaylistList(queryClient, context.previousPlaylists);
  const detailKey = playlistQueryKey(playlistId);
  if (context.previousPlaylist === undefined) {
    queryClient.removeQueries({ queryKey: detailKey, exact: true });
    return;
  }
  queryClient.setQueryData(detailKey, context.previousPlaylist);
}

function revalidateCommittedPlaylist(
  queryClient: QueryClient,
  playlistId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: playlistQueryKey(playlistId),
    exact: true,
  });
  void queryClient.invalidateQueries({
    queryKey: PLAYLISTS_QUERY_KEY,
    exact: true,
    refetchType: "none",
  });
}

function removedPlaylistTracks(
  playlist: PlaylistDetail,
  indexes: readonly number[],
): PlaylistDetail {
  const removals = new Set(
    indexes.filter((index) => Number.isInteger(index) && index >= 0),
  );
  const tracks = playlist.tracks.filter((_track, index) => !removals.has(index));
  return {
    ...playlist,
    duration: tracks.reduce((total, track) => total + track.duration, 0),
    songCount: tracks.length,
    tracks,
  };
}

function addedPlaylistTracks(
  playlist: PlaylistDetail,
  tracksToAdd: readonly Track[],
): PlaylistDetail {
  const existing = new Set(playlist.tracks.map((track) => track.id));
  const additions = tracksToAdd.filter((track) => {
    if (existing.has(track.id)) return false;
    existing.add(track.id);
    return true;
  });
  const tracks = [...playlist.tracks, ...additions];
  return {
    ...playlist,
    duration: tracks.reduce((total, track) => total + track.duration, 0),
    songCount: tracks.length,
    tracks,
  };
}

function mutationError(cause: unknown): string {
  return String(cause).replace(/^Error:\s*/, "");
}

function radioShowDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : radioDateFormatter.format(parsed);
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

function Eyebrow({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return <span className={cn(eyebrowClassName, className)} {...props} />;
}

function FavoriteArtwork({
  className,
  item,
}: {
  className?: string;
  item: Pick<Album, "title" | "coverArt" | "artworkUrl" | "palette">;
}) {
  const [url, setUrl] = useState(item.artworkUrl);
  const [requestVersion, setRequestVersion] = useState(0);
  const coverIdRef = useRef(item.coverArt);
  const retryCountRef = useRef(0);

  useEffect(() => {
    let active = true;
    if (coverIdRef.current !== item.coverArt) {
      coverIdRef.current = item.coverArt;
      retryCountRef.current = 0;
    }
    if (item.artworkUrl) {
      setUrl(item.artworkUrl);
      return;
    }
    setUrl(undefined);
    if (!item.coverArt) {
      return;
    }
    fetchCoverUrl(item.coverArt)
      .then((nextUrl) => {
        if (active) setUrl(nextUrl);
      })
      .catch(() => {
        if (active) setUrl(undefined);
      });
    return () => {
      active = false;
    };
  }, [item.artworkUrl, item.coverArt, requestVersion]);

  const retryImage = () => {
    setUrl(undefined);
    if (!item.coverArt || retryCountRef.current >= 1) return;
    retryCountRef.current += 1;
    invalidateCoverUrl(item.coverArt);
    setRequestVersion((version) => version + 1);
  };

  return (
    <span
      className={cn(
        "relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-md text-white/70 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]",
        className,
      )}
      style={{
        background: `linear-gradient(145deg, ${item.palette[0]}, ${item.palette[1]})`,
      }}
      aria-hidden="true"
    >
      {url ? (
        <img
          className="size-full object-cover"
          src={url}
          alt=""
          loading="lazy"
          onError={retryImage}
        />
      ) : (
        <Music2 size={20} />
      )}
    </span>
  );
}

function SavedEmpty({
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
    <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-input bg-white/1 p-10 text-center text-muted-foreground">
      <span className="mb-4 grid size-14 place-items-center rounded-full border border-border bg-white/2.5 text-[#8d908b]">
        {icon}
      </span>
      <h2 className="m-0 font-display text-lg/tight font-semibold text-[#d7d6d0]">
        {title}
      </h2>
      <p className="mt-2 mb-4 max-w-sm text-xs/relaxed text-[#777b76]">
        {detail}
      </p>
      {action}
    </div>
  );
}

function PlaylistList({
  playlists,
  onOpen,
  onCreate,
  creating,
  openingPlaylistId,
}: {
  playlists: PlaylistSummary[];
  onOpen: (playlist: PlaylistSummary, trigger: HTMLButtonElement) => void;
  onCreate: (name: string) => void;
  creating: boolean;
  openingPlaylistId?: string;
}) {
  const [name, setName] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    onCreate(nextName);
    setName("");
  };

  return (
    <>
      <form
        className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border bg-[linear-gradient(110deg,rgba(221,101,73,0.075),transparent_46%),var(--panel)] p-5 lg:grid-cols-[minmax(14rem,1fr)_minmax(13rem,0.9fr)_auto]"
        onSubmit={submit}
      >
        <div className="col-span-full flex flex-col items-start lg:col-span-1">
          <Eyebrow className="mb-1">New playlist</Eyebrow>
          <strong className="text-sm text-[#deddd7]">Create a playlist</strong>
          <p className="mt-1 mb-0 text-xs text-[#777b76]">
            Playlists sync with your Bandcamp collection.
          </p>
        </div>
        <Label className="block">
          <span className="sr-only">Playlist name</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={256}
            placeholder="Late-night rotation"
          />
        </Label>
        <Button
          type="submit"
          disabled={!name.trim() || creating}
          variant="primary"
        >
          {creating
            ? <Spinner aria-hidden="true" className="size-4 text-current" />
            : <Plus size={16} />}
          {creating ? "Creating…" : "Create"}
        </Button>
      </form>

      {playlists.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
          {playlists.map((playlist) => {
            const optimistic = isOptimisticPlaylist(playlist);
            const opening = openingPlaylistId === playlist.id;
            return (
              <Button
                aria-busy={optimistic || opening || undefined}
                className="grid h-auto min-h-20 grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-border bg-white/2 p-3.5 text-left font-normal transition-[border-color,background-color,transform] duration-(--duration-coda-fast) hover:-translate-y-px hover:border-input hover:bg-white/3.5"
                disabled={optimistic || opening}
                data-playlist-open={playlist.id}
                key={playlist.id}
                onClick={(event) => onOpen(playlist, event.currentTarget)}
              >
                <span className="grid size-13 place-items-center rounded-lg border border-white/7 bg-coda-hover text-[#e1846d]">
                  <ListMusic size={25} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <OverflowMarquee
                    className="text-xs text-[#dcdbd5]"
                    text={playlist.name}
                  />
                  <span className="mt-1 truncate text-xs text-[#777b76]">
                    {countLabel(playlist.songCount, "track")}
                    {playlist.duration ? ` · ${formatTime(playlist.duration)}` : ""}
                  </span>
                  {playlist.comment ? (
                    <small className="mt-1 truncate text-xs text-[#777b76]">
                      {playlist.comment}
                    </small>
                  ) : null}
                </span>
                <span className="flex items-center gap-1 text-xs font-bold text-[#787c77] uppercase">
                  {opening ? (
                    <Spinner
                      aria-label={`Opening ${playlist.name}`}
                      className="size-3 text-current"
                    />
                  ) : null}
                  {optimistic ? "Creating…" : opening ? "Opening…" : "Open"}
                </span>
              </Button>
            );
          })}
        </div>
      ) : (
        <SavedEmpty
          icon={<ListMusic size={28} />}
          title="No playlists yet"
          detail="Name your first mix above, then add tracks from an album, Favorites, or Now Playing."
        />
      )}
    </>
  );
}

function PlaylistDetailView({
  playlist,
  loading,
  onBack,
  onPlay,
  onQueue,
  currentTrackId,
  playing,
  loadingAlbumId,
  onTogglePlayback,
  onAddToPlaylist,
  onOpenTrackAlbum,
  onOpenArtist,
  onRename,
  onRemove,
  onDelete,
  actionPending,
  pendingRemovalIndex,
  renaming,
  deleting,
}: {
  playlist?: PlaylistDetail;
  loading: boolean;
  onBack: () => void;
  onPlay: (tracks: Track[]) => void;
  onQueue: (tracks: Track[]) => void;
  currentTrackId?: string;
  playing: boolean;
  loadingAlbumId?: string;
  onTogglePlayback: () => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onOpenTrackAlbum: (track: Track, trigger: HTMLElement) => void;
  onOpenArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
  ) => void;
  onRename: (name: string) => void;
  onRemove: (index: number) => void;
  onDelete: () => void;
  actionPending: boolean;
  pendingRemovalIndex?: number;
  renaming: boolean;
  deleting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activePlaylist = playlist?.tracks.some((track) => track.id === currentTrackId) ?? false;

  useEffect(() => {
    setName(playlist?.name ?? "");
    setEditing(false);
  }, [playlist?.name]);

  if (loading || !playlist) {
    return (
      <div>
        <Button
          className="mb-3 -ml-1 h-auto gap-1.5 p-1 text-xs font-bold"
          onClick={onBack}
          variant="text"
        >
          <ArrowLeft size={15} /> All playlists
        </Button>
        <SavedEmpty
          icon={(
            <Skeleton className="grid size-8 place-items-center rounded-full bg-transparent">
              <Spinner aria-hidden="true" className="size-7 text-current" />
            </Skeleton>
          )}
          title="Loading playlist"
          detail="Pulling the latest track order from Bandcamp…"
        />
      </div>
    );
  }

  const firstTrack = playlist.tracks[0];
  const playlistArtwork = playlist.coverArt ||
      firstTrack?.coverArt ||
      firstTrack?.artworkUrl
    ? {
      artworkUrl: playlist.coverArt ? undefined : firstTrack?.artworkUrl,
      coverArt: playlist.coverArt ?? firstTrack?.coverArt,
      palette: firstTrack?.palette ?? paletteFor(playlist.id),
      title: playlist.name,
    }
    : undefined;

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || nextName === playlist.name) {
      setEditing(false);
      setName(playlist.name);
      return;
    }
    onRename(nextName);
  };

  return (
    <article aria-busy={actionPending}>
      <Button
        className="mb-3 -ml-1 h-auto gap-1.5 p-1 text-xs font-bold"
        onClick={onBack}
        variant="text"
      >
        <ArrowLeft size={15} /> All playlists
      </Button>
      <header className="grid min-h-48 grid-cols-[8rem_minmax(0,1fr)] items-center gap-6 rounded-t-xl border border-border bg-[radial-gradient(circle_at_84%_10%,rgba(221,101,73,0.12),transparent_40%),linear-gradient(135deg,#24282a,#191c1e_72%)] p-7">
        {playlistArtwork ? (
          <FavoriteArtwork
            className="size-32 rounded-lg"
            item={playlistArtwork}
          />
        ) : (
          <span className="grid size-32 place-items-center rounded-lg border border-white/7 bg-coda-hover text-[#e1846d]">
            <ListMusic size={38} />
          </span>
        )}
        <div className="min-w-0">
          <Eyebrow>Bandcamp playlist</Eyebrow>
          {editing ? (
            <form
              className="flex max-w-xl items-center gap-2"
              onSubmit={submitRename}
            >
              <Input
                className="h-11 text-2xl font-semibold"
                autoFocus
                value={name}
                maxLength={256}
                aria-label="Playlist name"
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                type="submit"
                aria-label="Save playlist name"
                disabled={actionPending}
                size="icon"
                variant="ghost"
              >
                {renaming
                  ? <Spinner aria-hidden="true" className="size-4 text-current" />
                  : <Check size={17} />}
              </Button>
              <Button
                type="button"
                aria-label="Cancel renaming"
                disabled={actionPending}
                onClick={() => {
                  setEditing(false);
                  setName(playlist.name);
                }}
                size="icon"
                variant="ghost"
              >
                <X size={17} />
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <h1
                id="playlist-detail-heading"
                className="m-0 max-w-2xl truncate font-display text-4xl leading-none font-semibold tracking-tighter text-[#f1efe9] outline-none"
                tabIndex={-1}
              >
                {playlist.name}
              </h1>
              <Button
                onClick={() => setEditing(true)}
                aria-label={`Rename ${playlist.name}`}
                size="icon"
                variant="ghost"
              >
                <Pencil size={15} />
              </Button>
            </div>
          )}
          <p className="mt-2 mb-0 text-xs text-[#858984]">
            {countLabel(playlist.songCount, "track")}
            {playlist.duration ? ` · ${formatTime(playlist.duration)}` : ""}
            {" · Synced with Bandcamp"}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              className={cn(
                activePlaylist &&
                  "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_8px_24px_rgba(221,101,73,0.16)]",
                activePlaylist && playing && "bg-[color-mix(in_srgb,var(--primary)_82%,#17191b)]",
              )}
              disabled={!playlist.tracks.length}
              onClick={
                activePlaylist
                  ? onTogglePlayback
                  : () => onPlay(playlist.tracks)
              }
              aria-label={
                activePlaylist
                  ? `${playing ? "Pause" : "Resume"} ${playlist.name}`
                  : "Play"
              }
              aria-pressed={activePlaylist && playing}
              variant="primary"
            >
              <PlaybackIcon
                className="size-4"
                playing={activePlaylist && playing}
              />
              {activePlaylist ? (playing ? "Pause" : "Resume") : "Play"}
            </Button>
            <Button
              disabled={!playlist.tracks.length}
              onClick={() => onPlay(shuffled(playlist.tracks))}
            >
              <Shuffle size={16} /> Shuffle
            </Button>
            <Button
              disabled={!playlist.tracks.length}
              onClick={() => onQueue(playlist.tracks)}
            >
              <ListPlus size={16} /> Add to queue
            </Button>
          </div>
        </div>
      </header>

      {playlist.tracks.length ? (
        <VirtualizedSavedTrackList
          aria-label={`${playlist.name} tracks`}
          className="rounded-b-lg border border-t-0 border-border bg-coda-field"
          getItemKey={playlistTrackKey}
          items={playlist.tracks}
          rowHeight={64}
          renderItem={(track, { index }, rowProps) => {
            const activeTrack = currentTrackId === track.id;
            const albumLoading = loadingAlbumId === track.albumId;
            return (
            <div
              {...rowProps}
              className={cn(
                "group relative grid h-16 grid-cols-[2rem_2.5rem_minmax(0,1fr)_3rem_repeat(2,2rem)] items-center gap-x-2 py-3 pr-3 pl-1 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-white/5 last:after:hidden hover:bg-white/3 lg:grid-cols-[2rem_2.5rem_minmax(0,1fr)_4rem_repeat(2,2rem)]",
                activeTrack && "bg-primary/7.5",
              )}
            >
              <Button
                className={cn(
                  "group/number size-full rounded-none p-0 text-xs font-normal text-[#777a76] hover:bg-transparent",
                  activeTrack && "text-[#e88c75]",
                )}
                onClick={activeTrack ? onTogglePlayback : () => onPlay([track])}
                aria-label={
                  activeTrack
                    ? `${playing ? "Pause" : "Resume"} ${track.title}`
                    : `Play ${track.title}`
                }
                aria-pressed={activeTrack && playing}
                variant="ghost"
              >
                <span className={activeTrack ? "hidden" : "group-hover:hidden"}>
                  {index + 1}
                </span>
                <PlaybackIcon
                  className={cn(
                    "size-3.5",
                    !activeTrack && "hidden group-hover:inline-grid",
                  )}
                  playing={activeTrack && playing}
                />
              </Button>
              <FavoriteArtwork item={track} />
              <div className="flex min-w-0 flex-col gap-1">
                <Button
                  className={cn(
                    "h-auto w-fit max-w-full justify-start overflow-hidden rounded-none p-0 text-xs text-[#d9d8d2] hover:bg-transparent hover:text-accent-foreground",
                    activeTrack && "text-[#f0d7cf]",
                  )}
                  onClick={activeTrack ? onTogglePlayback : () => onPlay([track])}
                  variant="ghost"
                >
                  <OverflowMarquee className="max-w-full" text={track.title} />
                </Button>
                <span className="flex min-w-0 items-center gap-1">
                  <Button
                    className={metadataLinkClassName}
                    onClick={() =>
                      onOpenArtist(track.artist, track.albumId, track)}
                    variant="ghost"
                  >
                    {track.artist}
                  </Button>
                  <span aria-hidden="true">·</span>
                  <Button
                    aria-busy={albumLoading || undefined}
                    aria-label={`Open ${track.album} album`}
                    className={cn(
                      metadataLinkClassName,
                      "gap-1 disabled:opacity-100",
                    )}
                    data-album-open={track.albumId}
                    data-navigation-slot={`playlist-track:${track.id}`}
                    disabled={albumLoading}
                    onClick={(event) =>
                      onOpenTrackAlbum(track, event.currentTarget)}
                    variant="ghost"
                  >
                    {albumLoading ? (
                      <Spinner
                        aria-label={`Loading ${track.album} album`}
                        className="size-3 text-current"
                      />
                    ) : null}
                    {track.album}
                  </Button>
                </span>
              </div>
              <span className="justify-self-end pr-1 text-right text-xs text-[#777b76] tabular-nums">
                {formatTime(track.duration)}
              </span>
              <Button
                onClick={() => onAddToPlaylist([track])}
                title="Add to another playlist"
                aria-label={`Add ${track.title} to another playlist`}
                size="icon"
                variant="ghost"
              >
                <ListPlus size={15} />
              </Button>
              <Button
                disabled={actionPending}
                onClick={() => onRemove(index)}
                title="Remove from playlist"
                aria-label={`Remove ${track.title} from ${playlist.name}`}
                size="icon"
                variant="ghost"
              >
                {pendingRemovalIndex === index
                  ? <Spinner aria-hidden="true" className="size-4 text-current" />
                  : <X size={15} />}
              </Button>
            </div>
            );
          }}
        />
      ) : (
        <SavedEmpty
          icon={<Music2 size={28} />}
          title="This playlist is ready for its first track"
          detail="Use Add to playlist from an album, Favorites, or Now Playing."
        />
      )}

      <div className="flex min-h-16 items-center justify-end px-1 py-3">
        <AlertDialog
          open={confirmDelete}
          onOpenChange={(open, details) => {
            if (!open && deleting) {
              details.cancel();
              return;
            }
            setConfirmDelete(open);
          }}
        >
          <AlertDialogTrigger
            render={(
              <Button
                className="text-coda-danger-foreground"
                size="compact"
                variant="text"
              />
            )}
          >
            <Trash2 size={14} /> Delete playlist
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {playlist.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Delete “{playlist.name}” from Bandcamp? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={actionPending}>
                Keep playlist
              </AlertDialogCancel>
              <Button
                aria-label="Delete playlist from Bandcamp"
                disabled={actionPending}
                onClick={onDelete}
                variant="danger"
              >
                {deleting
                  ? <Spinner aria-hidden="true" className="size-4 text-current" />
                  : <Trash2 size={14} />}
                {deleting ? "Deleting…" : "Delete playlist"}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </article>
  );
}

export function AddToPlaylistDialog({
  open = true,
  tracks,
  onClose,
  onExited,
  onNotify,
}: {
  open?: boolean;
  tracks: Track[];
  onClose: () => void;
  onExited?: () => void;
  onNotify: ToastNotifier;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const closeDialog = () => {
    const restoreFocus = restoreFocusRef.current;
    onClose();
    window.setTimeout(() => restoreFocus?.focus(), 0);
  };
  const playlists = useQuery({
    queryKey: PLAYLISTS_QUERY_KEY,
    queryFn: fetchPlaylists,
  });
  const songIds = useMemo(() => Array.from(new Set(tracks.map((track) => track.id))), [tracks]);
  const addMutation = useMutation({
    mutationFn: async (playlist: PlaylistSummary) =>
      updatePlaylist({ playlistId: playlist.id, songIdsToAdd: songIds }),
    onMutate: async (target): Promise<PlaylistDetailMutationContext> => {
      const detailKey = playlistQueryKey(target.id);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: PLAYLISTS_QUERY_KEY, exact: true }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const previousPlaylists =
        queryClient.getQueryData<PlaylistSummary[]>(PLAYLISTS_QUERY_KEY);
      const previousPlaylist =
        queryClient.getQueryData<PlaylistDetail>(detailKey);
      const optimisticDetail = previousPlaylist
        ? addedPlaylistTracks(previousPlaylist, tracks)
        : undefined;
      const uniqueTrackCount = new Set(tracks.map((track) => track.id)).size;
      const optimisticSummary = optimisticDetail
        ? playlistSummary(optimisticDetail)
        : {
            ...target,
            duration: target.duration + tracks.reduce(
              (total, track) => total + track.duration,
              0,
            ),
            songCount: target.songCount + uniqueTrackCount,
          };
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => upsertPlaylistSummary(current, optimisticSummary),
      );
      if (optimisticDetail) {
        queryClient.setQueryData(detailKey, optimisticDetail);
      }
      return { previousPlaylist, previousPlaylists };
    },
    onSuccess: (updated, target) => {
      if (updated) {
        queryClient.setQueryData(playlistQueryKey(updated.id), updated);
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) => upsertPlaylistSummary(current, playlistSummary(updated)),
        );
      } else {
        revalidateCommittedPlaylist(queryClient, target.id);
      }
      onNotify(
        `${countLabel(tracks.length, "track")} added to ${updated?.name ?? target.name}`,
        "good",
      );
      closeDialog();
    },
    onError: (cause, target, context) => {
      if (context) restorePlaylistMutation(queryClient, target.id, context);
      onNotify(mutationError(cause), "bad");
    },
  });
  const createMutation = useMutation({
    mutationFn: (playlistName: string) => createPlaylist(playlistName, songIds),
    onMutate: async (playlistName): Promise<PlaylistListMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: PLAYLISTS_QUERY_KEY,
        exact: true,
      });
      const previousPlaylists =
        queryClient.getQueryData<PlaylistSummary[]>(PLAYLISTS_QUERY_KEY);
      const optimisticId = optimisticPlaylistId();
      const optimisticSummary: PlaylistSummary = {
        duration: tracks.reduce((total, track) => total + track.duration, 0),
        id: optimisticId,
        name: playlistName,
        songCount: songIds.length,
      };
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => [optimisticSummary, ...(current ?? [])],
      );
      return { optimisticId, previousPlaylists };
    },
    onSuccess: (created, _playlistName, context) => {
      queryClient.setQueryData(playlistQueryKey(created.id), created);
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => replaceOptimisticPlaylist(
          current,
          context?.optimisticId,
          playlistSummary(created),
        ),
      );
      onNotify(`${created.name} created with ${countLabel(tracks.length, "track")}`, "good");
      closeDialog();
    },
    onError: (cause, _playlistName, context) => {
      if (context) restorePlaylistList(queryClient, context.previousPlaylists);
      onNotify(mutationError(cause), "bad");
    },
  });
  const pending = addMutation.isPending || createMutation.isPending;
  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (nextName) createMutation.mutate(nextName);
  };

  return (
    <Dialog
      open={open}
      onExitComplete={onExited}
      onOpenChange={(open, details) => {
        if (open) return;
        if (pending) {
          details.cancel();
          return;
        }
        closeDialog();
      }}
    >
      <DialogContent
        className="max-h-[min(--spacing(155),calc(100vh-(--spacing(38))))] max-w-120 gap-0 overflow-hidden p-0"
        aria-busy={pending || playlists.isFetching}
        finalFocus={restoreFocusRef}
        initialFocus={nameInputRef}
        showCloseButton={false}
      >
        <DialogHeader className="flex-row items-start justify-between gap-4 px-6 pt-6 pb-4">
          <div>
            <Eyebrow>Bandcamp playlists</Eyebrow>
            <DialogTitle className="font-display text-2xl leading-none font-semibold text-[#efede7]">
              Add to playlist
            </DialogTitle>
            <DialogDescription className="mt-2 text-xs text-[#7c807b]">
              {countLabel(tracks.length, "track")} selected
            </DialogDescription>
          </div>
          <DialogClose
            aria-label="Close add to playlist"
            disabled={pending}
            render={<Button size="icon" variant="ghost" />}
          >
            <X size={18} />
          </DialogClose>
        </DialogHeader>
        <form
          className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-b border-border px-6 pb-5"
          onSubmit={submitCreate}
        >
          <Input
            ref={nameInputRef}
            value={name}
            maxLength={256}
            onChange={(event) => setName(event.target.value)}
            placeholder="Create a new playlist"
            aria-label="New playlist name"
          />
          <Button
            type="submit"
            disabled={!name.trim() || pending}
          >
            {createMutation.isPending
              ? <Spinner aria-hidden="true" className="size-4 text-current" />
              : <Plus size={15} />}
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        <div className="flex max-h-84 scrollbar-thin [scrollbar-color:#3e4142_transparent] flex-col overflow-y-auto p-2">
          {playlists.isLoading ? (
            <span className="flex min-h-28 items-center justify-center gap-2 text-xs text-[#858984]">
              <Skeleton className="grid size-8 place-items-center rounded-full bg-white/2.5">
                <Spinner aria-hidden="true" className="size-4" />
              </Skeleton>
              Loading playlists…
            </span>
          ) : playlists.isError ? (
            <Alert
              className="my-6"
              variant="danger"
            >
              <AlertDescription>
                Couldn’t load playlists.
              </AlertDescription>
              <Button
                className="mt-2 h-auto p-0 text-xs text-current"
                onClick={() => void playlists.refetch()}
                disabled={playlists.isFetching}
                variant="text"
              >
                {playlists.isFetching ? "Trying again…" : "Try again"}
              </Button>
            </Alert>
          ) : playlists.data?.length ? (
            playlists.data.map((playlist) => (
              <Button
                key={playlist.id}
                className="grid h-auto min-h-14 grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-normal hover:bg-white/4.5"
                disabled={pending}
                onClick={() => addMutation.mutate(playlist)}
              >
                <span className="grid size-9 place-items-center rounded-md bg-muted text-[#a16c5f]">
                  <ListMusic size={17} />
                </span>
                <span className="flex min-w-0 flex-col">
                  <strong className="truncate text-xs text-[#d6d5cf]">
                    {playlist.name}
                  </strong>
                  <small className="mt-1 text-xs text-[#757974]">
                    {countLabel(playlist.songCount, "track")}
                  </small>
                </span>
                {addMutation.isPending && addMutation.variables.id === playlist.id
                  ? <Spinner aria-hidden="true" className="size-4 text-current" />
                  : <Plus size={16} />}
              </Button>
            ))
          ) : (
            <span className="flex min-h-28 items-center justify-center gap-2 text-xs text-[#858984]">
              No playlists yet. Create one above.
            </span>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SavedLibraryView({
  mode,
  connected,
  favorites,
  favoritesLoading,
  favoritesError,
  favoritesLocal = false,
  loadingAlbumId,
  onRefreshFavorites,
  onToggleFavorite,
  onToggleRadioFavorite,
  currentTrackId,
  playing,
  onTogglePlayback,
  onPlayTracks,
  onQueueTracks,
  onPlayTrack,
  onQueueTrack,
  onOpenAlbum,
  onOpenTrackAlbum,
  onOpenArtist,
  onOpenRadioShow,
  onOpenRadioSeries,
  onAddToPlaylist,
  onNotify,
}: SavedLibraryViewProps) {
  const queryClient = useQueryClient();
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>();
  const [openingPlaylistId, setOpeningPlaylistId] = useState<string>();
  const playlistNavigationRef = useRef(createNavigationTransactionState());
  const playlistReturnFocusRequestedRef = useRef(false);
  const playlistScrollTopRef = useRef<number | undefined>(undefined);
  const [radioAction, setRadioAction] = useState<{
    id: number;
    action: "play" | "queue";
  }>();
  const closePlaylist = () => {
    const transaction = playlistNavigationRef.current.active;
    playlistReturnFocusRequestedRef.current = Boolean(transaction);
    playlistScrollTopRef.current = transaction
      ? resolveNavigationReturnScrollTop(transaction)
      : 0;
    void transitionCodaView(
      () => setSelectedPlaylistId(undefined),
      "page-back",
    );
  };
  const beginPlaylistNavigation = (
    _playlistId: string,
    sourceTrigger?: HTMLElement,
  ) => {
    const returnScrollTop =
      document.querySelector<HTMLElement>("[data-coda-library-scroll]")
        ?.scrollTop ?? 0;
    playlistReturnFocusRequestedRef.current = false;
    playlistNavigationRef.current = replaceNavigationTransaction(
      playlistNavigationRef.current,
      {
        routeKey: "playlist-detail",
        intent: "forward",
        sourceTrigger,
        returnScrollTop,
        destinationHeadingId: "playlist-detail-heading",
      },
    );
    playlistScrollTopRef.current = 0;
  };
  const playlists = useQuery({
    queryKey: PLAYLISTS_QUERY_KEY,
    queryFn: fetchPlaylists,
    enabled: connected && mode === "playlists",
  });
  const playlist = useQuery({
    queryKey: playlistQueryKey(selectedPlaylistId ?? ""),
    queryFn: () => fetchPlaylist(selectedPlaylistId!),
    enabled: connected && mode === "playlists" && Boolean(selectedPlaylistId),
  });

  useLayoutEffect(() => {
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    if (playlistScrollTopRef.current !== undefined && scrollRoot) {
      scrollRoot.scrollTop = playlistScrollTopRef.current;
      playlistScrollTopRef.current = undefined;
    }

    const transaction = playlistNavigationRef.current.active;
    if (!transaction) return;
    if (selectedPlaylistId) {
      if (!playlist.data || playlist.data.id !== selectedPlaylistId) return;
      document
        .getElementById(transaction.destinationHeadingId)
        ?.focus({ preventScroll: true });
      return;
    }
    if (!playlistReturnFocusRequestedRef.current) return;
    playlistReturnFocusRequestedRef.current = false;
    const replacement = Array.from(
      document.querySelectorAll<HTMLElement>("[data-playlist-open]"),
    ).find(
      (candidate) =>
        candidate.dataset.playlistOpen ===
        transaction.sourceTrigger?.dataset.playlistOpen,
    );
    const result = resolveNavigationReturnFocus(transaction, replacement);
    result.target?.focus({ preventScroll: true });
    playlistNavigationRef.current = settleNavigationTransaction(
      playlistNavigationRef.current,
      transaction.identity,
    );
  }, [playlist.data, selectedPlaylistId]);
  const createMutation = useMutation({
    mutationFn: (name: string) => createPlaylist(name),
    onMutate: async (name): Promise<PlaylistListMutationContext> => {
      await queryClient.cancelQueries({
        queryKey: PLAYLISTS_QUERY_KEY,
        exact: true,
      });
      const previousPlaylists =
        queryClient.getQueryData<PlaylistSummary[]>(PLAYLISTS_QUERY_KEY);
      const optimisticId = optimisticPlaylistId();
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => [{
          duration: 0,
          id: optimisticId,
          name,
          songCount: 0,
        }, ...(current ?? [])],
      );
      return { optimisticId, previousPlaylists };
    },
    onSuccess: (created, _name, context) => {
      queryClient.setQueryData(playlistQueryKey(created.id), created);
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => replaceOptimisticPlaylist(
          current,
          context?.optimisticId,
          playlistSummary(created),
        ),
      );
      beginPlaylistNavigation(
        created.id,
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined,
      );
      void transitionCodaView(
        () => setSelectedPlaylistId(created.id),
        "page-forward",
      );
      onNotify(`${created.name} created`, "good");
    },
    onError: (cause, _name, context) => {
      if (context) restorePlaylistList(queryClient, context.previousPlaylists);
      onNotify(mutationError(cause), "bad");
    },
  });
  const updateMutation = useMutation({
    mutationFn: updatePlaylist,
    onMutate: async (
      input: PlaylistUpdateInput,
    ): Promise<PlaylistDetailMutationContext> => {
      const detailKey = playlistQueryKey(input.playlistId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: PLAYLISTS_QUERY_KEY, exact: true }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const previousPlaylists =
        queryClient.getQueryData<PlaylistSummary[]>(PLAYLISTS_QUERY_KEY);
      const previousPlaylist =
        queryClient.getQueryData<PlaylistDetail>(detailKey);
      let optimisticPlaylist = previousPlaylist;
      if (optimisticPlaylist && input.name !== undefined) {
        optimisticPlaylist = { ...optimisticPlaylist, name: input.name };
      }
      if (optimisticPlaylist && input.songIndexesToRemove?.length) {
        optimisticPlaylist = removedPlaylistTracks(
          optimisticPlaylist,
          input.songIndexesToRemove,
        );
      }
      if (optimisticPlaylist) {
        queryClient.setQueryData(detailKey, optimisticPlaylist);
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) => upsertPlaylistSummary(
            current,
            playlistSummary(optimisticPlaylist),
          ),
        );
      } else if (input.name !== undefined) {
        const nextName = input.name;
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) => current?.map((item) =>
            item.id === input.playlistId
              ? { ...item, name: nextName }
              : item
          ),
        );
      }
      return { previousPlaylist, previousPlaylists };
    },
    onSuccess: (updated, input) => {
      if (updated) {
        queryClient.setQueryData(playlistQueryKey(updated.id), updated);
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) => upsertPlaylistSummary(current, playlistSummary(updated)),
        );
      } else {
        revalidateCommittedPlaylist(queryClient, input.playlistId);
      }
    },
    onError: (cause, input, context) => {
      if (context) {
        restorePlaylistMutation(queryClient, input.playlistId, context);
      }
      onNotify(mutationError(cause), "bad");
    },
  });
  const deleteMutation = useMutation({
    mutationFn: deletePlaylist,
    onMutate: async (playlistId): Promise<PlaylistDetailMutationContext> => {
      const detailKey = playlistQueryKey(playlistId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: PLAYLISTS_QUERY_KEY, exact: true }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const previousPlaylists =
        queryClient.getQueryData<PlaylistSummary[]>(PLAYLISTS_QUERY_KEY);
      const previousPlaylist =
        queryClient.getQueryData<PlaylistDetail>(detailKey);
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => current?.filter((item) => item.id !== playlistId),
      );
      return { previousPlaylist, previousPlaylists };
    },
    onSuccess: (_result, playlistId) => {
      queryClient.removeQueries({
        queryKey: playlistQueryKey(playlistId),
        exact: true,
      });
      closePlaylist();
      onNotify("Playlist deleted", "good");
    },
    onError: (cause, playlistId, context) => {
      if (context) restorePlaylistMutation(queryClient, playlistId, context);
      onNotify(mutationError(cause), "bad");
    },
  });
  const actOnFavoriteRadioShow = async (
    show: RadioShowSummary,
    action: "play" | "queue",
  ) => {
    if (radioAction) return;
    setRadioAction({ id: show.id, action });
    try {
      const details = await queryClient.fetchQuery({
        queryKey: ["bandcamp-radio-show", show.id],
        queryFn: () => fetchRadioShow(show.id),
        staleTime: RADIO_STALE_TIME_MS,
      });
      const track = radioTrack(details);
      if (action === "play") onPlayTrack(track);
      else onQueueTrack(track);
    } catch (cause) {
      onNotify(mutationError(cause), "bad");
    } finally {
      setRadioAction(undefined);
    }
  };

  if (!connected && mode === "playlists") {
    return (
      <section className={savedPageClassName}>
        <SavedEmpty
          icon={<ListMusic size={28} />}
          title="Connect Bandcamp to see playlists"
          detail="Playlists are read from your official Bandcamp Subsonic library."
        />
      </section>
    );
  }

  if (mode === "playlists" && selectedPlaylistId) {
    return (
      <section className={savedPageClassName}>
        {playlist.isError ? (
          <SavedEmpty
            icon={<ListMusic size={28} />}
            title="This playlist couldn’t load"
            detail={mutationError(playlist.error)}
            action={(
              <Button
                onClick={() => void playlist.refetch()}
                disabled={playlist.isFetching}
                size="compact"
              >
                {playlist.isFetching
                  ? <Spinner aria-hidden="true" className="size-4 text-current" />
                  : <RefreshCw size={14} />}
                {playlist.isFetching ? "Trying again…" : "Try again"}
              </Button>
            )}
          />
        ) : (
          <PlaylistDetailView
            playlist={playlist.data}
            loading={playlist.isLoading}
            onBack={() => {
              closePlaylist();
            }}
            onPlay={onPlayTracks}
            onQueue={onQueueTracks}
            currentTrackId={currentTrackId}
            playing={playing}
            loadingAlbumId={loadingAlbumId}
            onTogglePlayback={onTogglePlayback}
            onAddToPlaylist={onAddToPlaylist}
            onOpenTrackAlbum={onOpenTrackAlbum}
            onOpenArtist={onOpenArtist}
            onRename={(name) => updateMutation.mutate({ playlistId: selectedPlaylistId, name })}
            onRemove={(index) => updateMutation.mutate({
              playlistId: selectedPlaylistId,
              songIndexesToRemove: [index],
            })}
            onDelete={() => deleteMutation.mutate(selectedPlaylistId)}
            actionPending={updateMutation.isPending || deleteMutation.isPending}
            pendingRemovalIndex={
              updateMutation.isPending
                ? updateMutation.variables?.songIndexesToRemove?.[0]
                : undefined
            }
            renaming={updateMutation.isPending && Boolean(updateMutation.variables?.name)}
            deleting={deleteMutation.isPending}
          />
        )}
      </section>
    );
  }

  if (mode === "playlists") {
    return (
      <section className={savedPageClassName}>
        <header className="mb-7 flex items-start justify-between gap-6">
          <div>
            <Eyebrow>Synced with Bandcamp</Eyebrow>
            <h1 className="m-0 font-display text-4xl leading-none font-semibold tracking-tighter text-foreground">
              Playlists
            </h1>
            <p className="mt-2 mb-0 text-xs text-muted-foreground">
              Build a sequence here and it follows you to Bandcamp.
            </p>
          </div>
          <Button
            onClick={() => void playlists.refetch()}
            disabled={playlists.isFetching}
            size="compact"
            variant="artwork"
          >
            {playlists.isFetching
              ? <Spinner aria-hidden="true" className="size-4 text-current" />
              : <RefreshCw size={15} />}
            {playlists.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </header>
        {playlists.isLoading ? (
          <SavedEmpty
            icon={(
              <Skeleton className="grid size-8 place-items-center rounded-full bg-transparent">
                <Spinner aria-hidden="true" className="size-7 text-current" />
              </Skeleton>
            )}
            title="Loading playlists"
            detail="Pulling your latest Bandcamp mixes…"
          />
        ) : playlists.isError ? (
          <SavedEmpty
            icon={<ListMusic size={28} />}
            title="Playlists couldn’t load"
            detail={mutationError(playlists.error)}
            action={(
              <Button
                onClick={() => void playlists.refetch()}
                disabled={playlists.isFetching}
                size="compact"
              >
                {playlists.isFetching
                  ? <Spinner aria-hidden="true" className="size-4 text-current" />
                  : <RefreshCw size={14} />}
                {playlists.isFetching ? "Trying again…" : "Try again"}
              </Button>
            )}
          />
        ) : (
          <PlaylistList
            playlists={playlists.data ?? []}
            onOpen={(item, trigger) => {
              const hasCachedDetail = queryClient.getQueryData<PlaylistDetail>(
                playlistQueryKey(item.id),
              ) !== undefined;
              beginPlaylistNavigation(item.id, trigger);
              setOpeningPlaylistId(item.id);
              void transitionCodaView(
                () => {
                  setSelectedPlaylistId(item.id);
                  setOpeningPlaylistId(undefined);
                },
                "page-forward",
                { skipSnapshot: !hasCachedDetail },
              );
            }}
            onCreate={(name) => createMutation.mutate(name)}
            creating={createMutation.isPending}
            openingPlaylistId={openingPlaylistId}
          />
        )}
      </section>
    );
  }

  const favoriteTracks = favorites?.tracks ?? [];
  const favoriteAlbums = favorites?.albums ?? [];
  const favoriteRadioShows = favorites?.radioShows ?? [];
  const activeFavoriteTrack = favoriteTracks.some((track) => track.id === currentTrackId);
  const favoriteTrackCount = favorites?.songIds.length ?? favoriteTracks.length;
  const favoriteAlbumCount = favorites?.albumIds.length ?? favoriteAlbums.length;
  const favoriteRadioShowCount =
    favorites?.radioShowIds?.length ?? favoriteRadioShows.length;
  const favoriteDisplayMetadataCount =
    favoriteTrackCount + favoriteAlbumCount + favoriteRadioShowCount;
  return (
    <section className={savedPageClassName}>
      <header className="mb-8 flex items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-2.5">
          <Eyebrow className="mb-0 inline-flex items-center gap-1.5">
            {favoritesLocal ? <><HardDrive size={12} /> On this device</> : "Your keepers"}
          </Eyebrow>
          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-display text-4xl leading-none font-semibold tracking-tighter text-foreground">
              Favorites
            </h1>
            <p className="m-0 max-w-xl text-xs text-muted-foreground">
              {favoritesLocal
                ? "Your personal shortlist, saved only in Coda on this computer."
                : "Starred releases and tracks from your Bandcamp collection."}
            </p>
          </div>
        </div>
        {!favoritesLocal ? (
          <Button
            onClick={onRefreshFavorites}
            disabled={favoritesLoading}
            size="compact"
            variant="artwork"
          >
            {favoritesLoading
              ? <Spinner aria-hidden="true" className="size-4 text-current" />
              : <RefreshCw size={15} />}
            {favoritesLoading ? "Refreshing…" : "Refresh"}
          </Button>
        ) : null}
      </header>
      {favoritesLoading ? (
        <SavedEmpty
          icon={(
            <Skeleton className="grid size-8 place-items-center rounded-full bg-transparent">
              <Spinner aria-hidden="true" className="size-7 text-current" />
            </Skeleton>
          )}
          title="Loading favorites"
          detail="Looking through your starred Bandcamp music…"
        />
      ) : favoritesError ? (
        <SavedEmpty
          icon={<Heart size={28} />}
          title="Favorites couldn’t load"
          detail={favoritesError}
          action={(
            <Button
              onClick={onRefreshFavorites}
              disabled={favoritesLoading}
              size="compact"
            >
              {favoritesLoading
                ? <Spinner aria-hidden="true" className="size-4 text-current" />
                : <RefreshCw size={14} />}
              {favoritesLoading ? "Trying again…" : "Try again"}
            </Button>
          )}
        />
      ) : !favoriteAlbumCount && !favoriteTrackCount && !favoriteRadioShowCount ? (
        <SavedEmpty
          icon={<Heart size={28} />}
          title="Nothing starred yet"
          detail={favoritesLocal
            ? "Use the heart on any release, track, or Radio show. Favorites stay on this device."
            : "Use the heart on a release or track. Your favorites sync through Bandcamp’s Subsonic library."}
        />
      ) : (
        <>
          {!favoriteTracks.length && !favoriteAlbums.length && !favoriteRadioShows.length ? (
            <SavedEmpty
              icon={<Heart size={28} />}
              title="Your stars are saved"
              detail={favoritesLocal
                ? `${countLabel(favoriteDisplayMetadataCount, "local favorite")} ${favoriteDisplayMetadataCount === 1 ? "is" : "are"} waiting for display metadata. Coda will repair ${favoriteDisplayMetadataCount === 1 ? "it" : "them"} when the item is loaded.`
                : `Bandcamp returned ${countLabel(favoriteTrackCount + favoriteAlbumCount, "favorite ID")} without display metadata. Refresh after your collection finishes syncing.`}
              action={favoritesLocal ? undefined : (
                <Button
                  onClick={onRefreshFavorites}
                  disabled={favoritesLoading}
                  size="compact"
                >
                  {favoritesLoading
                    ? <Spinner aria-hidden="true" className="size-4 text-current" />
                    : <RefreshCw size={14} />}
                  {favoritesLoading ? "Refreshing…" : "Refresh metadata"}
                </Button>
              )}
            />
          ) : null}
          {favoriteTracks.length ? (
            <section>
              <div className="mb-3 flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="m-0 font-display text-base leading-none font-semibold tracking-tight">
                    Tracks
                  </h2>
                  <Badge
                    className="border-white/8 bg-white/2 text-[#777b76]"
                    size="compact"
                    variant="outline"
                  >
                    {countLabel(favoriteTrackCount, "track")}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    className={cn(
                      activeFavoriteTrack && "border-primary/30 bg-primary/10 text-accent-foreground",
                      activeFavoriteTrack && playing && "bg-primary/15",
                    )}
                    onClick={
                      activeFavoriteTrack
                        ? onTogglePlayback
                        : () => onPlayTracks(favoriteTracks)
                    }
                    aria-label={
                      activeFavoriteTrack
                        ? `${playing ? "Pause" : "Resume"} favorite tracks`
                        : "Play all favorite tracks"
                    }
                    aria-pressed={activeFavoriteTrack && playing}
                    size="compact"
                  >
                    <PlaybackIcon
                      className="size-3.5"
                      playing={activeFavoriteTrack && playing}
                    />
                    {activeFavoriteTrack ? (playing ? "Pause" : "Resume") : "Play all"}
                  </Button>
                  <Button
                    onClick={() => onQueueTracks(favoriteTracks)}
                    size="compact"
                  >
                    <ListPlus size={14} /> Add all
                  </Button>
                </div>
              </div>
              <VirtualizedSavedTrackList
                aria-label="Favorite tracks"
                className="border-y border-white/7"
                getItemKey={favoriteTrackKey}
                items={favoriteTracks}
                renderItem={(track, { index }, rowProps) => {
                  const activeTrack = currentTrackId === track.id;
                  const albumLoading = loadingAlbumId === track.albumId;
                  return (
                  <div
                    {...rowProps}
                    className={cn(
                      "group relative grid h-14 grid-cols-[2rem_2.5rem_minmax(0,1fr)_3rem_repeat(3,2rem)] items-center gap-x-1.5 overflow-hidden border-b border-white/7 pr-2 pl-1 transition-colors last:border-b-0 hover:bg-white/3 lg:grid-cols-[2rem_2.5rem_minmax(0,1fr)_4rem_repeat(3,2rem)] lg:gap-x-2 lg:pr-3",
                      activeTrack && "bg-primary/5 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:content-['']",
                    )}
                  >
                    <Button
                      className={cn(
                        "group/number size-full rounded-none p-0 text-xs font-normal text-[#777a76] hover:bg-transparent",
                        activeTrack && "text-[#e88c75]",
                      )}
                      onClick={activeTrack ? onTogglePlayback : () => onPlayTrack(track)}
                      aria-label={
                        activeTrack
                          ? `${playing ? "Pause" : "Resume"} ${track.title}`
                          : `Play ${track.title}`
                      }
                      aria-pressed={activeTrack && playing}
                      variant="ghost"
                    >
                      <span className={activeTrack ? "hidden" : "group-hover:hidden"}>
                        {index + 1}
                      </span>
                      <PlaybackIcon
                        className={cn(
                          "size-3.5",
                          !activeTrack && "hidden group-hover:inline-grid",
                        )}
                        playing={activeTrack && playing}
                      />
                    </Button>
                    <FavoriteArtwork item={track} />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Button
                        className={cn(
                          "h-auto w-fit max-w-full justify-start overflow-hidden rounded-none p-0 text-xs/4 text-[#d9d8d2] hover:bg-transparent hover:text-accent-foreground",
                          activeTrack && "text-[#f0d7cf]",
                        )}
                        onClick={activeTrack ? onTogglePlayback : () => onPlayTrack(track)}
                        variant="ghost"
                      >
                        <OverflowMarquee className="max-w-full" text={track.title} />
                      </Button>
                      <div className="flex min-w-0 items-center gap-1">
                        <Button
                          className={metadataLinkClassName}
                          onClick={() =>
                            onOpenArtist(track.artist, track.albumId, track)}
                          variant="ghost"
                        >
                          {track.artist}
                        </Button>
                        <span aria-hidden="true">·</span>
                        <Button
                          aria-busy={albumLoading || undefined}
                          aria-label={`Open ${track.album} album`}
                          className={cn(
                            metadataLinkClassName,
                            "gap-1 disabled:opacity-100",
                          )}
                          data-album-open={track.albumId}
                          data-navigation-slot={`favorite-track:${track.id}`}
                          disabled={albumLoading}
                          onClick={(event) =>
                            onOpenTrackAlbum(track, event.currentTarget)}
                          variant="ghost"
                        >
                          {albumLoading ? (
                            <Spinner
                              aria-label={`Loading ${track.album} album`}
                              className="size-3 text-current"
                            />
                          ) : null}
                          {track.album}
                        </Button>
                      </div>
                    </div>
                    <span className="justify-self-end pr-1 text-right text-xs text-[#777b76] tabular-nums">
                      {formatTime(track.duration)}
                    </span>
                    <Button
                      onClick={() => onQueueTrack(track)}
                      aria-label={`Add ${track.title} to queue`}
                      title="Add to queue"
                      size="icon"
                      variant="ghost"
                    >
                      <Plus size={15} />
                    </Button>
                    <Button
                      onClick={() => onAddToPlaylist([track])}
                      aria-label={`Add ${track.title} to playlist`}
                      title="Add to playlist"
                      size="icon"
                      variant="ghost"
                    >
                      <ListPlus size={15} />
                    </Button>
                    <Button
                      className="text-[#ef8066]"
                      onClick={() => onToggleFavorite(track.id, "song", false)}
                      aria-label={`Remove ${track.title} from favorites`}
                      title="Remove from favorites"
                      size="icon"
                      variant="ghost"
                    >
                      <Heart size={15} fill="currentColor" />
                    </Button>
                  </div>
                  );
                }}
              />
            </section>
          ) : null}
          {favoriteRadioShows.length ? (
            <section className="mt-8">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="m-0 font-display text-base leading-none font-semibold tracking-tight">
                  Radio shows
                </h2>
                <span className="text-xs text-[#6f736e]">
                  {countLabel(favoriteRadioShowCount, "show")}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-2.5">
                {favoriteRadioShows.map((show) => {
                  const activeShow = currentTrackId === `radio:${show.id}`;
                  const busyAction = radioAction?.id === show.id
                    ? radioAction.action
                    : undefined;
                  return (
                    <article
                      className={cn(
                        "grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 rounded-lg border border-border bg-white/2 p-3 transition-[border-color,background-color,transform] duration-(--duration-coda-fast) hover:-translate-y-px hover:border-white/12 hover:bg-white/3 lg:grid-cols-[3rem_minmax(0,1fr)_auto]",
                        activeShow && "border-primary/30 bg-primary/7",
                      )}
                      key={show.id}
                    >
                      <Button
                        className="size-11 overflow-hidden rounded-lg p-0 lg:size-12"
                        onClick={() => onOpenRadioShow(show)}
                        aria-label={`Open ${show.subtitle} episode`}
                        variant="ghost"
                      >
                        <FavoriteArtwork
                          className="size-full"
                          item={{
                            title: show.subtitle,
                            palette: paletteFor(`radio:${show.id}`),
                          }}
                        />
                      </Button>
                      <div className="flex min-w-0 flex-col gap-1">
                        <Button
                          className={cn(
                            eyebrowClassName,
                            "mb-0 h-auto w-fit max-w-full justify-start truncate rounded-none p-0 hover:bg-transparent hover:text-accent-foreground",
                          )}
                          onClick={() => onOpenRadioSeries(show.series?.id)}
                          aria-label={`Browse ${show.series?.title ?? "Bandcamp Radio"}`}
                          variant="ghost"
                        >
                          <Radio size={12} />
                          {show.series?.title ?? "Bandcamp Radio"}
                        </Button>
                        <Button
                          className="h-auto w-fit max-w-full justify-start overflow-hidden rounded-none p-0 text-xs text-[#deddd7] hover:bg-transparent hover:text-accent-foreground"
                          onClick={() => onOpenRadioShow(show)}
                          aria-label={`Open ${show.subtitle} details`}
                          variant="ghost"
                        >
                          <OverflowMarquee className="max-w-full" text={show.subtitle} />
                        </Button>
                        <time
                          className="truncate text-xs text-[#777b76]"
                          dateTime={show.publishedAt}
                        >
                          {radioShowDate(show.publishedAt)}
                        </time>
                        {show.description ? (
                          <p className="m-0 truncate text-xs text-[#777b76]">
                            {show.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="col-start-2 flex items-center gap-1 lg:col-start-auto">
                        <Button
                          className={activeShow && playing ? "text-primary" : undefined}
                          onClick={
                            activeShow
                              ? onTogglePlayback
                              : () => void actOnFavoriteRadioShow(show, "play")
                          }
                          disabled={Boolean(radioAction)}
                          aria-label={
                            activeShow
                              ? `${playing ? "Pause" : "Resume"} ${show.subtitle}`
                              : `Play ${show.subtitle}`
                          }
                          aria-pressed={activeShow && playing}
                          title={activeShow ? (playing ? "Pause" : "Resume") : "Play"}
                          size="icon"
                          variant="ghost"
                        >
                          {busyAction === "play"
                            ? <Spinner aria-hidden="true" className="size-4 text-current" />
                            : <PlaybackIcon
                                className="size-4"
                                playing={activeShow && playing}
                              />}
                        </Button>
                        <Button
                          onClick={() => void actOnFavoriteRadioShow(show, "queue")}
                          disabled={Boolean(radioAction)}
                          aria-label={`Add ${show.subtitle} to queue`}
                          title="Add to queue"
                          size="icon"
                          variant="ghost"
                        >
                          {busyAction === "queue"
                            ? <Spinner aria-hidden="true" className="size-4 text-current" />
                            : <ListPlus size={15} />}
                        </Button>
                        <Button
                          className="text-[#ef8066]"
                          onClick={() => onToggleRadioFavorite(show, false)}
                          aria-label={`Remove ${show.subtitle} from favorites`}
                          title="Remove from favorites"
                          size="icon"
                          variant="ghost"
                        >
                          <Heart size={15} fill="currentColor" />
                        </Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
          {favoriteAlbums.length ? (
            <section className="mt-8">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="m-0 font-display text-base leading-none font-semibold tracking-tight">
                  Releases
                </h2>
                <span className="text-xs text-[#6f736e]">
                  {countLabel(favoriteAlbumCount, "release")}
                </span>
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-2.5">
                {favoriteAlbums.map((album) => {
                  const albumLoading = loadingAlbumId === album.id;
                  return (
                    <article
                      className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-1 rounded-lg border border-border bg-white/2 p-2"
                      key={album.id}
                    >
                      <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
                        <Button
                          aria-busy={albumLoading || undefined}
                          aria-label={`Open ${album.title}`}
                          className="relative size-12 overflow-hidden rounded-md p-0 disabled:opacity-100"
                          data-album-open={album.id}
                          data-navigation-slot="artwork"
                          disabled={albumLoading}
                          onClick={(event) =>
                            onOpenAlbum(album, event.currentTarget)}
                          variant="ghost"
                        >
                          <FavoriteArtwork
                            className={cn(
                              "size-full",
                              albumLoading && "opacity-40",
                            )}
                            item={album}
                          />
                          {albumLoading ? (
                            <Spinner
                              aria-label={`Loading ${album.title} artwork`}
                              className="absolute size-4 text-current"
                            />
                          ) : null}
                        </Button>
                        <span className="flex min-w-0 flex-col">
                          <Button
                            aria-busy={albumLoading || undefined}
                            aria-label={albumLoading ? album.title : undefined}
                            className="h-auto w-fit max-w-full justify-start gap-1 overflow-hidden rounded-none p-0 text-xs text-[#d8d7d1] hover:bg-transparent hover:text-accent-foreground disabled:opacity-100"
                            data-album-open={album.id}
                            data-navigation-slot="title"
                            disabled={albumLoading}
                            onClick={(event) =>
                              onOpenAlbum(album, event.currentTarget)}
                            variant="ghost"
                          >
                            {albumLoading ? (
                              <Spinner
                                aria-label={`Loading ${album.title} release`}
                                className="size-3 text-current"
                              />
                            ) : null}
                            <OverflowMarquee className="max-w-full" text={album.title} />
                          </Button>
                          <Button
                            className={cn(metadataLinkClassName, "mt-1 max-w-full")}
                            onClick={() =>
                              onOpenArtist(album.artist, album.id)}
                            variant="ghost"
                          >
                            {album.artist}
                          </Button>
                        </span>
                      </div>
                      <Button
                        className="text-[#ef8066]"
                        onClick={() => onToggleFavorite(album.id, "album", false)}
                        aria-label={`Remove ${album.title} from favorites`}
                        size="icon"
                        variant="ghost"
                      >
                        <Heart size={15} fill="currentColor" />
                      </Button>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
