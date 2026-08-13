import { ArrowLeft, Clock3, Heart, ListPlus, Music2, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, usePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { VirtualizedSavedTrackList } from "@/VirtualizedSavedTrackList";
import {
  RowActionGroup,
  RowPlaybackAction,
} from "@/components/ItemInteractions";
import { Button } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import { useMotionExitWatchdog } from "@/components/ui/useMotionExitWatchdog";
import { countLabel } from "@/countLabel";
import { CoverArt } from "@/features/artwork/CoverArt";
import { ArtistTransitionName } from "@/features/navigation/ArtistTransitionName";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import { formatAlbumReleaseDate } from "@/libraryDates";
import { artistKey } from "@/libraryBrowse";
import { useCodaMotion } from "@/motion";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import { parseArtistKeyParam } from "@/routing/routeContracts";
import type { Album, Track } from "@/types";
import { libraryArtistRouteSearch } from "./libraryLinkSearch";
import type { ArtistNavigationHandler } from "./types";

export type AlbumDetailPageProps = {
  album: Album;
  loading: boolean;
  onBack: () => void;
  onPlayAlbum: () => void;
  onQueueAlbum: () => void;
  onPlayTrack: (track: Track) => void;
  onQueueTrack: (track: Track) => void;
  onArtist: ArtistNavigationHandler;
  favoriteAlbum: boolean;
  favoriteTrackIds: ReadonlySet<string>;
  onToggleFavoriteAlbum: () => void;
  onToggleFavoriteTrack: (track: Track) => void;
  onAddToPlaylist: (tracks: Track[]) => void;
  currentTrackId?: string;
  currentAlbumId?: string;
  playing: boolean;
  onTogglePlayback: () => void;
  className?: string;
};

function albumTrackKey(track: Track) {
  return track.id;
}

export function AlbumDetailPage({
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
  className,
}: AlbumDetailPageProps) {
  const albumArtistKey = parseArtistKeyParam(artistKey(album.artist));
  const activeAlbum = currentAlbumId === album.id;
  const tracklistState = loading
    ? "loading"
    : album.tracks?.length
      ? "tracks"
      : "empty";

  return (
    <article
      className={cn("mx-auto -mt-2 mb-8 w-full max-w-4xl", className)}
      aria-label={`${album.title} release details`}
      data-coda-album-detail-surface=""
    >
      <Button
        className="mb-3.5 -ml-1 h-auto gap-1.5 p-1 text-xs text-[#8d918b] hover:bg-transparent hover:text-[#eceae4]"
        onClick={onBack}
        size="compact"
        variant="text"
      >
        <ArrowLeft size={15} />
        Back
      </Button>
      <header className="relative grid grid-cols-[10rem_minmax(0,1fr)] items-end gap-6 overflow-hidden rounded-t-xl border border-border bg-[radial-gradient(circle_at_82%_20%,rgba(221,101,73,0.13),transparent_37%),linear-gradient(135deg,#24282a,#191c1e_70%)] p-6 xl:grid-cols-[14rem_minmax(0,1fr)] xl:gap-8 xl:p-8">
        <div className="album-detail__artwork size-40 drop-shadow-[0_16px_25px_rgba(0,0,0,0.25)] *:data-[slot=cover]:size-full *:data-[slot=cover]:rounded-lg xl:size-56">
          <CoverArt album={album} albumArtworkDetail={album.id} size="large" />
        </div>
        <div className="min-w-0 pb-1" data-coda-album-metadata-detail="">
          <span className="mb-2.5 text-xs font-bold tracking-widest text-coda-subtle-foreground uppercase">
            {album.songCount === 1 ? "Single" : "Album"}
          </span>
          <h2
            id="album-detail-heading"
            className="m-0 max-w-lg wrap-anywhere font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-3xl leading-none font-semibold tracking-tighter text-[#f1efe9] outline-none xl:text-4xl"
            tabIndex={-1}
            title={album.title}
          >
            <span
              className="inline-block max-w-full align-top"
              data-coda-album-title-detail={album.id}
            >
              {album.title}
            </span>
          </h2>
          <Link
            className="mx-0 my-2 block max-w-full truncate text-sm font-semibold text-[#d98771] outline-none hover:text-coda-link-hover hover:underline hover:underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            data-artist-open={albumArtistKey}
            data-coda-artist-name-target={albumArtistKey}
            data-navigation-slot={`album-detail-artist:${album.id}`}
            onClick={(event) =>
              handleCodaLinkActivation(event, (trigger) =>
                onArtist(album.artist, album.id, undefined, trigger),
              )
            }
            params={{ artistKey: albumArtistKey }}
            search={(previous) => libraryArtistRouteSearch(previous)}
            to="/collection/artists/$artistKey"
            title={album.artist}
          >
            <ArtistTransitionName artistKey={albumArtistKey}>
              {album.artist}
            </ArtistTransitionName>
          </Link>
          <span className="text-xs text-[#7f837e]">
            {formatAlbumReleaseDate(album) ?? "Release date unknown"} ·{" "}
            {countLabel(album.songCount, "track")} ·{" "}
            {formatTime(album.duration)}
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
              <PlaybackIcon
                className="size-4"
                playing={activeAlbum && playing}
              />
              {activeAlbum
                ? playing
                  ? "Pause"
                  : "Resume"
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
              className={favoriteAlbum ? "text-coda-favorite" : ""}
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
            <span className="mb-2.5 text-xs font-bold tracking-widest text-coda-subtle-foreground uppercase">
              Track list
            </span>
            <h3 className="mt-1 mb-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base leading-none font-semibold text-[#d7d6d0]">
              {countLabel(album.songCount, "song")}
            </h3>
          </div>
          <span className="text-xs text-[#747873]">
            {formatTime(album.duration)}
          </span>
        </div>
        <div className="px-4 pt-2.5 pb-4">
          <div className="grid h-9 grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_7rem] items-center border-b border-border text-xs text-[#6f736e] uppercase">
            <span className="grid place-items-center justify-self-stretch text-center">
              #
            </span>
            <span>Title</span>
            <span
              className="grid place-items-center justify-self-stretch text-center leading-none"
              title="Duration"
            >
              <Clock3 size={14} aria-hidden="true" />
              <span className="sr-only">Duration</span>
            </span>
            <span className="text-center">Actions</span>
          </div>
          <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
            <AnimatePresence initial={false}>
              <AlbumTracklistPresence key={tracklistState}>
                {loading ? (
                  <div className="flex min-h-44 items-center justify-center gap-2.5 text-xs text-[#898c87]">
                    <Spinner
                      className="size-5"
                      aria-label="Loading album tracks"
                    />{" "}
                    Loading tracks…
                  </div>
                ) : !album.tracks?.length ? (
                  <div className="flex min-h-44 flex-col items-center justify-center gap-1.5 p-6 text-center text-xs text-[#898c87]">
                    <Music2 size={22} />
                    <strong className="mt-1 text-xs text-[#c7c8c2]">
                      No playable tracks returned
                    </strong>
                    <span className="max-w-80 text-xs/normal text-coda-subtle-foreground">
                      This release may not be streamable through Bandcamp’s
                      Subsonic beta yet.
                    </span>
                  </div>
                ) : (
                  <VirtualizedSavedTrackList
                    aria-label="Album tracks"
                    getItemKey={albumTrackKey}
                    items={album.tracks}
                    renderItem={(track, _context, rowProps) => {
                      const activeTrack = currentTrackId === track.id;
                      const favoriteTrack = favoriteTrackIds.has(track.id);
                      return (
                        <div
                          {...rowProps}
                          className={cn(
                            "group/row grid h-14 grid-cols-[2.5rem_minmax(0,1fr)_3.5rem_7rem] items-center rounded-sm border-b border-white/4.5 transition-colors hover:bg-white/[0.035] focus-within:bg-white/[0.035] motion-reduce:transition-none",
                            favoriteTrack && !activeTrack && "bg-primary/[0.025]",
                            activeTrack && "bg-primary/[0.075]",
                          )}
                        >
                          <RowPlaybackAction
                            active={activeTrack}
                            ariaLabel={
                              activeTrack
                                ? `${playing ? "Pause" : "Resume"} ${track.title}`
                                : `Play ${track.title}`
                            }
                            className="h-full"
                            onClick={
                              activeTrack
                                ? onTogglePlayback
                                : () => onPlayTrack(track)
                            }
                            playing={playing}
                            position={track.track}
                          />
                          <div className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                            <Button
                              className="h-auto w-fit max-w-full min-w-0 justify-start overflow-hidden p-0 text-left focus-visible:-outline-offset-2 focus-visible:outline-primary"
                              onClick={
                                activeTrack
                                  ? onTogglePlayback
                                  : () => onPlayTrack(track)
                              }
                              size="compact"
                              variant="text"
                            >
                              <OverflowMarquee
                                className={`max-w-full text-xs ${activeTrack ? "text-[#f0d7cf]" : "text-[#d9d8d2]"}`}
                                text={track.title}
                              />
                            </Button>
                            <Link
                              className="w-fit max-w-full truncate text-xs text-coda-subtle-foreground outline-none hover:text-coda-link-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                              data-artist-open={parseArtistKeyParam(
                                artistKey(track.artist),
                              )}
                              data-coda-artist-name-target={parseArtistKeyParam(
                                artistKey(track.artist),
                              )}
                              data-navigation-slot={`album-track-artist:${track.id}`}
                              onClick={(event) =>
                                handleCodaLinkActivation(event, (trigger) =>
                                  onArtist(
                                    track.artist,
                                    track.albumId,
                                    track,
                                    trigger,
                                  ),
                                )
                              }
                              params={{
                                artistKey: parseArtistKeyParam(
                                  artistKey(track.artist),
                                ),
                              }}
                              search={(previous) =>
                                libraryArtistRouteSearch(
                                  previous,
                                  artistKey(track.artist) === albumArtistKey
                                    ? undefined
                                    : track.albumId,
                                )
                              }
                              to="/collection/artists/$artistKey"
                            >
                              <ArtistTransitionName
                                artistKey={parseArtistKeyParam(
                                  artistKey(track.artist),
                                )}
                              >
                                {track.artist}
                              </ArtistTransitionName>
                            </Link>
                          </div>
                          <span className="grid place-items-center justify-self-stretch text-center text-xs text-coda-subtle-foreground tabular-nums">
                            {formatTime(track.duration)}
                          </span>
                          <RowActionGroup className="grid-cols-[repeat(3,2rem)]">
                            <Button
                              onClick={() => onQueueTrack(track)}
                              size="icon"
                              variant="ghost"
                              title="Add to queue"
                              aria-label={`Add ${track.title} to queue`}
                            >
                              <Plus size={16} />
                            </Button>
                            <Button
                              onClick={() => onAddToPlaylist([track])}
                              size="icon"
                              variant="ghost"
                              title="Add to playlist"
                              aria-label={`Add ${track.title} to playlist`}
                            >
                              <ListPlus size={16} />
                            </Button>
                            <Button
                              className={cn(
                                favoriteTrack &&
                                  "rounded-full bg-primary/10 text-coda-favorite ring-1 ring-primary/20 ring-inset hover:bg-primary/[0.18] hover:text-coda-favorite",
                              )}
                              onClick={() => onToggleFavoriteTrack(track)}
                              size="icon"
                              title={
                                favoriteTrack
                                  ? "Remove from favorites"
                                  : "Add to favorites"
                              }
                              aria-label={
                                favoriteTrack
                                  ? `Remove ${track.title} from favorites`
                                  : `Add ${track.title} to favorites`
                              }
                              aria-pressed={favoriteTrack}
                              variant="ghost"
                            >
                              <Heart
                                size={16}
                                fill={favoriteTrack ? "currentColor" : "none"}
                              />
                            </Button>
                          </RowActionGroup>
                        </div>
                      );
                    }}
                  />
                )}
              </AlbumTracklistPresence>
            </AnimatePresence>
          </div>
        </div>
      </section>
    </article>
  );
}

