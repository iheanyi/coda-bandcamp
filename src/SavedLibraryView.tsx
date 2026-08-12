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
import { Link } from "@tanstack/react-router";
import {
  type FormEvent,
  type MouseEvent,
  useCallback,
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
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Spinner } from "@/components/ui/spinner";
import type { ToastNotifier } from "@/components/ui/toastManager";
import { countLabel } from "@/countLabel";
import { libraryArtistRouteSearch } from "@/features/library/libraryLinkSearch";
import { ArtistTransitionName } from "@/features/navigation/ArtistTransitionName";
import {
  acquireTemporaryAttribute,
  combineMarkerReleases,
} from "@/features/navigation/temporaryDomMarkers";
import { radioSeriesId, radioShowId } from "@/features/radio/radioRouteIds";
import {
  createPlaylist,
  deletePlaylist,
  fetchCoverUrl,
  formatTime,
  invalidateCoverUrl,
  paletteFor,
  updatePlaylist,
} from "@/lib";
import { cn } from "@/lib/utils";
import { artistKey } from "@/libraryBrowse";
import {
  createNavigationTransactionState,
  replaceNavigationTransaction,
  resolveNavigationReturnFocus,
  resolveNavigationReturnScrollTop,
  settleNavigationTransaction,
  type NavigationEntrance,
} from "@/navigationTransaction";
import {
  PLAYLISTS_QUERY_KEY,
  playlistQueryKey,
  playlistQueryOptions,
  playlistsQueryOptions,
} from "@/queries/savedLibraryQueries";
import { radioShowQueryOptions } from "@/queries/radioQueries";
import {
  BANDCAMP_RADIO_PROVIDER,
  radioSeriesForShow,
  radioShowIdentity,
} from "@/radioIdentity";
import { shuffled } from "@/queue";
import { radioTrackFromShow } from "@/radioTrack";
import {
  type AlbumId,
  type ArtistKey,
  parseAlbumIdParam,
  parseArtistKeyParam,
  parsePlaylistIdParam,
  stringifyRadioShowIdParam,
  type PlaylistId,
  validateCollectionSearch,
} from "@/routing/routeContracts";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import type {
  Album,
  LocalFavoriteCollection,
  PlaylistDetail,
  PlaylistSummary,
  PlaylistUpdateInput,
  RadioShowSummary,
  Track,
} from "@/types";
import { ResponsiveVirtualGrid } from "@/ResponsiveVirtualGrid";
import { transitionCodaView } from "@/viewTransitions";
import { VirtualizedSavedTrackList } from "@/VirtualizedSavedTrackList";

type SavedLibraryViewProps = {
  mode: "favorites" | "playlists";
  connected: boolean;
  favorites?: LocalFavoriteCollection;
  favoritesLoading: boolean;
  favoritesError?: string;
  favoritesLocal?: boolean;
  loadingAlbumId?: string;
  onRefreshFavorites: () => void;
  onToggleFavorite: (
    id: string,
    kind: "song" | "album",
    favorite: boolean,
  ) => void;
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
    sourceTrigger?: HTMLElement,
  ) => void;
  onOpenRadioShow: (show: RadioShowSummary) => void;
  onOpenRadioSeries: (seriesId?: number) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onNotify: ToastNotifier;
};

export type FavoritesScreenProps = Omit<
  SavedLibraryViewProps,
  "connected" | "mode"
> &
  Readonly<{
    className?: string;
  }>;

export type PlaylistsScreenProps = Readonly<{
  className?: string;
  connected: boolean;
  onOpenPlaylist: (playlistId: PlaylistId) => void | Promise<void>;
  onNotify: ToastNotifier;
}>;

export type PlaylistDetailScreenProps = Readonly<{
  className?: string;
  connected: boolean;
  playlistId: PlaylistId;
  loadingAlbumId?: string;
  currentTrackId?: string;
  playing: boolean;
  onBack: () => void | Promise<void>;
  onTogglePlayback: () => void;
  onPlayTracks: (tracks: Track[]) => void;
  onQueueTracks: (tracks: Track[]) => void;
  onOpenTrackAlbum: (track: Track, trigger: HTMLElement) => void;
  onOpenArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
    sourceTrigger?: HTMLElement,
  ) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onNotify: ToastNotifier;
}>;

type SavedLibraryControllerProps = Partial<
  Omit<SavedLibraryViewProps, "connected" | "mode">
> &
  Readonly<{
    className?: string;
    connected: boolean;
    delegatePlaylistCloseTransition?: boolean;
    focusDetailOnLoad?: boolean;
    mode: "favorites" | "playlists";
    onSelectedPlaylistIdChange: (
      playlistId?: PlaylistId,
    ) => void | Promise<void>;
    selectedPlaylistId?: PlaylistId;
  }>;

const playlistTrackKey = (track: Track, index: number) =>
  `${track.id}-${index}`;
const favoriteTrackKey = (track: Track) => track.id;
const radioDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const eyebrowClassName =
  "mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase";
const metadataLinkClassName =
  "inline-flex h-auto min-w-0 max-w-[48%] cursor-pointer items-center truncate rounded-none border-0 bg-transparent p-0 text-left text-xs font-normal text-[#777b76] outline-none hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";
const metadataTextClassName =
  "h-auto min-w-0 max-w-[48%] truncate text-left text-xs font-normal text-[#777b76]";
const savedPageClassName = "mx-auto min-h-full w-full max-w-5xl pt-2 pb-12";
const FAVORITE_RADIO_GRID_LAYOUTS = [
  {
    maxWidth: 780,
    minColumnWidth: 304,
    columnGap: 10,
    rowGap: 10,
    rowHeight: 148,
  },
  {
    minColumnWidth: 304,
    columnGap: 10,
    rowGap: 10,
    rowHeight: 104,
  },
] as const;
const FAVORITE_ALBUM_GRID_LAYOUTS = [
  {
    minColumnWidth: 240,
    columnGap: 10,
    rowGap: 10,
    rowHeight: 64,
  },
] as const;
const PLAYLIST_GRID_LAYOUTS = [
  {
    minColumnWidth: 272,
    columnGap: 12,
    rowGap: 12,
    rowHeight: 84,
  },
] as const;
const playlistSummaryKey = (playlist: PlaylistSummary) => playlist.id;
const parentScrollElement = (root: HTMLElement) => root.parentElement;
const ignoreAction = () => undefined;

function albumRouteId(value: unknown): AlbumId | undefined {
  try {
    return parseAlbumIdParam(value);
  } catch {
    return undefined;
  }
}

function artistRouteKey(value: string): ArtistKey | undefined {
  try {
    return parseArtistKeyParam(artistKey(value));
  } catch {
    return undefined;
  }
}
const ignoreNotification: ToastNotifier = () => undefined;

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
  return current.map((item, index) => (index === existing ? playlist : item));
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
  return current.map((item, index) =>
    index === optimisticIndex ? playlist : item,
  );
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
  const tracks = playlist.tracks.filter(
    (_track, index) => !removals.has(index),
  );
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
  return Number.isNaN(parsed.getTime())
    ? value
    : radioDateFormatter.format(parsed);
}

