import { Dices, ListPlus, Play } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { memo, type ReactNode } from "react";

import { MotionExitPresence } from "@/components/ui/MotionExitPresence";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  LibraryAlbumLink,
  LibraryArtistLink,
  TrackAlbumLink,
  TrackArtistLink,
} from "@/features/player/TrackRouteLinks";
import { formatTime } from "@/lib";
import { useCodaMotion } from "@/motion";
import type { QueueRecommendation } from "@/queueRecommendation";
import type { Album, Track } from "@/types";

const UPCOMING_PREVIEW_LIMIT = 4;

function PresencePanel({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  const codaMotion = useCodaMotion();
  return (
    <MotionExitPresence
      className={className}
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
        transform: `translateY(${codaMotion.profile.component.translationPx * 0.6}px) scale(${codaMotion.profile.component.scaleFrom})`,
        transition: codaMotion.componentExit,
      }}
    >
      {children}
    </MotionExitPresence>
  );
}

export const NowPlayingUpNext = memo(function NowPlayingUpNext({
  queue,
  currentIndex,
  hasDeferredTracks,
  recommendation,
  recommendationArtwork,
  recommendationLoading,
  recommendationQueueLoading,
  onQueueRecommendation,
  onPlayRecommendation,
  onAnotherRecommendation,
  onRecommendationAlbum,
  onPlayQueueIndex,
  onArtist,
  onAlbum,
  onRadioSeries,
}: {
  queue: readonly Track[];
  currentIndex: number;
  hasDeferredTracks: boolean;
  recommendation?: QueueRecommendation;
  recommendationArtwork?: ReactNode;
  recommendationLoading: boolean;
  recommendationQueueLoading: boolean;
  onQueueRecommendation?: () => void;
  onPlayRecommendation: () => void;
  onAnotherRecommendation: () => void;
  onRecommendationAlbum?: (
    album: Album,
    trigger: HTMLAnchorElement,
  ) => void;
  onPlayQueueIndex: (index: number) => void;
  onArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
    sourceTrigger?: HTMLElement,
  ) => void;
  onAlbum: (track: Track, trigger?: HTMLElement) => void;
  onRadioSeries: (seriesId?: number, trigger?: HTMLAnchorElement) => void;
}) {
  const upcoming = queue.slice(
    currentIndex + 1,
    currentIndex + 1 + UPCOMING_PREVIEW_LIMIT,
  );
  const moreUpcoming = Math.max(
    0,
    queue.length - currentIndex - 1 - upcoming.length,
  );

  return (
    <section
      className="now-playing__up-next relative mx-auto mt-16 w-full max-w-5xl border-t border-white/8 pt-5 max-xl:max-w-xl max-lg:mt-8"
      aria-labelledby="up-next-heading"
    >
      <div className="mb-3 flex items-end justify-between gap-5 max-lg:flex-col max-lg:items-start max-lg:gap-2">
        <div>
          <Badge
            variant="artwork"
            className="mb-1 h-auto border-0 bg-transparent p-0 text-xs tracking-widest uppercase"
          >
            {upcoming.length
              ? "In this session"
              : hasDeferredTracks
                ? "Shuffle loading"
                : "Queue complete"}
          </Badge>
          <h2
            id="up-next-heading"
            className="m-0 text-base/tight font-semibold tracking-tight text-[#dfddd7]"
          >
            {upcoming.length
              ? "Up next"
              : hasDeferredTracks
                ? "Filling your queue"
                : "Keep listening"}
          </h2>
        </div>
      </div>
      <div className="grid [&>*]:col-start-1 [&>*]:row-start-1">
        <AnimatePresence initial={false}>
          {upcoming.length ? (
            <PresencePanel
              key="upcoming"
              className="grid grid-cols-2 gap-x-3 gap-y-0.5 max-xl:grid-cols-1"
            >
              {upcoming.map((item, index) => {
                const queueIndex = currentIndex + index + 1;
                return (
                  <div
                    className="grid h-auto min-w-0 grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-white/4"
                    key={`${item.id}-${queueIndex}`}
                  >
                    <span className="text-xs font-normal text-[#686c67] tabular-nums">
                      {String(queueIndex + 1).padStart(2, "0")}
                    </span>
                    <span className="flex min-w-0 flex-col gap-0.5 overflow-hidden">
                      <Button
                        aria-label={`Play ${item.title}`}
                        className="h-auto min-w-0 justify-start overflow-hidden p-0 text-left hover:bg-transparent"
                        onClick={() => onPlayQueueIndex(queueIndex)}
                        size="compact"
                        variant="text"
                      >
                        <OverflowMarquee
                          className="text-xs/snug text-[#d4d3cd]"
                          text={item.title}
                        />
                      </Button>
                      <small className="flex min-w-0 items-center gap-1 truncate text-xs font-normal text-[#737772]">
                        <TrackArtistLink
                          className="min-w-0 truncate hover:text-primary"
                          onNavigate={onArtist}
                          onRadioSeries={onRadioSeries}
                          track={item}
                        >
                          {item.artist}
                        </TrackArtistLink>
                        <span aria-hidden="true">·</span>
                        <TrackAlbumLink
                          className="min-w-0 truncate hover:text-primary"
                          onNavigate={onAlbum}
                          track={item}
                        >
                          {item.album}
                        </TrackAlbumLink>
                      </small>
                    </span>
                    <span className="text-xs font-normal text-[#686c67] tabular-nums">
                      {formatTime(item.duration)}
                    </span>
                  </div>
                );
              })}
            </PresencePanel>
          ) : hasDeferredTracks ? (
            <PresencePanel
              key="deferred"
              className="flex min-h-20 items-center gap-3 rounded-lg border border-white/7 bg-white/2.5 p-4 text-xs text-[#747873]"
            >
              <Spinner aria-hidden="true" className="size-4" />
              <span>Coda is loading the next part of this shuffle.</span>
            </PresencePanel>
          ) : recommendation ? (
            <PresencePanel
              key={`recommendation:${recommendation.album.id}`}
              className="grid min-h-20 grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3.5 rounded-lg border border-white/7 bg-[radial-gradient(circle_at_0_0,rgba(221,101,73,0.1),transparent_42%),rgba(255,255,255,0.025)] p-3 max-lg:grid-cols-[3rem_minmax(0,1fr)]"
            >
              <LibraryAlbumLink
                album={recommendation.album}
                ariaLabel={`Open ${recommendation.album.title}`}
                className="size-14 overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring **:data-[slot=cover]:size-full max-lg:size-12"
                onNavigate={onRecommendationAlbum}
              >
                {recommendationArtwork}
              </LibraryAlbumLink>
              <div className="flex min-w-0 flex-col overflow-hidden">
                <span className="text-xs font-bold tracking-widest text-[#d37e68] uppercase">
                  Picked from your collection
                </span>
                <LibraryAlbumLink
                  album={recommendation.album}
                  className="mt-1 min-w-0 overflow-hidden text-sm text-[#e2e0da] hover:text-primary"
                  onNavigate={onRecommendationAlbum}
                >
                  <OverflowMarquee text={recommendation.album.title} />
                </LibraryAlbumLink>
                <small className="mt-1 truncate text-xs text-coda-subtle-foreground">
                  <LibraryArtistLink
                    artist={recommendation.album.artist}
                    className="font-semibold hover:text-primary"
                    onNavigate={onArtist}
                  >
                    {recommendation.album.artist}
                  </LibraryArtistLink>
                  {" · "}
                  {recommendation.reason}
                </small>
              </div>
              <div className="flex items-center gap-2 max-lg:col-span-full">
                {onQueueRecommendation ? (
                  <Button
                    variant="primary"
                    size="compact"
                    className="h-8 px-2.5"
                    onClick={onQueueRecommendation}
                    disabled={
                      recommendationLoading || recommendationQueueLoading
                    }
                    aria-label={`Add ${recommendation.album.title} to queue`}
                  >
                    {recommendationQueueLoading ? (
                      <Spinner
                        aria-hidden="true"
                        className="size-4 text-current motion-reduce:animate-none"
                      />
                    ) : (
                      <ListPlus size={15} />
                    )}
                    {recommendationQueueLoading ? "Adding…" : "Add to queue"}
                  </Button>
                ) : null}
                <Button
                  size="compact"
                  className="h-8 px-2.5"
                  onClick={onPlayRecommendation}
                  disabled={
                    recommendationLoading || recommendationQueueLoading
                  }
                  aria-label={`Play something from ${recommendation.album.title}`}
                >
                  {recommendationLoading ? (
                    <Spinner
                      aria-hidden="true"
                      className="size-4 text-current motion-reduce:animate-none"
                    />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                  {recommendationLoading ? "Picking…" : "Play something"}
                </Button>
                <Button
                  size="compact"
                  className="h-8 px-2.5"
                  onClick={onAnotherRecommendation}
                  disabled={
                    recommendationLoading || recommendationQueueLoading
                  }
                >
                  <Dices size={15} />
                  Another pick
                </Button>
              </div>
            </PresencePanel>
          ) : (
            <PresencePanel
              key="empty"
              className="flex flex-col items-start gap-1 rounded-lg bg-white/2.5 p-4 text-xs text-[#747873]"
            >
              <strong className="text-xs text-[#c9c8c2]">
                You reached the end.
              </strong>
              <span className="text-xs text-[#717570]">
                Open the queue or browse your collection to keep listening.
              </span>
            </PresencePanel>
          )}
        </AnimatePresence>
      </div>
      {moreUpcoming ? (
        <span className="mt-2 block text-right text-xs text-[#747873]">
          {moreUpcoming} more in the full queue
        </span>
      ) : null}
    </section>
  );
});