export type AlbumTracklistPresenceProps = {
  children: ReactNode;
  className?: string;
};

export function AlbumTracklistPresence({
  children,
  className,
}: AlbumTracklistPresenceProps) {
  const codaMotion = useCodaMotion();
  const [isPresent, safeToRemove] = usePresence();
  const completeExit = useMotionExitWatchdog({
    open: isPresent,
    onExitComplete: () => safeToRemove?.(),
  });

  return (
    <m.div
      className={className}
      aria-hidden={!isPresent || undefined}
      inert={!isPresent || undefined}
      initial={{
        opacity: codaMotion.profile.component.opacityFrom,
        transform: `translateY(${codaMotion.profile.component.translationPx}px) scale(${codaMotion.profile.component.scaleFrom})`,
      }}
      animate={{
        opacity: 1,
        transform: "translateY(0px) scale(1)",
        transition: codaMotion.componentEnter,
      }}
      exit={{
        opacity: codaMotion.profile.component.opacityFrom,
        transform: `translateY(${-codaMotion.profile.component.translationPx * 0.6}px) scale(${codaMotion.profile.component.scaleFrom})`,
        transition: codaMotion.componentExit,
      }}
      onAnimationComplete={completeExit}
      style={{ pointerEvents: isPresent ? "auto" : "none" }}
    >
      {children}
    </m.div>
  );
}
