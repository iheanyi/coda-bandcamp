import {
  ArrowLeft,
  Check,
  Clock3,
  HardDrive,
  Heart,
  ListMusic,
  ListPlus,
  LoaderCircle,
  Music2,
  Pause,
  Pencil,
  Play,
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
import { type FormEvent, useEffect, useMemo, useState } from "react";
import {
  createPlaylist,
  deletePlaylist,
  fetchCoverUrl,
  fetchPlaylist,
  fetchPlaylists,
  fetchRadioShow,
  formatTime,
  paletteFor,
  updatePlaylist,
} from "./lib";
import { countLabel } from "./countLabel";
import { shuffled } from "./queue";
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
  onOpenAlbum: (album: Album) => void;
  onOpenTrackAlbum: (track: Track) => void;
  onOpenArtist: (artist: string) => void;
  onOpenRadioShow: (show: RadioShowSummary) => void;
  onOpenRadioSeries: (seriesId?: number) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onNotify: (message: string, tone?: "good" | "bad") => void;
};

const RADIO_STALE_TIME_MS = 10 * 60 * 1_000;
const playlistTrackKey = (track: Track, index: number) => `${track.id}-${index}`;
const favoriteTrackKey = (track: Track) => track.id;
const radioDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

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

function FavoriteArtwork({
  item,
}: {
  item: Pick<Album, "title" | "coverArt" | "artworkUrl" | "palette">;
}) {
  const [url, setUrl] = useState(item.artworkUrl);

  useEffect(() => {
    let active = true;
    if (item.artworkUrl) {
      setUrl(item.artworkUrl);
      return;
    }
    if (!item.coverArt) {
      setUrl(undefined);
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
  }, [item.artworkUrl, item.coverArt]);

  return (
    <span
      className="favorite-artwork"
      style={{
        background: `linear-gradient(145deg, ${item.palette[0]}, ${item.palette[1]})`,
      }}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" loading="lazy" onError={() => setUrl(undefined)} />
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
    <div className="saved-empty">
      <span className="saved-empty__icon">{icon}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </div>
  );
}

function PlaylistList({
  playlists,
  onOpen,
  onCreate,
  creating,
}: {
  playlists: PlaylistSummary[];
  onOpen: (playlist: PlaylistSummary) => void;
  onCreate: (name: string) => void;
  creating: boolean;
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
      <form className="playlist-create" onSubmit={submit}>
        <div className="playlist-create__copy">
          <span className="eyebrow">New playlist</span>
          <strong>Create a playlist</strong>
          <p>Playlists sync with your Bandcamp collection.</p>
        </div>
        <label>
          <span className="sr-only">Playlist name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={256}
            placeholder="Late-night rotation"
          />
        </label>
        <button className="primary-button" type="submit" disabled={!name.trim() || creating}>
          {creating ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
          {creating ? "Creating…" : "Create"}
        </button>
      </form>

      {playlists.length ? (
        <div className="playlist-grid">
          {playlists.map((playlist) => (
            <button
              aria-busy={isOptimisticPlaylist(playlist)}
              className="playlist-card"
              disabled={isOptimisticPlaylist(playlist)}
              key={playlist.id}
              onClick={() => onOpen(playlist)}
            >
              <span className="playlist-card__art">
                <ListMusic size={25} />
              </span>
              <span className="playlist-card__copy">
                <strong>{playlist.name}</strong>
                <span>
                  {countLabel(playlist.songCount, "track")}
                  {playlist.duration ? ` · ${formatTime(playlist.duration)}` : ""}
                </span>
                {playlist.comment ? <small>{playlist.comment}</small> : null}
              </span>
              <span className="playlist-card__open">
                {isOptimisticPlaylist(playlist) ? "Creating…" : "Open"}
              </span>
            </button>
          ))}
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
  onTogglePlayback: () => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onOpenTrackAlbum: (track: Track) => void;
  onOpenArtist: (artist: string) => void;
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
      <div className="saved-page">
        <button className="saved-page__back" onClick={onBack}>
          <ArrowLeft size={15} /> All playlists
        </button>
        <SavedEmpty
          icon={<LoaderCircle className="spin" size={28} />}
          title="Loading playlist"
          detail="Pulling the latest track order from Bandcamp…"
        />
      </div>
    );
  }

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
    <article className="saved-page" aria-busy={actionPending}>
      <button className="saved-page__back" onClick={onBack}>
        <ArrowLeft size={15} /> All playlists
      </button>
      <header className="saved-hero">
        <span className="saved-hero__art"><ListMusic size={38} /></span>
        <div>
          <span className="eyebrow">Bandcamp playlist</span>
          {editing ? (
            <form className="playlist-rename" onSubmit={submitRename}>
              <input
                autoFocus
                value={name}
                maxLength={256}
                aria-label="Playlist name"
                onChange={(event) => setName(event.target.value)}
              />
              <button
                className="icon-button"
                type="submit"
                aria-label="Save playlist name"
                disabled={actionPending}
              >
                {renaming
                  ? <LoaderCircle className="spin" size={17} />
                  : <Check size={17} />}
              </button>
              <button
                className="icon-button"
                type="button"
                aria-label="Cancel renaming"
                disabled={actionPending}
                onClick={() => {
                  setEditing(false);
                  setName(playlist.name);
                }}
              >
                <X size={17} />
              </button>
            </form>
          ) : (
            <div className="saved-hero__title">
              <h1>{playlist.name}</h1>
              <button
                className="icon-button"
                onClick={() => setEditing(true)}
                aria-label={`Rename ${playlist.name}`}
              >
                <Pencil size={15} />
              </button>
            </div>
          )}
          <p>
            {countLabel(playlist.songCount, "track")}
            {playlist.duration ? ` · ${formatTime(playlist.duration)}` : ""}
            {" · Synced with Bandcamp"}
          </p>
          <div className="saved-hero__actions">
            <button
              className={`primary-button ${activePlaylist ? "is-current" : ""} ${activePlaylist && playing ? "is-playing" : ""}`}
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
            >
              {activePlaylist && playing
                ? <Pause size={16} fill="currentColor" />
                : <Play size={16} fill="currentColor" />}
              {activePlaylist ? (playing ? "Pause" : "Resume") : "Play"}
            </button>
            <button
              className="secondary-button"
              disabled={!playlist.tracks.length}
              onClick={() => onPlay(shuffled(playlist.tracks))}
            >
              <Shuffle size={16} /> Shuffle
            </button>
            <button
              className="secondary-button"
              disabled={!playlist.tracks.length}
              onClick={() => onQueue(playlist.tracks)}
            >
              <ListPlus size={16} /> Add to queue
            </button>
          </div>
        </div>
      </header>

      {playlist.tracks.length ? (
        <VirtualizedSavedTrackList
          aria-label={`${playlist.name} tracks`}
          className="saved-tracklist"
          getItemKey={playlistTrackKey}
          items={playlist.tracks}
          renderItem={(track, { index }, rowProps) => {
            const activeTrack = currentTrackId === track.id;
            return (
            <div
              {...rowProps}
              className={`saved-track saved-track--playlist ${activeTrack ? "is-current" : ""}`}
            >
              <button
                className={`saved-track__number ${activeTrack && playing ? "is-playing" : ""}`}
                onClick={activeTrack ? onTogglePlayback : () => onPlay([track])}
                aria-label={
                  activeTrack
                    ? `${playing ? "Pause" : "Resume"} ${track.title}`
                    : `Play ${track.title}`
                }
                aria-pressed={activeTrack && playing}
              >
                <span>{index + 1}</span>
                {activeTrack && playing
                  ? <Pause size={13} fill="currentColor" />
                  : <Play size={13} fill="currentColor" />}
              </button>
              <div className="saved-track__copy">
                <button
                  className="saved-track__title-link"
                  onClick={activeTrack ? onTogglePlayback : () => onPlay([track])}
                >
                  {track.title}
                </button>
                <span className="saved-track__metadata">
                  <button
                    className="metadata-link"
                    onClick={() => onOpenArtist(track.artist)}
                  >
                    {track.artist}
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    className="metadata-link"
                    onClick={() => onOpenTrackAlbum(track)}
                  >
                    {track.album}
                  </button>
                </span>
              </div>
              <span className="saved-track__duration">{formatTime(track.duration)}</span>
              <button
                className="icon-button"
                onClick={() => onAddToPlaylist([track])}
                title="Add to another playlist"
                aria-label={`Add ${track.title} to another playlist`}
              >
                <ListPlus size={15} />
              </button>
              <button
                className="icon-button"
                disabled={actionPending}
                onClick={() => onRemove(index)}
                title="Remove from playlist"
                aria-label={`Remove ${track.title} from ${playlist.name}`}
              >
                {pendingRemovalIndex === index
                  ? <LoaderCircle className="spin" size={15} />
                  : <X size={15} />}
              </button>
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

      <div className="playlist-danger">
        {confirmDelete ? (
          <>
            <span>Delete “{playlist.name}” from Bandcamp?</span>
            <button className="danger-button" disabled={actionPending} onClick={onDelete}>
              {deleting ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
              {deleting ? "Deleting…" : "Delete playlist"}
            </button>
            <button
              className="text-button"
              onClick={() => setConfirmDelete(false)}
              disabled={actionPending}
            >
              Keep it
            </button>
          </>
        ) : (
          <button className="text-button text-button--danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={14} /> Delete playlist
          </button>
        )}
      </div>
    </article>
  );
}

export function AddToPlaylistDialog({
  tracks,
  onClose,
  onNotify,
}: {
  tracks: Track[];
  onClose: () => void;
  onNotify: (message: string, tone?: "good" | "bad") => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
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
    onSuccess: (updated) => {
      queryClient.setQueryData(playlistQueryKey(updated.id), updated);
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => upsertPlaylistSummary(current, playlistSummary(updated)),
      );
      onNotify(`${countLabel(tracks.length, "track")} added to ${updated.name}`, "good");
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
        (current) => replaceOptimisticPlaylist(
          current,
          context?.optimisticId,
          playlistSummary(created),
        ),
      );
      onNotify(`${created.name} created with ${countLabel(tracks.length, "track")}`, "good");
      onClose();
    },
    onError: (cause, _playlistName, context) => {
      if (context) restorePlaylistList(queryClient, context.previousPlaylists);
      onNotify(mutationError(cause), "bad");
    },
  });
  const pending = addMutation.isPending || createMutation.isPending;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, pending]);
  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (nextName) createMutation.mutate(nextName);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onClose();
    }}>
      <section
        className="playlist-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Add to playlist"
        aria-busy={pending || playlists.isFetching}
      >
        <header>
          <div>
            <span className="eyebrow">Bandcamp playlists</span>
            <h2>Add to playlist</h2>
            <p>{countLabel(tracks.length, "track")} selected</p>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close add to playlist"
            disabled={pending}
          >
            <X size={18} />
          </button>
        </header>
        <form className="playlist-dialog__create" onSubmit={submitCreate}>
          <input
            autoFocus
            value={name}
            maxLength={256}
            onChange={(event) => setName(event.target.value)}
            placeholder="Create a new playlist"
            aria-label="New playlist name"
          />
          <button className="secondary-button" type="submit" disabled={!name.trim() || pending}>
            {createMutation.isPending
              ? <LoaderCircle className="spin" size={15} />
              : <Plus size={15} />}
            {createMutation.isPending ? "Creating…" : "Create"}
          </button>
        </form>
        <div className="playlist-dialog__list">
          {playlists.isLoading ? (
            <span className="playlist-dialog__status"><LoaderCircle className="spin" size={17} /> Loading playlists…</span>
          ) : playlists.isError ? (
            <span className="playlist-dialog__status playlist-dialog__status--error">
              Couldn’t load playlists.
              <button
                onClick={() => void playlists.refetch()}
                disabled={playlists.isFetching}
              >
                {playlists.isFetching ? "Trying again…" : "Try again"}
              </button>
            </span>
          ) : playlists.data?.length ? (
            playlists.data.map((playlist) => (
              <button
                key={playlist.id}
                className="playlist-dialog__option"
                disabled={pending}
                onClick={() => addMutation.mutate(playlist)}
              >
                <span><ListMusic size={17} /></span>
                <span>
                  <strong>{playlist.name}</strong>
                  <small>{countLabel(playlist.songCount, "track")}</small>
                </span>
                {addMutation.isPending && addMutation.variables.id === playlist.id
                  ? <LoaderCircle className="spin" size={16} />
                  : <Plus size={16} />}
              </button>
            ))
          ) : (
            <span className="playlist-dialog__status">No playlists yet. Create one above.</span>
          )}
        </div>
      </section>
    </div>
  );
}