function Eyebrow({ className, ...props }: React.ComponentProps<"span">) {
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
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const [requestVersion, setRequestVersion] = useState(0);
  const coverIdRef = useRef(item.coverArt);
  const directArtworkUrlRef = useRef(item.artworkUrl);
  const failedUrlsRef = useRef<Set<string>>(new Set());
  const retryCountRef = useRef(0);

  useEffect(() => {
    let active = true;
    if (
      coverIdRef.current !== item.coverArt ||
      directArtworkUrlRef.current !== item.artworkUrl
    ) {
      coverIdRef.current = item.coverArt;
      directArtworkUrlRef.current = item.artworkUrl;
      retryCountRef.current = 0;
    }
    if (item.artworkUrl && !failedUrlsRef.current.has(item.artworkUrl)) {
      setUrl(item.artworkUrl);
      return;
    }
    setUrl(undefined);
    if (!item.coverArt) {
      return;
    }
    fetchCoverUrl(item.coverArt)
      .then((nextUrl) => {
        if (active && !failedUrlsRef.current.has(nextUrl)) setUrl(nextUrl);
      })
      .catch(() => {
        if (active) setUrl(undefined);
      });
    return () => {
      active = false;
    };
  }, [item.artworkUrl, item.coverArt, requestVersion]);

  const retryImage = (failedUrl: string) => {
    failedUrlsRef.current.add(failedUrl);
    setLoadedUrl((current) => (current === failedUrl ? undefined : current));
    setUrl((current) => (current === failedUrl ? undefined : current));
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
      data-slot={url ? "cover" : undefined}
      style={{
        background: `linear-gradient(145deg, ${item.palette[0]}, ${item.palette[1]})`,
      }}
      aria-hidden="true"
    >
      {url ? (
        <img
          key={url}
          className={cn(
            "col-start-1 row-start-1 size-full object-cover",
            loadedUrl !== url && "invisible",
          )}
          src={url}
          alt=""
          loading="lazy"
          onError={() => retryImage(url)}
          onLoad={() => setLoadedUrl(url)}
        />
      ) : null}
      {loadedUrl !== url || !url ? (
        <Music2
          className="col-start-1 row-start-1"
          data-favorite-artwork-fallback=""
          size={20}
        />
      ) : null}
    </span>
  );
}

export function FavoritesScreen({ className, ...props }: FavoritesScreenProps) {
  return (
    <SavedLibraryController
      {...props}
      className={className}
      connected={false}
      mode="favorites"
      onSelectedPlaylistIdChange={ignoreAction}
    />
  );
}

export function PlaylistsScreen({
  className,
  connected,
  onOpenPlaylist,
  onNotify,
}: PlaylistsScreenProps) {
  return (
    <SavedLibraryController
      className={className}
      connected={connected}
      mode="playlists"
      onNotify={onNotify}
      onSelectedPlaylistIdChange={(playlistId) => {
        if (playlistId) return onOpenPlaylist(playlistId);
      }}
    />
  );
}

export function PlaylistDetailScreen({
  className,
  connected,
  playlistId,
  loadingAlbumId,
  currentTrackId,
  playing,
  onBack,
  onTogglePlayback,
  onPlayTracks,
  onQueueTracks,
  onOpenTrackAlbum,
  onOpenArtist,
  onAddToPlaylist,
  onNotify,
}: PlaylistDetailScreenProps) {
  return (
    <SavedLibraryController
      className={className}
      connected={connected}
      currentTrackId={currentTrackId}
      delegatePlaylistCloseTransition
      focusDetailOnLoad
      loadingAlbumId={loadingAlbumId}
      mode="playlists"
      onAddToPlaylist={onAddToPlaylist}
      onNotify={onNotify}
      onOpenArtist={onOpenArtist}
      onOpenTrackAlbum={onOpenTrackAlbum}
      onPlayTracks={onPlayTracks}
      onQueueTracks={onQueueTracks}
      onSelectedPlaylistIdChange={(nextPlaylistId) => {
        if (!nextPlaylistId) return onBack();
      }}
      onTogglePlayback={onTogglePlayback}
      playing={playing}
      selectedPlaylistId={playlistId}
    />
  );
}

