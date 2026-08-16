import {
  ArrowLeft,
  Check,
  ListMusic,
  ListPlus,
  Music2,
  Pencil,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";

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
import {
  RowActionGroup,
  RowPlaybackAction,
} from "@/components/ItemInteractions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { libraryArtistRouteSearch } from "@/features/library/libraryLinkSearch";
import { ArtistTransitionName } from "@/features/navigation/ArtistTransitionName";
import { formatTime, paletteFor } from "@/lib";
import { cn } from "@/lib/utils";
import { shuffled } from "@/queue";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import { validateCollectionSearch } from "@/routing/routeContracts";
import type { PlaylistDetail, Track } from "@/types";
import { VirtualizedSavedTrackList } from "@/VirtualizedSavedTrackList";

import { FavoriteArtwork } from "./FavoriteArtwork";
import {
  albumRouteId,
  artistRouteKey,
  metadataLinkClassName,
  metadataTextClassName,
} from "./savedLibraryPresentationData";
import { Eyebrow, SavedEmpty } from "./SavedLibraryPresentation";

const playlistTrackKey = (track: Track, index: number) =>
  `${track.id}-${index}`;

export function PlaylistDetailView({
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
    <article aria-busy={actionPending}>
      <Button
        className="mb-3 -ml-1 h-auto gap-1.5 p-1 text-xs font-bold"
        onClick={onBack}
        variant="text"
      >
        <ArrowLeft size={15} /> Back
      </Button>
      <div data-coda-playlist-detail-surface={playlist.id}>
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
                    "group/row relative grid h-16 grid-cols-[2rem_2.5rem_minmax(0,1fr)_3rem_repeat(2,2rem)] items-center gap-x-2 py-3 pr-3 pl-1 transition-colors duration-(--duration-coda-fast) after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-white/5 last:after:hidden hover:bg-white/3 focus-within:bg-white/3 motion-reduce:transition-none lg:grid-cols-[2rem_2.5rem_minmax(0,1fr)_4rem_repeat(2,2rem)]",
                    activeTrack && "bg-primary/7.5",
                  )}
                >
                  <RowPlaybackAction
                    active={activeTrack}
                    ariaLabel={
                      activeTrack
                        ? `${playing ? "Pause" : "Resume"} ${track.title}`
                        : `Play ${track.title}`
                    }
                    onClick={
                      activeTrack ? onTogglePlayback : () => onPlay([track])
                    }
                    playing={playing}
                    position={index + 1}
                  />
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
                  <span className="justify-self-end pr-1 text-right text-xs text-coda-subtle-foreground tabular-nums">
                    {formatTime(track.duration)}
                  </span>
                  <RowActionGroup className="contents">
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
                  </RowActionGroup>
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
      </div>
    </article>
  );
}