export default function SavedLibraryView({
  mode,
  connected,
  favorites,
  favoritesLoading,
  favoritesError,
  favoritesLocal = false,
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
  const [radioAction, setRadioAction] = useState<{
    id: number;
    action: "play" | "queue";
  }>();
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
    onSuccess: (updated) => {
      queryClient.setQueryData(playlistQueryKey(updated.id), updated);
      queryClient.setQueryData<PlaylistSummary[]>(
        PLAYLISTS_QUERY_KEY,
        (current) => upsertPlaylistSummary(current, playlistSummary(updated)),
      );
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
      void transitionCodaView(
        () => setSelectedPlaylistId(undefined),
        "page-back",
      );
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
      <section className="saved-library">
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
      <section className="saved-library">
        {playlist.isError ? (
          <SavedEmpty
            icon={<ListMusic size={28} />}
            title="This playlist couldn’t load"
            detail={mutationError(playlist.error)}
            action={(
              <button
                onClick={() => void playlist.refetch()}
                disabled={playlist.isFetching}
              >
                {playlist.isFetching
                  ? <LoaderCircle className="spin" size={14} />
                  : <RefreshCw size={14} />}
                {playlist.isFetching ? "Trying again…" : "Try again"}
              </button>
            )}
          />
        ) : (
          <PlaylistDetailView
            playlist={playlist.data}
            loading={playlist.isLoading}
            onBack={() => {
              void transitionCodaView(
                () => setSelectedPlaylistId(undefined),
                "page-back",
              );
            }}
            onPlay={onPlayTracks}
            onQueue={onQueueTracks}
            currentTrackId={currentTrackId}
            playing={playing}
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
      <section className="saved-library">
        <header className="saved-library__header">
          <div>
            <span className="eyebrow">Synced with Bandcamp</span>
            <h1>Playlists</h1>
            <p>Build a sequence here and it follows you to Bandcamp.</p>
          </div>
          <button className="artwork-button" onClick={() => void playlists.refetch()} disabled={playlists.isFetching}>
            <RefreshCw size={15} className={playlists.isFetching ? "spin" : ""} />
            {playlists.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </header>
        {playlists.isLoading ? (
          <SavedEmpty
            icon={<LoaderCircle className="spin" size={28} />}
            title="Loading playlists"
            detail="Pulling your latest Bandcamp mixes…"
          />
        ) : playlists.isError ? (
          <SavedEmpty
            icon={<ListMusic size={28} />}
            title="Playlists couldn’t load"
            detail={mutationError(playlists.error)}
            action={(
              <button
                onClick={() => void playlists.refetch()}
                disabled={playlists.isFetching}
              >
                <RefreshCw
                  className={playlists.isFetching ? "spin" : ""}
                  size={14}
                />
                {playlists.isFetching ? "Trying again…" : "Try again"}
              </button>
            )}
          />
        ) : (
          <PlaylistList
            playlists={playlists.data ?? []}
            onOpen={(item) => {
              void transitionCodaView(
                () => setSelectedPlaylistId(item.id),
                "page-forward",
              );
            }}
            onCreate={(name) => createMutation.mutate(name)}
            creating={createMutation.isPending}
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
    <section className="saved-library">
      <header className="saved-library__header">
        <div>
          <span className="eyebrow">
            {favoritesLocal ? <><HardDrive size={12} /> On this device</> : "Your keepers"}
          </span>
          <h1>Favorites</h1>
          <p>
            {favoritesLocal
              ? "Your personal shortlist, saved only in Coda on this computer."
              : "Starred releases and tracks from your Bandcamp collection."}
          </p>
        </div>
        {favoritesLocal ? (
          <span className="saved-library__local-badge">
            <HardDrive size={14} /> Local
          </span>
        ) : (
          <button className="artwork-button" onClick={onRefreshFavorites} disabled={favoritesLoading}>
            <RefreshCw size={15} className={favoritesLoading ? "spin" : ""} />
            {favoritesLoading ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </header>
      {favoritesLoading ? (
        <SavedEmpty
          icon={<LoaderCircle className="spin" size={28} />}
          title="Loading favorites"
          detail="Looking through your starred Bandcamp music…"
        />
      ) : favoritesError ? (
        <SavedEmpty
          icon={<Heart size={28} />}
          title="Favorites couldn’t load"
          detail={favoritesError}
          action={(
            <button onClick={onRefreshFavorites} disabled={favoritesLoading}>
              <RefreshCw className={favoritesLoading ? "spin" : ""} size={14} />
              {favoritesLoading ? "Trying again…" : "Try again"}
            </button>
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
                <button onClick={onRefreshFavorites} disabled={favoritesLoading}>
                  <RefreshCw className={favoritesLoading ? "spin" : ""} size={14} />
                  {favoritesLoading ? "Refreshing…" : "Refresh metadata"}
                </button>
              )}
            />
          ) : null}
          {favoriteTracks.length ? (
            <section className="favorites-section">
              <div className="section-heading">
                <h2>Tracks</h2>
                <div className="section-heading__actions">
                  <span>{countLabel(favoriteTrackCount, "track")}</span>
                  <button
                    className={`queue-results-button ${activeFavoriteTrack ? "is-current" : ""} ${activeFavoriteTrack && playing ? "is-playing" : ""}`}
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
                  >
                    {activeFavoriteTrack && playing
                      ? <Pause size={14} fill="currentColor" />
                      : <Play size={14} fill="currentColor" />}
                    {activeFavoriteTrack ? (playing ? "Pause" : "Resume") : "Play all"}
                  </button>
                  <button className="queue-results-button" onClick={() => onQueueTracks(favoriteTracks)}>
                    <ListPlus size={14} /> Add all
                  </button>
                </div>
              </div>
              <VirtualizedSavedTrackList
                aria-label="Favorite tracks"
                className="saved-tracklist"
                getItemKey={favoriteTrackKey}
                items={favoriteTracks}
                renderItem={(track, { index }, rowProps) => {
                  const activeTrack = currentTrackId === track.id;
                  return (
                  <div
                    {...rowProps}
                    className={`saved-track saved-track--favorite ${activeTrack ? "is-current" : ""}`}
                  >
                    <button
                      className={`saved-track__number ${activeTrack && playing ? "is-playing" : ""}`}
                      onClick={activeTrack ? onTogglePlayback : () => onPlayTrack(track)}
                      aria-label={
                        activeTrack
                          ? `${playing ? "Pause" : "Resume"} ${track.title}`
                          : `Play ${track.title}`
                      }
                      aria-pressed={activeTrack && playing}
                    >
                      <span>{index + 1}</span>
                      {activeTrack && playing
                        ? <Pause size={13} fill="currentColor" />
                        : <Play size={13} fill="currentColor" />}
                    </button>
                    <FavoriteArtwork item={track} />
                    <div className="saved-track__copy">
                      <button
                        className="saved-track__title-link"
                        onClick={activeTrack ? onTogglePlayback : () => onPlayTrack(track)}
                      >
                        {track.title}
                      </button>
                      <span className="saved-track__metadata">
                        <button
                          className="metadata-link"
                          onClick={() => onOpenArtist(track.artist)}
                        >
                          {track.artist}
                        </button>
                        <span aria-hidden="true">·</span>
                        <button
                          className="metadata-link"
                          onClick={() => onOpenTrackAlbum(track)}
                        >
                          {track.album}
                        </button>
                      </span>
                    </div>
                    <span className="saved-track__duration"><Clock3 size={12} /> {formatTime(track.duration)}</span>
                    <button className="icon-button" onClick={() => onQueueTrack(track)} aria-label={`Add ${track.title} to queue`} title="Add to queue">
                      <Plus size={15} />
                    </button>
                    <button className="icon-button" onClick={() => onAddToPlaylist([track])} aria-label={`Add ${track.title} to playlist`} title="Add to playlist">
                      <ListPlus size={15} />
                    </button>
                    <button className="icon-button favorite-button is-favorite" onClick={() => onToggleFavorite(track.id, "song", false)} aria-label={`Remove ${track.title} from favorites`} title="Remove from favorites">
                      <Heart size={15} fill="currentColor" />
                    </button>
                  </div>
                  );
                }}
              />
            </section>
          ) : null}
          {favoriteRadioShows.length ? (
            <section className="favorites-section">
              <div className="section-heading">
                <h2>Radio shows</h2>
                <span>{countLabel(favoriteRadioShowCount, "show")}</span>
              </div>
              <div className="favorite-radio-grid">
                {favoriteRadioShows.map((show) => {
                  const activeShow = currentTrackId === `radio:${show.id}`;
                  const busyAction = radioAction?.id === show.id
                    ? radioAction.action
                    : undefined;
                  return (
                    <article
                      className={`favorite-radio ${activeShow ? "is-current" : ""}`}
                      key={show.id}
                    >
                      <button
                        className="favorite-radio__art"
                        onClick={() => onOpenRadioShow(show)}
                        aria-label={`Open ${show.subtitle} episode`}
                      >
                        <FavoriteArtwork
                          item={{
                            title: show.subtitle,
                            palette: paletteFor(`radio:${show.id}`),
                          }}
                        />
                      </button>
                      <div className="favorite-radio__copy">
                        <button
                          className="eyebrow favorite-radio__series"
                          onClick={() => onOpenRadioSeries(show.series?.id)}
                          aria-label={`Browse ${show.series?.title ?? "Bandcamp Radio"}`}
                        >
                          <Radio size={12} />
                          {show.series?.title ?? "Bandcamp Radio"}
                        </button>
                        <button
                          className="favorite-radio__title"
                          onClick={() => onOpenRadioShow(show)}
                          aria-label={`Open ${show.subtitle} details`}
                        >
                          {show.subtitle}
                        </button>
                        <time dateTime={show.publishedAt}>
                          {radioShowDate(show.publishedAt)}
                        </time>
                        {show.description ? <p>{show.description}</p> : null}
                      </div>
                      <div className="favorite-radio__actions">
                        <button
                          className={`icon-button ${activeShow && playing ? "is-active" : ""}`}
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
                        >
                          {busyAction === "play"
                            ? <LoaderCircle className="spin" size={15} />
                            : activeShow && playing
                              ? <Pause size={15} fill="currentColor" />
                              : <Play size={15} fill="currentColor" />}
                        </button>
                        <button
                          className="icon-button"
                          onClick={() => void actOnFavoriteRadioShow(show, "queue")}
                          disabled={Boolean(radioAction)}
                          aria-label={`Add ${show.subtitle} to queue`}
                          title="Add to queue"
                        >
                          {busyAction === "queue"
                            ? <LoaderCircle className="spin" size={15} />
                            : <ListPlus size={15} />}
                        </button>
                        <button
                          className="icon-button favorite-button is-favorite"
                          onClick={() => onToggleRadioFavorite(show, false)}
                          aria-label={`Remove ${show.subtitle} from favorites`}
                          title="Remove from favorites"
                        >
                          <Heart size={15} fill="currentColor" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
          {favoriteAlbums.length ? (
            <section className="favorites-section">
              <div className="section-heading">
                <h2>Releases</h2>
                <span>{countLabel(favoriteAlbumCount, "release")}</span>
              </div>
              <div className="favorite-album-grid">
                {favoriteAlbums.map((album) => (
                  <article className="favorite-album" key={album.id}>
                    <div className="favorite-album__open">
                      <button
                        className="favorite-album__art-button"
                        onClick={() => onOpenAlbum(album)}
                        aria-label={`Open ${album.title}`}
                      >
                        <FavoriteArtwork item={album} />
                      </button>
                      <span>
                        <button
                          className="favorite-album__title"
                          onClick={() => onOpenAlbum(album)}
                        >
                          {album.title}
                        </button>
                        <button
                          className="favorite-album__artist metadata-link"
                          onClick={() => onOpenArtist(album.artist)}
                        >
                          {album.artist}
                        </button>
                      </span>
                    </div>
                    <button
                      className="icon-button favorite-button is-favorite"
                      onClick={() => onToggleFavorite(album.id, "album", false)}
                      aria-label={`Remove ${album.title} from favorites`}
                    >
                      <Heart size={15} fill="currentColor" />
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