export default function SavedLibraryView(props: SavedLibraryViewProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<PlaylistId>();
  return (
    <SavedLibraryController
      {...props}
      onSelectedPlaylistIdChange={setSelectedPlaylistId}
      selectedPlaylistId={selectedPlaylistId}
    />
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
  returningPlaylistId,
}: {
  playlists: PlaylistSummary[];
  onOpen: (playlist: PlaylistSummary, trigger: HTMLAnchorElement) => void;
  onCreate: (name: string) => void;
  creating: boolean;
  openingPlaylistId?: string;
  returningPlaylistId?: string;
}) {
  const [name, setName] = useState("");
  const scrollElementRef = useRef<HTMLElement | null>(null);
  const setPlaylistListRoot = useCallback((element: HTMLDivElement | null) => {
    scrollElementRef.current =
      element?.closest<HTMLElement>("[data-coda-library-scroll]") ??
      element?.parentElement ??
      null;
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    onCreate(nextName);
    setName("");
  };

  return (
    <div ref={setPlaylistListRoot}>
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
          {creating ? (
            <Spinner aria-hidden="true" className="size-4 text-current" />
          ) : (
            <Plus size={16} />
          )}
          {creating ? "Creating…" : "Create"}
        </Button>
      </form>

      {playlists.length ? (
        <ResponsiveVirtualGrid
          aria-label="Playlists"
          className="w-full"
          getItemKey={playlistSummaryKey}
          items={playlists}
          layouts={PLAYLIST_GRID_LAYOUTS}
          scrollElementRef={scrollElementRef}
          renderItem={(playlist) => {
            const optimistic = isOptimisticPlaylist(playlist);
            const opening = openingPlaylistId === playlist.id;
            const playlistId = parsePlaylistIdParam(playlist.id);
            return (
              <Link
                aria-busy={optimistic || opening || undefined}
                aria-disabled={optimistic || opening || undefined}
                className={cn(
                  buttonVariants(),
                  "grid h-full w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-border bg-white/2 p-3.5 text-left font-normal transition-[border-color,background-color,transform] duration-(--duration-coda-fast) hover:-translate-y-px hover:border-input hover:bg-white/3.5 aria-disabled:cursor-default aria-disabled:opacity-[0.38]",
                )}
                data-playlist-open={playlist.id}
                onClick={(event) => {
                  if (optimistic || opening) {
                    event.preventDefault();
                    return;
                  }
                  handleCodaLinkActivation(event, (trigger) =>
                    onOpen(playlist, trigger),
                  );
                }}
                params={{ playlistId }}
                preload={optimistic || opening ? false : undefined}
                tabIndex={optimistic ? -1 : undefined}
                to="/playlists/$playlistId"
              >
                <span className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
                  <span
                    className="row-span-3 grid size-13 place-items-center rounded-lg border border-white/7 bg-coda-hover text-[#e1846d]"
                    data-coda-playlist-identity-return={
                      returningPlaylistId === playlist.id
                        ? playlist.id
                        : undefined
                    }
                    data-playlist-identity={playlist.id}
                  >
                    <ListMusic size={25} />
                  </span>
                  <span className="min-w-0" data-playlist-title={playlist.id}>
                    <OverflowMarquee
                      className="text-xs text-[#dcdbd5]"
                      staticTextProps={{
                        "data-coda-playlist-title-return":
                          returningPlaylistId === playlist.id
                            ? playlist.id
                            : undefined,
                      }}
                      text={playlist.name}
                    />
                  </span>
                  <span className="col-start-2 truncate text-xs text-[#777b76]">
                    {countLabel(playlist.songCount, "track")}
                    {playlist.duration
                      ? ` · ${formatTime(playlist.duration)}`
                      : ""}
                  </span>
                  {playlist.comment ? (
                    <small className="col-start-2 truncate text-xs text-[#777b76]">
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
              </Link>
            );
          }}
        />
      ) : (
        <SavedEmpty
          icon={<ListMusic size={28} />}
          title="No playlists yet"
          detail="Name your first mix above, then add tracks from an album, Favorites, or Now Playing."
        />
      )}
    </div>
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
    sourceTrigger?: HTMLElement,
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
  const activePlaylist =
    playlist?.tracks.some((track) => track.id === currentTrackId) ?? false;

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
          <ArrowLeft size={15} /> Back
        </Button>
        <SavedEmpty
          icon={<Spinner aria-hidden="true" className="size-7 text-current" />}
          title="Loading playlist"
          detail="Pulling the latest track order from Bandcamp…"
        />
      </div>
    );
  }

  const firstTrack = playlist.tracks[0];
  const playlistArtwork =
    playlist.coverArt || firstTrack?.coverArt || firstTrack?.artworkUrl
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
    <article
      aria-busy={actionPending}
      data-coda-playlist-detail-surface={playlist.id}
    >
      <Button
        className="mb-3 -ml-1 h-auto gap-1.5 p-1 text-xs font-bold"
        onClick={onBack}
        variant="text"
      >
        <ArrowLeft size={15} /> Back
      </Button>
      <header className="grid min-h-48 grid-cols-[8rem_minmax(0,1fr)] items-center gap-6 rounded-t-xl border border-border bg-[radial-gradient(circle_at_84%_10%,rgba(221,101,73,0.12),transparent_40%),linear-gradient(135deg,#24282a,#191c1e_72%)] p-7">
        <div
          className="size-32"
          data-coda-playlist-identity-detail={playlist.id}
        >
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
        </div>
        <div
          className="min-w-0"
          data-coda-playlist-metadata-detail={playlist.id}
        >
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
                {renaming ? (
                  <Spinner aria-hidden="true" className="size-4 text-current" />
                ) : (
                  <Check size={17} />
                )}
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
                <span
                  className="inline-block max-w-full truncate align-top"
                  data-coda-playlist-title-detail={playlist.id}
                >
                  {playlist.name}
                </span>
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
                activePlaylist &&
                  playing &&
                  "bg-[color-mix(in_srgb,var(--primary)_82%,#17191b)]",
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
            const albumId = albumRouteId(track.albumId);
            const trackArtistKey = artistRouteKey(track.artist);
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
                  onClick={
                    activeTrack ? onTogglePlayback : () => onPlay([track])
                  }
                  aria-label={
                    activeTrack
                      ? `${playing ? "Pause" : "Resume"} ${track.title}`
                      : `Play ${track.title}`
                  }
                  aria-pressed={activeTrack && playing}
                  variant="ghost"
                >
                  <span
                    className={activeTrack ? "hidden" : "group-hover:hidden"}
                  >
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
                {albumId ? (
                  <Link
                    aria-busy={albumLoading || undefined}
                    aria-disabled={albumLoading || undefined}
                    aria-label={`Open ${track.album} album`}
                    className="block size-10 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-60"
                    data-album-open={track.albumId}
                    data-navigation-slot={`playlist-track-artwork:${track.id}`}
                    onClick={(event) => {
                      if (albumLoading) {
                        event.preventDefault();
                        return;
                      }
                      handleCodaLinkActivation(event, (trigger) =>
                        onOpenTrackAlbum(track, trigger),
                      );
                    }}
                    params={{ albumId }}
                    search={(previous) => validateCollectionSearch(previous)}
                    to="/collection/albums/$albumId"
                  >
                    <FavoriteArtwork item={track} />
                  </Link>
                ) : (
                  <FavoriteArtwork item={track} />
                )}
                <div className="flex min-w-0 flex-col gap-1">
                  <Button
                    className={cn(
                      "h-auto w-fit max-w-full justify-start overflow-hidden rounded-none p-0 text-xs text-[#d9d8d2] hover:bg-transparent hover:text-accent-foreground",
                      activeTrack && "text-[#f0d7cf]",
                    )}
                    onClick={
                      activeTrack ? onTogglePlayback : () => onPlay([track])
                    }
                    variant="ghost"
                  >
                    <OverflowMarquee
                      className="max-w-full"
                      text={track.title}
                    />
                  </Button>
                  <span className="flex min-w-0 items-center gap-1">
                    {trackArtistKey ? (
                      <Link
                        className={metadataLinkClassName}
                        data-artist-open={trackArtistKey}
                        data-coda-artist-name-target={trackArtistKey}
                        data-navigation-slot={`playlist-track-artist:${track.id}`}
                        onClick={(event) =>
                          handleCodaLinkActivation(event, (trigger) =>
                            onOpenArtist(track.artist, albumId, track, trigger),
                          )
                        }
                        params={{ artistKey: trackArtistKey }}
                        search={(previous) =>
                          libraryArtistRouteSearch(previous, albumId)
                        }
                        to="/collection/artists/$artistKey"
                      >
                        <ArtistTransitionName artistKey={trackArtistKey}>
                          {track.artist}
                        </ArtistTransitionName>
                      </Link>
                    ) : (
                      <span className={metadataTextClassName}>
                        {track.artist}
                      </span>
                    )}
                    <span aria-hidden="true">·</span>
                    {albumId ? (
                      <Link
                        aria-busy={albumLoading || undefined}
                        aria-disabled={albumLoading || undefined}
                        aria-label={`Open ${track.album} album`}
                        className={cn(
                          metadataLinkClassName,
                          "gap-1 aria-disabled:cursor-default aria-disabled:opacity-100",
                        )}
                        data-album-open={track.albumId}
                        data-navigation-slot={`playlist-track:${track.id}`}
                        onClick={(event) => {
                          if (albumLoading) {
                            event.preventDefault();
                            return;
                          }
                          handleCodaLinkActivation(event, (trigger) =>
                            onOpenTrackAlbum(track, trigger),
                          );
                        }}
                        params={{ albumId }}
                        search={(previous) =>
                          validateCollectionSearch(previous)
                        }
                        to="/collection/albums/$albumId"
                      >
                        {albumLoading ? (
                          <Spinner
                            aria-label={`Loading ${track.album} album`}
                            className="size-3 text-current"
                          />
                        ) : null}
                        {track.album}
                      </Link>
                    ) : (
                      <span className={metadataTextClassName}>
                        {track.album}
                      </span>
                    )}
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
                  {pendingRemovalIndex === index ? (
                    <Spinner
                      aria-hidden="true"
                      className="size-4 text-current"
                    />
                  ) : (
                    <X size={15} />
                  )}
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
            render={
              <Button
                className="text-coda-danger-foreground"
                size="compact"
                variant="text"
              />
            }
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
                {deleting ? (
                  <Spinner aria-hidden="true" className="size-4 text-current" />
                ) : (
                  <Trash2 size={14} />
                )}
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
  const playlists = useQuery(playlistsQueryOptions());
  const songIds = useMemo(
    () => Array.from(new Set(tracks.map((track) => track.id))),
    [tracks],
  );
  const addMutation = useMutation({
    mutationFn: async (playlist: PlaylistSummary) =>
      updatePlaylist({ playlistId: playlist.id, songIdsToAdd: songIds }),
    onMutate: async (target): Promise<PlaylistDetailMutationContext> => {
      const detailKey = playlistQueryKey(target.id);
      await Promise.all([
        queryClient.cancelQueries({
          queryKey: PLAYLISTS_QUERY_KEY,
          exact: true,
        }),
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
            duration:
              target.duration +
              tracks.reduce((total, track) => total + track.duration, 0),
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
      onClose();
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
        (current) =>
          replaceOptimisticPlaylist(
            current,
            context?.optimisticId,
            playlistSummary(created),
          ),
      );
      onNotify(
        `${created.name} created with ${countLabel(tracks.length, "track")}`,
        "good",
      );
      onClose();
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
        onClose();
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
          <Button type="submit" disabled={!name.trim() || pending}>
            {createMutation.isPending ? (
              <Spinner aria-hidden="true" className="size-4 text-current" />
            ) : (
              <Plus size={15} />
            )}
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </form>
        <div
          className="flex max-h-84 scrollbar-thin [scrollbar-color:#3e4142_transparent] flex-col overflow-y-auto p-2"
          data-add-to-playlist-scroll
        >
          {playlists.isLoading ? (
            <span className="flex min-h-28 items-center justify-center gap-2 text-xs text-[#858984]">
              <Spinner aria-hidden="true" className="size-4" />
              Loading playlists…
            </span>
          ) : playlists.isError ? (
            <Alert className="my-6" variant="danger">
              <AlertDescription>Couldn’t load playlists.</AlertDescription>
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
            <VirtualizedSavedTrackList
              aria-label="Available playlists"
              className="shrink-0"
              getItemKey={playlistSummaryKey}
              getScrollElement={parentScrollElement}
              items={playlists.data}
              rowHeight={56}
              renderItem={(playlist, _context, rowProps) => (
                <div {...rowProps}>
                  <Button
                    className="grid h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left font-normal hover:bg-white/4.5"
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
                    {addMutation.isPending &&
                    addMutation.variables.id === playlist.id ? (
                      <Spinner
                        aria-hidden="true"
                        className="size-4 text-current"
                      />
                    ) : (
                      <Plus size={16} />
                    )}
                  </Button>
                </div>
              )}
            />
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

function SavedLibraryController({
  className,
  mode,
  connected,
  favorites,
  favoritesLoading = false,
  favoritesError,
  favoritesLocal = false,
  loadingAlbumId,
  onRefreshFavorites = ignoreAction,
  onToggleFavorite = ignoreAction,
  onToggleRadioFavorite = ignoreAction,
  currentTrackId,
  playing = false,
  onTogglePlayback = ignoreAction,
  onPlayTracks = ignoreAction,
  onQueueTracks = ignoreAction,
  onPlayTrack = ignoreAction,
  onQueueTrack = ignoreAction,
  onOpenAlbum = ignoreAction,
  onOpenTrackAlbum = ignoreAction,
  onOpenArtist = ignoreAction,
  onOpenRadioShow = ignoreAction,
  onOpenRadioSeries = ignoreAction,
  onAddToPlaylist = ignoreAction,
  onNotify = ignoreNotification,
  delegatePlaylistCloseTransition = false,
  focusDetailOnLoad = false,
  selectedPlaylistId,
  onSelectedPlaylistIdChange,
}: SavedLibraryControllerProps) {
  const queryClient = useQueryClient();
  const [openingPlaylistId, setOpeningPlaylistId] = useState<string>();
  const [returningPlaylistId, setReturningPlaylistId] = useState<string>();
  const playlistNavigationRef = useRef(createNavigationTransactionState());
  const playlistCloseGenerationRef = useRef(0);
  const playlistSourceMarkerGenerationRef = useRef(0);
  const activePlaylistSourceMarkersRef = useRef<
    | Readonly<{
        generation: number;
        release: () => void;
      }>
    | undefined
  >(undefined);
  const playlistReturnFocusRequestedRef = useRef(false);
  const playlistScrollTopRef = useRef<number | undefined>(undefined);
  const favoriteScrollElementRef = useRef<HTMLElement | null>(null);
  const setFavoritePageRoot = useCallback((element: HTMLElement | null) => {
    favoriteScrollElementRef.current =
      element?.closest<HTMLElement>("[data-coda-library-scroll]") ??
      element?.parentElement ??
      null;
  }, []);
  const [radioAction, setRadioAction] = useState<{
    id: number;
    action: "play" | "queue";
  }>();
  useEffect(
    () => () => {
      activePlaylistSourceMarkersRef.current?.release();
      activePlaylistSourceMarkersRef.current = undefined;
    },
    [],
  );
  const closePlaylist = () => {
    if (delegatePlaylistCloseTransition) {
      return onSelectedPlaylistIdChange(undefined);
    }
    const closeGeneration = ++playlistCloseGenerationRef.current;
    const transaction = playlistNavigationRef.current.active;
    const closingPlaylistId = selectedPlaylistId;
    const reversesSharedIdentity =
      transaction?.entrance === "shared-element" &&
      transaction.sharedElementOwner === "coda-playlist-identity" &&
      transaction.sourceTrigger?.dataset.playlistOpen === closingPlaylistId &&
      Boolean(closingPlaylistId);
    playlistReturnFocusRequestedRef.current = Boolean(transaction);
    playlistScrollTopRef.current = transaction
      ? resolveNavigationReturnScrollTop(transaction)
      : 0;
    void transitionCodaView(
      () => {
        setReturningPlaylistId(
          reversesSharedIdentity ? closingPlaylistId : undefined,
        );
        return onSelectedPlaylistIdChange(undefined);
      },
      reversesSharedIdentity ? "playlist-detail-close" : "page-back",
    ).finally(() => {
      if (playlistCloseGenerationRef.current !== closeGeneration) return;
      if (!closingPlaylistId) return;
      setReturningPlaylistId((current) =>
        current === closingPlaylistId ? undefined : current,
      );
    });
  };
  const beginPlaylistNavigation = (
    _playlistId: PlaylistId,
    sourceTrigger?: HTMLElement,
    entrance: NavigationEntrance = "page-forward",
    sharedElementOwner?: string,
  ) => {
    playlistCloseGenerationRef.current += 1;
    setReturningPlaylistId(undefined);
    const returnScrollTop =
      document.querySelector<HTMLElement>("[data-coda-library-scroll]")
        ?.scrollTop ?? 0;
    playlistReturnFocusRequestedRef.current = false;
    playlistNavigationRef.current = replaceNavigationTransaction(
      playlistNavigationRef.current,
      {
        routeKey: "playlist-detail",
        intent: "forward",
        entrance,
        sourceTrigger,
        returnScrollTop,
        destinationHeadingId: "playlist-detail-heading",
        sharedElementOwner,
      },
    );
    playlistScrollTopRef.current = 0;
  };
  const playlists = useQuery({
    ...playlistsQueryOptions(),
    enabled: connected && mode === "playlists",
  });
  const playlist = useQuery({
    ...playlistQueryOptions(selectedPlaylistId ?? ""),
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
    if (selectedPlaylistId) {
      if (!playlist.data || playlist.data.id !== selectedPlaylistId) return;
      if (transaction || focusDetailOnLoad) {
        document
          .getElementById(
            transaction?.destinationHeadingId ?? "playlist-detail-heading",
          )
          ?.focus({ preventScroll: true });
      }
      return;
    }
    if (!transaction) return;
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
  }, [focusDetailOnLoad, playlist.data, selectedPlaylistId]);
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
        (current) => [
          {
            duration: 0,
            id: optimisticId,
            name,
            songCount: 0,
          },
          ...(current ?? []),
        ],
      );
      return { optimisticId, previousPlaylists };
    },
    onSuccess: (created, _name, context) => {
      const createdPlaylistId = parsePlaylistIdParam(created.id);
      queryClient.setQueryData(playlistQueryKey(created.id), created);
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) =>
          replaceOptimisticPlaylist(
            current,
            context?.optimisticId,
            playlistSummary(created),
          ),
      );
      beginPlaylistNavigation(
        createdPlaylistId,
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined,
      );
      void transitionCodaView(
        () => onSelectedPlaylistIdChange(createdPlaylistId),
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
        queryClient.cancelQueries({
          queryKey: PLAYLISTS_QUERY_KEY,
          exact: true,
        }),
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
          (current) =>
            upsertPlaylistSummary(current, playlistSummary(optimisticPlaylist)),
        );
      } else if (input.name !== undefined) {
        const nextName = input.name;
        queryClient.setQueryData<PlaylistSummary[]>(
          PLAYLISTS_QUERY_KEY,
          (current) =>
            current?.map((item) =>
              item.id === input.playlistId ? { ...item, name: nextName } : item,
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
        queryClient.cancelQueries({
          queryKey: PLAYLISTS_QUERY_KEY,
          exact: true,
        }),
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
      const details = await queryClient.fetchQuery(
        radioShowQueryOptions(show.id),
      );
      const track = radioTrackFromShow(details);
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
      <section className={cn(savedPageClassName, className)}>
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
      <section className={cn(savedPageClassName, className)}>
        {playlist.isError ? (
          <SavedEmpty
            icon={<ListMusic size={28} />}
            title="This playlist couldn’t load"
            detail={mutationError(playlist.error)}
            action={
              <Button
                onClick={() => void playlist.refetch()}
                disabled={playlist.isFetching}
                size="compact"
              >
                {playlist.isFetching ? (
                  <Spinner aria-hidden="true" className="size-4 text-current" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {playlist.isFetching ? "Trying again…" : "Try again"}
              </Button>
            }
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
            onRename={(name) =>
              updateMutation.mutate({ playlistId: selectedPlaylistId, name })
            }
            onRemove={(index) =>
              updateMutation.mutate({
                playlistId: selectedPlaylistId,
                songIndexesToRemove: [index],
              })
            }
            onDelete={() => deleteMutation.mutate(selectedPlaylistId)}
            actionPending={updateMutation.isPending || deleteMutation.isPending}
            pendingRemovalIndex={
              updateMutation.isPending
                ? updateMutation.variables?.songIndexesToRemove?.[0]
                : undefined
            }
            renaming={
              updateMutation.isPending &&
              Boolean(updateMutation.variables?.name)
            }
            deleting={deleteMutation.isPending}
          />
        )}
      </section>
    );
  }

  if (mode === "playlists") {
    return (
      <section className={cn(savedPageClassName, className)}>
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
            {playlists.isFetching ? (
              <Spinner aria-hidden="true" className="size-4 text-current" />
            ) : (
              <RefreshCw size={15} />
            )}
            {playlists.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        </header>
        {playlists.isLoading ? (
          <SavedEmpty
            icon={
              <Spinner aria-hidden="true" className="size-7 text-current" />
            }
            title="Loading playlists"
            detail="Pulling your latest Bandcamp mixes…"
          />
        ) : playlists.isError ? (
          <SavedEmpty
            icon={<ListMusic size={28} />}
            title="Playlists couldn’t load"
            detail={mutationError(playlists.error)}
            action={
              <Button
                onClick={() => void playlists.refetch()}
                disabled={playlists.isFetching}
                size="compact"
              >
                {playlists.isFetching ? (
                  <Spinner aria-hidden="true" className="size-4 text-current" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {playlists.isFetching ? "Trying again…" : "Try again"}
              </Button>
            }
          />
        ) : (
          <PlaylistList
            playlists={playlists.data ?? []}
            onOpen={(item, trigger) => {
              const playlistId = parsePlaylistIdParam(item.id);
              const hasCachedDetail =
                queryClient.getQueryData<PlaylistDetail>(
                  playlistQueryKey(playlistId),
                ) !== undefined;
              const sourceIdentity = trigger.querySelector<HTMLElement>(
                "[data-playlist-identity]",
              );
              const sourceTitleRoot = trigger.querySelector<HTMLElement>(
                "[data-playlist-title]",
              );
              const sourceTitle = sourceTitleRoot?.querySelector<HTMLElement>(
                '[data-slot="overflow-marquee-text"]',
              );
              const hasSharedIdentity =
                hasCachedDetail &&
                sourceIdentity?.dataset.playlistIdentity === playlistId;
              const entrance: NavigationEntrance = hasSharedIdentity
                ? "shared-element"
                : hasCachedDetail
                  ? "page-forward"
                  : "none";
              beginPlaylistNavigation(
                playlistId,
                trigger,
                entrance,
                hasSharedIdentity ? "coda-playlist-identity" : undefined,
              );
              setOpeningPlaylistId(playlistId);
              const sourceMarkerGeneration =
                ++playlistSourceMarkerGenerationRef.current;
              activePlaylistSourceMarkersRef.current?.release();
              const releaseSourceMarkers = combineMarkerReleases([
                ...(hasSharedIdentity && sourceIdentity
                  ? [
                      acquireTemporaryAttribute(
                        sourceIdentity,
                        "data-coda-playlist-identity-source",
                        playlistId,
                      ),
                    ]
                  : []),
                ...(hasSharedIdentity &&
                sourceTitleRoot?.dataset.playlistTitle === playlistId &&
                sourceTitle
                  ? [
                      acquireTemporaryAttribute(
                        sourceTitle,
                        "data-coda-playlist-title-source",
                        playlistId,
                      ),
                    ]
                  : []),
              ]);
              activePlaylistSourceMarkersRef.current = {
                generation: sourceMarkerGeneration,
                release: releaseSourceMarkers,
              };
              const playlistTransition = transitionCodaView(
                () => {
                  const navigation = onSelectedPlaylistIdChange(playlistId);
                  setOpeningPlaylistId(undefined);
                  return navigation;
                },
                hasSharedIdentity ? "playlist-detail" : "page-forward",
                { skipSnapshot: !hasCachedDetail },
              );
              void playlistTransition.finally(() => {
                releaseSourceMarkers();
                if (
                  activePlaylistSourceMarkersRef.current?.generation ===
                  sourceMarkerGeneration
                ) {
                  activePlaylistSourceMarkersRef.current = undefined;
                }
              });
            }}
            onCreate={(name) => createMutation.mutate(name)}
            creating={createMutation.isPending}
            openingPlaylistId={openingPlaylistId}
            returningPlaylistId={returningPlaylistId}
          />
        )}
      </section>
    );
  }

  const favoriteTracks = favorites?.tracks ?? [];
  const favoriteAlbums = favorites?.albums ?? [];
  const favoriteRadioShows = favorites?.radioShows ?? [];
  const activeFavoriteTrack = favoriteTracks.some(
    (track) => track.id === currentTrackId,
  );
  const favoriteTrackCount = favorites?.songIds.length ?? favoriteTracks.length;
  const favoriteAlbumCount =
    favorites?.albumIds.length ?? favoriteAlbums.length;
  const favoriteRadioShowCount =
    favorites?.radioShowIds?.length ?? favoriteRadioShows.length;
  const favoriteDisplayMetadataCount =
    favoriteTrackCount + favoriteAlbumCount + favoriteRadioShowCount;
  return (
    <section
      className={cn(savedPageClassName, className)}
      ref={setFavoritePageRoot}
    >
      <header className="mb-8 flex items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-2.5">
          <Eyebrow className="mb-0 inline-flex items-center gap-1.5">
            {favoritesLocal ? (
              <>
                <HardDrive size={12} /> On this device
              </>
            ) : (
              "Your keepers"
            )}
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
            {favoritesLoading ? (
              <Spinner aria-hidden="true" className="size-4 text-current" />
            ) : (
              <RefreshCw size={15} />
            )}
            {favoritesLoading ? "Refreshing…" : "Refresh"}
          </Button>
        ) : null}
      </header>
      {favoritesLoading ? (
        <SavedEmpty
          icon={<Spinner aria-hidden="true" className="size-7 text-current" />}
          title="Loading favorites"
          detail="Looking through your starred Bandcamp music…"
        />
      ) : favoritesError ? (
        <SavedEmpty
          icon={<Heart size={28} />}
          title="Favorites couldn’t load"
          detail={favoritesError}
          action={
            <Button
              onClick={onRefreshFavorites}
              disabled={favoritesLoading}
              size="compact"
            >
              {favoritesLoading ? (
                <Spinner aria-hidden="true" className="size-4 text-current" />
              ) : (
                <RefreshCw size={14} />
              )}
              {favoritesLoading ? "Trying again…" : "Try again"}
            </Button>
          }
        />
      ) : !favoriteAlbumCount &&
        !favoriteTrackCount &&
        !favoriteRadioShowCount ? (
        <SavedEmpty
          icon={<Heart size={28} />}
          title="Nothing starred yet"
          detail={
            favoritesLocal
              ? "Use the heart on any release, track, or Radio show. Favorites stay on this device."
              : "Use the heart on a release or track. Your favorites sync through Bandcamp’s Subsonic library."
          }
        />
      ) : (
        <>
          {!favoriteTracks.length &&
          !favoriteAlbums.length &&
          !favoriteRadioShows.length ? (
            <SavedEmpty
              icon={<Heart size={28} />}
              title="Your stars are saved"
              detail={
                favoritesLocal
                  ? `${countLabel(favoriteDisplayMetadataCount, "local favorite")} ${favoriteDisplayMetadataCount === 1 ? "is" : "are"} waiting for display metadata. Coda will repair ${favoriteDisplayMetadataCount === 1 ? "it" : "them"} when the item is loaded.`
                  : `Bandcamp returned ${countLabel(favoriteTrackCount + favoriteAlbumCount, "favorite ID")} without display metadata. Refresh after your collection finishes syncing.`
              }
              action={
                favoritesLocal ? undefined : (
                  <Button
                    onClick={onRefreshFavorites}
                    disabled={favoritesLoading}
                    size="compact"
                  >
                    {favoritesLoading ? (
                      <Spinner
                        aria-hidden="true"
                        className="size-4 text-current"
                      />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    {favoritesLoading ? "Refreshing…" : "Refresh metadata"}
                  </Button>
                )
              }
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
                      activeFavoriteTrack &&
                        "border-primary/30 bg-primary/10 text-accent-foreground",
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
                    {activeFavoriteTrack
                      ? playing
                        ? "Pause"
                        : "Resume"
                      : "Play all"}
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
                  const albumId = albumRouteId(track.albumId);
                  const trackArtistKey = artistRouteKey(track.artist);
                  return (
                    <div
                      {...rowProps}
                      className={cn(
                        "group relative grid h-14 grid-cols-[2rem_2.5rem_minmax(0,1fr)_3rem_repeat(3,2rem)] items-center gap-x-1.5 overflow-hidden border-b border-white/7 pr-2 pl-1 transition-colors last:border-b-0 hover:bg-white/3 lg:grid-cols-[2rem_2.5rem_minmax(0,1fr)_4rem_repeat(3,2rem)] lg:gap-x-2 lg:pr-3",
                        activeTrack &&
                          "bg-primary/5 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:content-['']",
                      )}
                      data-album-card={track.albumId}
                    >
                      <Button
                        className={cn(
                          "group/number size-full rounded-none p-0 text-xs font-normal text-[#777a76] hover:bg-transparent",
                          activeTrack && "text-[#e88c75]",
                        )}
                        onClick={
                          activeTrack
                            ? onTogglePlayback
                            : () => onPlayTrack(track)
                        }
                        aria-label={
                          activeTrack
                            ? `${playing ? "Pause" : "Resume"} ${track.title}`
                            : `Play ${track.title}`
                        }
                        aria-pressed={activeTrack && playing}
                        variant="ghost"
                      >
                        <span
                          className={
                            activeTrack ? "hidden" : "group-hover:hidden"
                          }
                        >
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
                      {albumId ? (
                        <Link
                          aria-busy={albumLoading || undefined}
                          aria-disabled={albumLoading || undefined}
                          aria-label={`Open ${track.album} album`}
                          className="block size-10 rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-60"
                          data-album-open={track.albumId}
                          data-navigation-slot={`favorite-track-artwork:${track.id}`}
                          onClick={(event) => {
                            if (albumLoading) {
                              event.preventDefault();
                              return;
                            }
                            handleCodaLinkActivation(event, (trigger) =>
                              onOpenTrackAlbum(track, trigger),
                            );
                          }}
                          params={{ albumId }}
                          search={(previous) =>
                            validateCollectionSearch(previous)
                          }
                          to="/collection/albums/$albumId"
                        >
                          <FavoriteArtwork item={track} />
                        </Link>
                      ) : (
                        <FavoriteArtwork item={track} />
                      )}
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <Button
                          className={cn(
                            "h-auto w-fit max-w-full justify-start overflow-hidden rounded-none p-0 text-xs/4 text-[#d9d8d2] hover:bg-transparent hover:text-accent-foreground",
                            activeTrack && "text-[#f0d7cf]",
                          )}
                          onClick={
                            activeTrack
                              ? onTogglePlayback
                              : () => onPlayTrack(track)
                          }
                          variant="ghost"
                        >
                          <OverflowMarquee
                            className="max-w-full"
                            text={track.title}
                          />
                        </Button>
                        <div className="flex min-w-0 items-center gap-1">
                          {trackArtistKey ? (
                            <Link
                              className={metadataLinkClassName}
                              data-artist-open={trackArtistKey}
                              data-coda-artist-name-target={trackArtistKey}
                              data-navigation-slot={`favorite-track-artist:${track.id}`}
                              onClick={(event) =>
                                handleCodaLinkActivation(event, (trigger) =>
                                  onOpenArtist(
                                    track.artist,
                                    albumId,
                                    track,
                                    trigger,
                                  ),
                                )
                              }
                              params={{ artistKey: trackArtistKey }}
                              search={(previous) =>
                                libraryArtistRouteSearch(previous, albumId)
                              }
                              to="/collection/artists/$artistKey"
                            >
                              <ArtistTransitionName artistKey={trackArtistKey}>
                                {track.artist}
                              </ArtistTransitionName>
                            </Link>
                          ) : (
                            <span className={metadataTextClassName}>
                              {track.artist}
                            </span>
                          )}
                          <span aria-hidden="true">·</span>
                          {albumId ? (
                            <Link
                              aria-busy={albumLoading || undefined}
                              aria-disabled={albumLoading || undefined}
                              aria-label={`Open ${track.album} album`}
                              className={cn(
                                metadataLinkClassName,
                                "gap-1 aria-disabled:cursor-default aria-disabled:opacity-100",
                              )}
                              data-album-open={track.albumId}
                              data-coda-album-title-target={track.albumId}
                              data-navigation-slot={`favorite-track:${track.id}`}
                              onClick={(event) => {
                                if (albumLoading) {
                                  event.preventDefault();
                                  return;
                                }
                                handleCodaLinkActivation(event, (trigger) =>
                                  onOpenTrackAlbum(track, trigger),
                                );
                              }}
                              params={{ albumId }}
                              search={(previous) =>
                                validateCollectionSearch(previous)
                              }
                              to="/collection/albums/$albumId"
                            >
                              {albumLoading ? (
                                <Spinner
                                  aria-label={`Loading ${track.album} album`}
                                  className="size-3 text-current"
                                />
                              ) : null}
                              <OverflowMarquee
                                className="max-w-full"
                                text={track.album}
                              />
                            </Link>
                          ) : (
                            <span className={metadataTextClassName}>
                              {track.album}
                            </span>
                          )}
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
                        onClick={() =>
                          onToggleFavorite(track.id, "song", false)
                        }
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
              <ResponsiveVirtualGrid
                aria-label="Favorite radio shows"
                className="w-full"
                getItemKey={(show) => show.id}
                items={favoriteRadioShows}
                layouts={FAVORITE_RADIO_GRID_LAYOUTS}
                scrollElementRef={favoriteScrollElementRef}
                renderItem={(show) => {
                  const identity = radioShowIdentity(show);
                  const activeShow = currentTrackId === `radio:${show.id}`;
                  const busyAction =
                    radioAction?.id === show.id
                      ? radioAction.action
                      : undefined;
                  const showId = radioShowId(show.id);
                  const showIdParam = showId
                    ? stringifyRadioShowIdParam(showId)
                    : undefined;
                  const seriesId = radioSeriesId(radioSeriesForShow(show)?.id);
                  const openShow = (event: MouseEvent<HTMLAnchorElement>) => {
                    if (!showId) return;
                    handleCodaLinkActivation(event, () =>
                      onOpenRadioShow(show),
                    );
                  };
                  return (
                    <article
                      className={cn(
                        "grid h-full min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3 rounded-lg border border-border bg-white/2 p-3 transition-[border-color,background-color,transform] duration-(--duration-coda-fast) hover:-translate-y-px hover:border-white/12 hover:bg-white/3 lg:grid-cols-[3rem_minmax(0,1fr)_auto]",
                        activeShow && "border-primary/30 bg-primary/7",
                      )}
                    >
                      {showIdParam ? (
                        <Link
                          className="size-11 overflow-hidden rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:size-12"
                          data-radio-show-open={show.id}
                          onClick={openShow}
                          params={{ showId: showIdParam }}
                          to="/radio/shows/$showId"
                          aria-label={`Open ${identity.episodeTitle} episode`}
                        >
                          <span
                            className="block size-full"
                            data-radio-show-artwork={show.id}
                          >
                            <FavoriteArtwork
                              className="size-full"
                              item={{
                                title: identity.episodeTitle,
                                palette: paletteFor(`radio:${show.id}`),
                              }}
                            />
                          </span>
                        </Link>
                      ) : (
                        <FavoriteArtwork
                          className="size-11 lg:size-12"
                          item={{
                            title: identity.episodeTitle,
                            palette: paletteFor(`radio:${show.id}`),
                          }}
                        />
                      )}
                      <div className="flex min-w-0 flex-col gap-1">
                        <Link
                          activeOptions={{ exact: true }}
                          className={cn(
                            eyebrowClassName,
                            "mb-0 inline-flex h-auto w-fit max-w-full items-center justify-start gap-1 truncate rounded-none p-0 outline-none hover:bg-transparent hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                          )}
                          onClick={(event) =>
                            handleCodaLinkActivation(event, () =>
                              onOpenRadioSeries(seriesId),
                            )
                          }
                          aria-label={`Browse ${identity.seriesTitle ?? BANDCAMP_RADIO_PROVIDER}`}
                          {...(seriesId
                            ? {
                                params: { seriesId },
                                to: "/radio/series/$seriesId" as const,
                              }
                            : { to: "/radio" as const })}
                        >
                          <Radio size={12} />
                          {identity.seriesTitle ?? BANDCAMP_RADIO_PROVIDER}
                        </Link>
                        <span data-radio-show-title={show.id}>
                          {showIdParam ? (
                            <Link
                              className="inline-flex h-auto w-fit max-w-full justify-start overflow-hidden rounded-none p-0 text-xs text-[#deddd7] outline-none hover:bg-transparent hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                              data-radio-show-open={show.id}
                              onClick={openShow}
                              params={{ showId: showIdParam }}
                              to="/radio/shows/$showId"
                              aria-label={`Open ${identity.episodeTitle} details`}
                            >
                              <OverflowMarquee
                                className="max-w-full"
                                staticTextProps={{
                                  "data-coda-radio-title-text": show.id,
                                }}
                                text={identity.episodeTitle}
                              />
                            </Link>
                          ) : (
                            <OverflowMarquee
                              className="max-w-full text-xs text-[#deddd7]"
                              text={identity.episodeTitle}
                            />
                          )}
                        </span>
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
                          className={
                            activeShow && playing ? "text-primary" : undefined
                          }
                          onClick={
                            activeShow
                              ? onTogglePlayback
                              : () => void actOnFavoriteRadioShow(show, "play")
                          }
                          disabled={Boolean(radioAction)}
                          aria-label={
                            activeShow
                              ? `${playing ? "Pause" : "Resume"} ${identity.episodeTitle}`
                              : `Play ${identity.episodeTitle}`
                          }
                          aria-pressed={activeShow && playing}
                          title={
                            activeShow ? (playing ? "Pause" : "Resume") : "Play"
                          }
                          size="icon"
                          variant="ghost"
                        >
                          {busyAction === "play" ? (
                            <Spinner
                              aria-hidden="true"
                              className="size-4 text-current"
                            />
                          ) : (
                            <PlaybackIcon
                              className="size-4"
                              playing={activeShow && playing}
                            />
                          )}
                        </Button>
                        <Button
                          onClick={() =>
                            void actOnFavoriteRadioShow(show, "queue")
                          }
                          disabled={Boolean(radioAction)}
                          aria-label={`Add ${identity.episodeTitle} to queue`}
                          title="Add to queue"
                          size="icon"
                          variant="ghost"
                        >
                          {busyAction === "queue" ? (
                            <Spinner
                              aria-hidden="true"
                              className="size-4 text-current"
                            />
                          ) : (
                            <ListPlus size={15} />
                          )}
                        </Button>
                        <Button
                          className="text-[#ef8066]"
                          onClick={() => onToggleRadioFavorite(show, false)}
                          aria-label={`Remove ${identity.episodeTitle} from favorites`}
                          title="Remove from favorites"
                          size="icon"
                          variant="ghost"
                        >
                          <Heart size={15} fill="currentColor" />
                        </Button>
                      </div>
                    </article>
                  );
                }}
              />
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
              <ResponsiveVirtualGrid
                aria-label="Favorite releases"
                className="w-full"
                getItemKey={(album) => album.id}
                items={favoriteAlbums}
                layouts={FAVORITE_ALBUM_GRID_LAYOUTS}
                scrollElementRef={favoriteScrollElementRef}
                renderItem={(album) => {
                  const albumLoading = loadingAlbumId === album.id;
                  const albumId = albumRouteId(album.id);
                  const albumArtistKey = artistRouteKey(album.artist);
                  return (
                    <article
                      className="grid h-full grid-cols-[minmax(0,1fr)_2rem] items-center gap-1 rounded-lg border border-border bg-white/2 p-2"
                      data-album-card={album.id}
                    >
                      <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
                        {albumId ? (
                          <Link
                            aria-busy={albumLoading || undefined}
                            aria-disabled={albumLoading || undefined}
                            aria-label={`Open ${album.title}`}
                            className="relative grid size-12 place-items-center overflow-hidden rounded-md p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-100"
                            data-album-open={album.id}
                            data-navigation-slot="artwork"
                            onClick={(event) => {
                              if (albumLoading) {
                                event.preventDefault();
                                return;
                              }
                              handleCodaLinkActivation(event, (trigger) =>
                                onOpenAlbum(album, trigger),
                              );
                            }}
                            params={{ albumId }}
                            search={(previous) =>
                              validateCollectionSearch(previous)
                            }
                            to="/collection/albums/$albumId"
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
                          </Link>
                        ) : (
                          <FavoriteArtwork className="size-12" item={album} />
                        )}
                        <span className="flex min-w-0 flex-col">
                          {albumId ? (
                            <Link
                              aria-busy={albumLoading || undefined}
                              aria-disabled={albumLoading || undefined}
                              aria-label={
                                albumLoading ? album.title : undefined
                              }
                              className="inline-flex h-auto w-fit max-w-full items-center justify-start gap-1 overflow-hidden rounded-none p-0 text-xs text-[#d8d7d1] outline-none hover:bg-transparent hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-100"
                              data-album-open={album.id}
                              data-coda-album-title-target={album.id}
                              data-navigation-slot="title"
                              onClick={(event) => {
                                if (albumLoading) {
                                  event.preventDefault();
                                  return;
                                }
                                handleCodaLinkActivation(event, (trigger) =>
                                  onOpenAlbum(album, trigger),
                                );
                              }}
                              params={{ albumId }}
                              search={(previous) =>
                                validateCollectionSearch(previous)
                              }
                              to="/collection/albums/$albumId"
                            >
                              {albumLoading ? (
                                <Spinner
                                  aria-label={`Loading ${album.title} release`}
                                  className="size-3 text-current"
                                />
                              ) : null}
                              <OverflowMarquee
                                className="max-w-full"
                                text={album.title}
                              />
                            </Link>
                          ) : (
                            <OverflowMarquee
                              className="max-w-full text-xs text-[#d8d7d1]"
                              text={album.title}
                            />
                          )}
                          {albumArtistKey ? (
                            <Link
                              className={cn(
                                metadataLinkClassName,
                                "mt-1 max-w-full",
                              )}
                              data-artist-open={albumArtistKey}
                              data-coda-artist-name-target={albumArtistKey}
                              data-navigation-slot={`favorite-album-artist:${album.id}`}
                              onClick={(event) =>
                                handleCodaLinkActivation(event, (trigger) =>
                                  onOpenArtist(
                                    album.artist,
                                    albumId,
                                    undefined,
                                    trigger,
                                  ),
                                )
                              }
                              params={{ artistKey: albumArtistKey }}
                              search={(previous) =>
                                libraryArtistRouteSearch(previous, albumId)
                              }
                              to="/collection/artists/$artistKey"
                            >
                              <ArtistTransitionName artistKey={albumArtistKey}>
                                {album.artist}
                              </ArtistTransitionName>
                            </Link>
                          ) : (
                            <span className="mt-1 truncate text-xs text-[#777b76]">
                              {album.artist}
                            </span>
                          )}
                        </span>
                      </div>
                      <Button
                        className="text-[#ef8066]"
                        onClick={() =>
                          onToggleFavorite(album.id, "album", false)
                        }
                        aria-label={`Remove ${album.title} from favorites`}
                        size="icon"
                        variant="ghost"
                      >
                        <Heart size={15} fill="currentColor" />
                      </Button>
                    </article>
                  );
                }}
              />
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
