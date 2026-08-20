import { Disc3, Heart } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { memo } from "react";
import {
  RadioChapterCopy,
  type RadioChapterLocalLinks,
} from "@/RadioChapterMetadata";
import { Button } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { Spinner } from "@/components/ui/spinner";
import type { ArtistNavigationHandler } from "@/features/library/types";
import { cn } from "@/lib/utils";
import type { PlaybackClock } from "@/playbackClock";
import { normalizedReleaseTitle } from "@/playerState";
import type { RadioChapter, Track } from "@/types";
import { CoverArt } from "@/features/artwork/CoverArt";
import {
  coverArtAlbumFromTrack,
  coverArtFallbackFromTrack,
} from "@/features/artwork/coverArtAlbum";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import { useCurrentRadioChapter } from "./playbackClockHooks";
import { TrackAlbumLink, TrackArtistLink } from "./TrackRouteLinks";

export type PlayerTrackProps = {
  track?: Track;
  radioTimeline: readonly RadioChapter[];
  playbackClock: PlaybackClock;
  favorite: boolean;
  onToggleFavorite?: () => void;
  onArtist: ArtistNavigationHandler;
  onAlbum: (track: Track, trigger?: HTMLElement) => void;
  albumLoading: boolean;
  onNowPlaying: () => void;
  onOpenRadioItem: (url: string) => void;
  getRadioChapterLocalLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
  className?: string;
};

export const PlayerTrack = memo(function PlayerTrack({
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
  className,
}: PlayerTrackProps) {
  const radioAiring = useCurrentRadioChapter(playbackClock, radioTimeline);
  const activeChapter = radioAiring.current;
  const releaseTitle = track ? normalizedReleaseTitle(track.album) : "";
  const favoriteControl =
    track && onToggleFavorite ? (
      <Button
        className={cn(
          "size-7 shrink-0",
          favorite &&
            "rounded-full bg-primary/10 text-coda-favorite ring-1 ring-primary/20 ring-inset hover:bg-primary/[0.18] hover:text-coda-favorite",
        )}
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
    <div
      className={cn(
        "flex w-full min-w-0 items-center justify-self-start gap-3",
        className,
      )}
    >
      {track ? (
        <>
          <Link
            className="player__art-link h-auto shrink-0 overflow-hidden rounded-sm p-0 hover:bg-transparent focus-visible:outline-primary"
            data-coda-track-id={track.id}
            onClick={(event) => handleCodaLinkActivation(event, onNowPlaying)}
            aria-label="Open Now Playing"
            title={`Open Now Playing for ${track.title}`}
            to="/now-playing"
          >
            <CoverArt
              size="small"
              album={coverArtAlbumFromTrack(track, activeChapter)}
              fallbackArtworkUrl={coverArtFallbackFromTrack(
                track,
                activeChapter,
              )}
              animateChanges={Boolean(track.radioChapters?.length)}
            />
          </Link>
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
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 max-w-full flex-[0_1_auto] overflow-hidden">
                  <OverflowMarquee
                    className="max-w-full text-xs font-bold text-[#e6e4de]"
                    staticTextProps={{
                      "data-coda-now-playing-title-compact": track.id,
                    }}
                    text={track.title}
                  />
                </span>
                {favoriteControl}
              </div>
              <span className="flex h-4 min-w-0 items-center gap-1 text-xs leading-4 text-[#7f827e]">
                <TrackArtistLink
                  className="inline-flex h-4 min-w-0 max-w-[46%] items-center overflow-hidden p-0 text-xs leading-4 text-coda-metadata-link hover:bg-transparent hover:text-coda-link-hover"
                  onNavigate={onArtist}
                  track={track}
                >
                  <OverflowMarquee text={track.artist} />
                </TrackArtistLink>
                {releaseTitle ? (
                  <>
                    <span aria-hidden="true" className="shrink-0">
                      ·
                    </span>
                    <TrackAlbumLink
                      className="inline-flex h-4 min-w-0 max-w-[46%] items-center overflow-hidden p-0 text-xs leading-4 text-coda-metadata-link hover:bg-transparent hover:text-coda-link-hover"
                      onNavigate={onAlbum}
                      busy={albumLoading}
                      ariaLabel={
                        albumLoading
                          ? `Loading album ${releaseTitle}`
                          : undefined
                      }
                      dataPlayerAlbumLink
                      disabled={albumLoading}
                      track={track}
                    >
                      {albumLoading ? (
                        <Spinner
                          aria-label={`Loading album ${releaseTitle}`}
                          className="size-3.5"
                        />
                      ) : null}
                      <OverflowMarquee className="flex-1" text={releaseTitle} />
                    </TrackAlbumLink>
                  </>
                ) : null}
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
