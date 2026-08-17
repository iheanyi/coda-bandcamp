import { Heart, ListPlus, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";

import {
  RowActionGroup,
  RowPlaybackAction,
} from "@/components/ItemInteractions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { libraryArtistRouteSearch } from "@/features/library/libraryLinkSearch";
import { ArtistTransitionName } from "@/features/navigation/ArtistTransitionName";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import { validateCollectionSearch } from "@/routing/routeContracts";
import type { Track } from "@/types";
import { VirtualizedSavedTrackList } from "@/VirtualizedSavedTrackList";

import { FavoriteArtwork } from "./FavoriteArtwork";
import {
  albumRouteId,
  artistRouteKey,
  metadataLinkClassName,
  metadataTextClassName,
} from "./savedLibraryPresentationData";

const favoriteTrackKey = (track: Track) => track.id;

export function FavoriteTracksSection({
  tracks,
  trackCount,
  currentTrackId,
  playing,
  loadingAlbumId,
  onTogglePlayback,
  onPlayTracks,
  onQueueTracks,
  onPlayTrack,
  onQueueTrack,
  onAddToPlaylist,
  onToggleFavorite,
  onOpenTrackAlbum,
  onOpenArtist,
}: {
  tracks: Track[];
  trackCount: number;
  currentTrackId?: string;
  playing: boolean;
  loadingAlbumId?: string;
  onTogglePlayback: () => void;
  onPlayTracks: (tracks: Track[]) => void;
  onQueueTracks: (tracks: Track[]) => void;
  onPlayTrack: (track: Track) => void;
  onQueueTrack: (track: Track) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  onToggleFavorite: (
    id: string,
    kind: "song" | "album",
    favorite: boolean,
  ) => void;
  onOpenTrackAlbum: (track: Track, trigger: HTMLElement) => void;
  onOpenArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
    sourceTrigger?: HTMLElement,
  ) => void;
}) {
  const activeFavoriteTrack = tracks.some(
    (track) => track.id === currentTrackId,
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="m-0 font-display text-base leading-none font-semibold tracking-tight">
            Tracks
          </h2>
          <Badge
            className="border-white/8 bg-white/2 text-coda-subtle-foreground"
            size="compact"
            variant="outline"
          >
            {countLabel(trackCount, "track")}
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
                : () => onPlayTracks(tracks)
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
          <Button onClick={() => onQueueTracks(tracks)} size="compact">
            <ListPlus size={14} /> Add all
          </Button>
        </div>
      </div>
      <VirtualizedSavedTrackList
        aria-label="Favorite tracks"
        className="overflow-hidden rounded-xl border border-white/8 bg-black/10 shadow-[0_14px_36px_rgba(0,0,0,0.16)]"
        getItemKey={favoriteTrackKey}
        items={tracks}
        renderItem={(track, { index }, rowProps) => {
          const activeTrack = currentTrackId === track.id;
          const albumLoading = loadingAlbumId === track.albumId;
          const albumId = albumRouteId(track.albumId);
          const trackArtistKey = artistRouteKey(track.artist);
          return (
            <div
              {...rowProps}
              className={cn(
                "group/row relative grid h-14 grid-cols-[2rem_2.5rem_minmax(0,1fr)_3rem_repeat(3,2rem)] items-center gap-x-1.5 overflow-hidden border-b border-white/6 bg-white/[0.012] pr-2 pl-1 transition-colors duration-(--duration-coda-fast) last:border-b-0 hover:bg-white/[0.045] focus-within:bg-white/[0.045] motion-reduce:transition-none lg:grid-cols-[2rem_2.5rem_minmax(0,1fr)_4rem_repeat(3,2rem)] lg:gap-x-2 lg:pr-3",
                activeTrack &&
                  "bg-primary/[0.065] before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:content-['']",
              )}
              data-album-card={track.albumId}
            >
              <RowPlaybackAction
                active={activeTrack}
                ariaLabel={
                  activeTrack
                    ? `${playing ? "Pause" : "Resume"} ${track.title}`
                    : `Play ${track.title}`
                }
                onClick={
                  activeTrack ? onTogglePlayback : () => onPlayTrack(track)
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
                  search={(previous) => validateCollectionSearch(previous)}
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
                    activeTrack ? onTogglePlayback : () => onPlayTrack(track)
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
                    <span className={metadataTextClassName}>{track.artist}</span>
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
                      search={(previous) => validateCollectionSearch(previous)}
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
                    <span className={metadataTextClassName}>{track.album}</span>
                  )}
                </div>
              </div>
              <span className="justify-self-end pr-1 text-right text-xs text-coda-subtle-foreground tabular-nums">
                {formatTime(track.duration)}
              </span>
              <RowActionGroup className="contents">
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
                  className="rounded-full bg-primary/10 text-coda-favorite ring-1 ring-primary/20 ring-inset hover:bg-primary/[0.18] hover:text-coda-favorite"
                  onClick={() => onToggleFavorite(track.id, "song", false)}
                  aria-label={`Remove ${track.title} from favorites`}
                  title="Remove from favorites"
                  size="icon"
                  variant="ghost"
                >
                  <Heart size={15} fill="currentColor" />
                </Button>
              </RowActionGroup>
            </div>
          );
        }}
      />
    </section>
  );
}
