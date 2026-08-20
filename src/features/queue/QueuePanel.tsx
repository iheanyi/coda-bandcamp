import {
  Dices,
  GripVertical,
  ListPlus,
  Music2,
  Play,
  Shuffle,
  X,
} from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Link } from "@tanstack/react-router";
import { lazy, memo, Suspense, useMemo, type RefObject } from "react";
import {
  RadioChapterCopy,
  type RadioChapterLocalLinks,
} from "@/RadioChapterMetadata";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { countLabel } from "@/countLabel";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import { useCodaMotion } from "@/motion";
import type { PlaybackClock } from "@/playbackClock";
import type { QueueRecommendation } from "@/queueRecommendation";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import type { Album, RadioChapter, Track } from "@/types";
import { CoverArt } from "@/features/artwork/CoverArt";
import { coverArtAlbumFromTrack } from "@/features/artwork/coverArtAlbum";
import type { ArtistNavigationHandler } from "@/features/library/types";
import { useCurrentRadioChapter } from "@/features/player/playbackClockHooks";
import {
  LibraryAlbumLink,
  LibraryArtistLink,
  TrackAlbumLink,
  TrackArtistLink,
} from "@/features/player/TrackRouteLinks";
import { QueueCurrentPresence } from "./QueueCurrentPresence";
import { QueueRadioChapters } from "./QueueRadioChapters";

const TrackQueueList = lazy(() => import("@/TrackQueueList"));
const queueTrackKey = (track: Track, absoluteIndex: number) =>
  `${track.id}-${absoluteIndex}`;
const queueTrackLabel = (track: Track) => track.title;
const QUEUE_LIST_REGION_CLASS_NAME =
  "min-h-0 flex-1 [touch-action:pan-y] [scrollbar-color:#343738_transparent] scrollbar-thin overflow-x-hidden overflow-y-auto overscroll-y-contain bg-coda-queue px-2 pt-0.5 pb-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary/60";

export type QueuePanelProps = {
  open: boolean;
  panelRef: RefObject<HTMLDivElement | null>;
  finalFocus: RefObject<HTMLButtonElement | null>;
  queue: Track[];
  currentIndex: number;
  currentTrack?: Track;
  hasDeferredTracks: boolean;
  radioTimeline: readonly RadioChapter[];
  playbackClock: PlaybackClock;
  playing: boolean;
  onPlay: (index: number) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
  onShuffle: () => void;
  onMove: (from: number, to: number) => void;
  onArtist: ArtistNavigationHandler;
  onAlbum: (track: Track, trigger?: HTMLElement) => void;
  onNowPlaying: () => void;
  onRadioSeries?: (seriesId?: number, trigger?: HTMLAnchorElement) => void;
  onOpenRadioItem: (url: string) => void;
  getRadioChapterLocalLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
  onSeek: (position: number) => void;
  recommendation?: QueueRecommendation;
  recommendationLoading: boolean;
  recommendationQueueLoading: boolean;
  onQueueRecommendation: () => void;
  onPlayRecommendation: () => void;
  onAnotherRecommendation: () => void;
  onRecommendationAlbum?: (album: Album, trigger: HTMLAnchorElement) => void;
  loadingAlbumId?: string;
  playerVisible: boolean;
  className?: string;
};

export const QueuePanel = memo(function QueuePanel({
  open,
  panelRef,
  finalFocus,
  queue,
  currentIndex,
  currentTrack,
  hasDeferredTracks,
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
  onRadioSeries,
  onOpenRadioItem,
  getRadioChapterLocalLinks,
  onSeek,
  recommendation,
  recommendationLoading,
  recommendationQueueLoading,
  onQueueRecommendation,
  onPlayRecommendation,
  onAnotherRecommendation,
  onRecommendationAlbum,
  loadingAlbumId,
  playerVisible,
  className,
}: QueuePanelProps) {
  const codaMotion = useCodaMotion();
  const upcoming = useMemo(
    () => (open ? queue.slice(currentIndex + 1) : []),
    [currentIndex, open, queue],
  );
  const remaining = useMemo(
    () => upcoming.reduce((total, item) => total + item.duration, 0),
    [upcoming],
  );
  const {
    current: currentRadioChapter,
    next: nextRadioChapter,
    currentIndex: currentChapterIndex,
    nextIndex: nextChapterIndex,
  } = useCurrentRadioChapter(playbackClock, radioTimeline);
  const recommendationCard =
    recommendation && !hasDeferredTracks ? (
      <div className="grid w-full min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-2.5 overflow-hidden rounded-lg border border-white/9 bg-[radial-gradient(circle_at_0_0,rgba(221,101,73,0.09),transparent_58%),#1a1d1f] p-3 text-left shadow-[inset_0_1px_rgba(255,255,255,0.025)] *:data-[slot=cover]:self-center">
        <LibraryAlbumLink
          album={recommendation.album}
          ariaLabel={`Open ${recommendation.album.title}`}
          className="overflow-hidden rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onNavigate={onRecommendationAlbum}
        >
          <CoverArt size="small" album={recommendation.album} />
        </LibraryAlbumLink>
        <div className="flex min-w-0 flex-col justify-center">
          <span className="text-coda-micro font-bold tracking-widest text-[#d07c67] uppercase">
            Try this next
          </span>
          <LibraryAlbumLink
            album={recommendation.album}
            className="mt-1 truncate text-coda-compact font-bold text-[#deddd7] hover:text-primary"
            onNavigate={onRecommendationAlbum}
          >
            {recommendation.album.title}
          </LibraryAlbumLink>
          <small className="mt-1 truncate text-coda-micro font-normal text-[#797d78]">
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
        <div className="col-span-full flex gap-1.5">
          <Button
            type="button"
            className="min-h-8 flex-1 gap-1.5 border-0 bg-[#34211e] px-2.5 text-(length:--text-coda-meta) font-bold text-[#e9947e] hover:bg-primary/20 hover:text-[#ffc0b0]"
            onClick={onQueueRecommendation}
            disabled={recommendationLoading || recommendationQueueLoading}
            aria-label={`Add ${recommendation.album.title} to queue`}
            size="compact"
          >
            {recommendationQueueLoading ? (
              <Spinner aria-hidden="true" className="size-3.5" />
            ) : (
              <ListPlus size={14} />
            )}
            {recommendationQueueLoading ? "Adding…" : "Add to queue"}
          </Button>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  onClick={onPlayRecommendation}
                  disabled={recommendationLoading || recommendationQueueLoading}
                  aria-label={`Play something from ${recommendation.album.title}`}
                  size="icon-compact"
                  variant="ghost"
                />
              }
            >
              {recommendationLoading ? (
                <Spinner aria-hidden="true" className="size-3.5" />
              ) : (
                <Play size={14} fill="currentColor" />
              )}
            </TooltipTrigger>
            <TooltipContent>Play something</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  onClick={onAnotherRecommendation}
                  disabled={recommendationLoading || recommendationQueueLoading}
                  aria-label="Suggest another album"
                  size="icon-compact"
                  variant="ghost"
                />
              }
            >
              <Dices size={15} />
            </TooltipTrigger>
            <TooltipContent>Suggest another</TooltipContent>
          </Tooltip>
        </div>
      </div>
    ) : null;
  const emptyQueue = (
    <div
      className="flex min-h-full flex-col items-center justify-start gap-5 px-1 pt-8 pb-7 text-center text-[#666a66]"
      data-empty-queue=""
    >
      <div className="flex flex-col items-center gap-3">
        <Music2
          className="box-content shrink-0 rounded-full border border-white/[0.07] bg-coda-radio p-2 text-coda-subtle-foreground"
          size={25}
        />
        <div className="flex max-w-64 flex-col items-center gap-1 text-balance">
          <p className="text-coda-compact font-semibold text-[#b9bbb5]">
            {currentTrack
              ? hasDeferredTracks
                ? "Loading more tracks…"
                : "End of the queue"
              : "Your queue is empty"}
          </p>
          <p className="text-coda-meta text-coda-subtle-foreground">
            {currentTrack && hasDeferredTracks
              ? "Coda is filling the next part of this shuffle."
              : recommendation
                ? "Not sure what comes next? Let Coda pick from your collection."
                : currentTrack
                  ? "Add another album or track to keep listening."
                  : "Use the + button on any release to line up music."}
          </p>
        </div>
      </div>
      {recommendationCard}
    </div>
  );

  return (
    <DrawerContent
      id="queue-drawer"
      ref={panelRef}
      finalFocus={finalFocus}
      className={cn(
        "top-3! right-3! isolate max-h-none min-h-0 w-88 min-w-0 overflow-hidden rounded-lg border border-white/12 bg-coda-queue shadow-coda-queue contain-[paint] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary/70 data-[swipe-direction=right]:rounded-lg max-lg:top-2! max-lg:right-2!",
        playerVisible
          ? "bottom-26! max-lg:bottom-25!"
          : "bottom-3! max-lg:bottom-2!",
        className,
      )}
      aria-hidden={!open}
      tabIndex={-1}
    >
      <DrawerHeader className="flex-row items-center justify-between gap-4 bg-coda-queue px-3 pt-6 pb-4 text-left">
        <div>
          <span className="mb-2 text-coda-meta font-bold tracking-widest text-coda-subtle-foreground uppercase">
            Playing next
          </span>
          <DrawerTitle className="m-0 font-display text-xl leading-none font-semibold">
            Queue
          </DrawerTitle>
          <DrawerDescription className="sr-only">
            Review and manage the tracks playing next.
          </DrawerDescription>
        </div>
        <div className="flex items-center">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  className="transition-[color,background-color,transform] duration-(--duration-coda-fast) hover:scale-105 hover:rotate-12"
                  onClick={onShuffle}
                  disabled={queue.length < 2}
                  aria-label="Shuffle queue"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <Shuffle size={17} />
            </TooltipTrigger>
            <TooltipContent>Shuffle queue</TooltipContent>
          </Tooltip>
          <Button
            className="h-8 px-2 text-(length:--text-coda-meta) font-semibold text-[#858984] hover:bg-transparent hover:text-[#e1dfd9]"
            onClick={onClear}
            disabled={!hasDeferredTracks && queue.length <= currentIndex + 1}
            title="Clear upcoming tracks"
            size="compact"
            variant="text"
          >
            Clear next
          </Button>
        </div>
      </DrawerHeader>

      <AnimatePresence initial={false}>
        {currentTrack ? (
          <QueueCurrentPresence key={currentTrack.id}>
            <Badge
              className="mb-2 h-auto gap-1.5 bg-transparent p-0 text-(length:--text-coda-micro) tracking-widest text-[#d07b65] uppercase"
              size="compact"
            >
              <span className="size-1.5 rounded-full bg-primary" />
              Now playing
            </Badge>
            <div className="flex w-full min-w-0 items-center gap-2.5 text-left">
              <Link
                className="h-auto shrink-0 overflow-hidden p-0 text-left hover:bg-transparent"
                onClick={(event) =>
                  handleCodaLinkActivation(event, onNowPlaying)
                }
                aria-label={`Open Now Playing for ${currentRadioChapter?.title ?? currentTrack.title}`}
                title="Open Now Playing"
                to="/now-playing"
              >
                <CoverArt
                  size="small"
                  album={coverArtAlbumFromTrack(currentTrack)}
                />
              </Link>
              <div className="flex min-w-0 shrink grow basis-0 flex-col gap-1 overflow-hidden">
                {currentRadioChapter ? (
                  <>
                    <RadioChapterCopy
                      chapter={currentRadioChapter}
                      className="flex min-w-0 flex-col gap-1"
                      onOpen={onOpenRadioItem}
                      localLinks={getRadioChapterLocalLinks(
                        currentRadioChapter,
                      )}
                    />
                    {nextRadioChapter ? (
                      <span className="mt-0.5 truncate text-coda-micro text-[#6f746f]">
                        Next: {nextRadioChapter.title}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Link
                      className="h-auto w-full justify-start overflow-hidden p-0 text-left text-(length:--text-coda-compact) font-semibold text-[#d9d8d2] hover:bg-transparent hover:text-[#d9d8d2]"
                      onClick={(event) =>
                        handleCodaLinkActivation(event, onNowPlaying)
                      }
                      to="/now-playing"
                    >
                      <OverflowMarquee
                        className="w-full"
                        text={currentTrack.title}
                      />
                    </Link>
                    <TrackArtistLink
                      className="h-auto justify-start truncate p-0 text-(length:--text-coda-meta) font-normal text-coda-metadata-link hover:bg-transparent hover:text-coda-link-hover"
                      onNavigate={onArtist}
                      onRadioSeries={onRadioSeries}
                      track={currentTrack}
                    >
                      {currentTrack.artist}
                    </TrackArtistLink>
                  </>
                )}
              </div>
              <span
                className={`ml-auto flex h-3.5 shrink-0 items-end gap-0.5 text-primary [&>i]:h-3 [&>i]:origin-bottom [&>i]:motion-reduce:animate-none ${playing ? "" : "[&>i]:[animation-play-state:paused]"}`}
              >
                <i className="w-0.5 bg-current [transform:scaleY(0.666667)] animate-[bar_750ms_ease-in-out_infinite_alternate]" />
                <i className="w-0.5 bg-current animate-[bar_750ms_ease-in-out_-320ms_infinite_alternate]" />
                <i className="w-0.5 bg-current [transform:scaleY(0.5)] animate-[bar_750ms_ease-in-out_-520ms_infinite_alternate]" />
              </span>
            </div>
            <QueueRadioChapters
              chapters={radioTimeline}
              currentChapterIndex={currentChapterIndex}
              nextChapterIndex={nextChapterIndex}
              open={open}
              onSeek={onSeek}
            />
          </QueueCurrentPresence>
        ) : null}
      </AnimatePresence>

      <Suspense
        fallback={
          <div
            aria-label="Upcoming tracks"
            className={QUEUE_LIST_REGION_CLASS_NAME}
            role="region"
            tabIndex={0}
          >
            {!upcoming.length ? emptyQueue : null}
          </div>
        }
      >
        <TrackQueueList
          aria-label="Upcoming tracks"
          className={QUEUE_LIST_REGION_CLASS_NAME}
          empty={emptyQueue}
          getItemKey={queueTrackKey}
          getItemLabel={queueTrackLabel}
          items={upcoming}
          onMove={onMove}
          renderItem={(track, { absoluteIndex, index: upcomingIndex }) => (
            <m.div
              className="group grid min-h-15 grid-cols-[1rem_minmax(0,1fr)_auto_1.5rem] items-center gap-1 rounded-md p-1.5 transition-[background-color,translate] duration-(--duration-coda-standard) hover:translate-x-0.5 hover:bg-white/[0.035] max-lg:grid-cols-[0.75rem_minmax(0,1fr)_auto_1.5rem]"
              initial={
                upcomingIndex < 12
                  ? { opacity: 0, transform: "translateX(8px)" }
                  : false
              }
              animate={{
                opacity: 1,
                transform: "translateX(0px)",
                transition: {
                  ...codaMotion.componentEnter,
                  delay: upcomingIndex < 12 ? upcomingIndex * 0.018 : 0,
                },
              }}
            >
              <GripVertical
                className="cursor-grab text-[#4e5250] opacity-0 transition-[color,opacity,transform] duration-(--duration-coda-standard) group-hover:translate-x-px group-hover:opacity-100"
                size={15}
              />
              <div className="flex min-w-0 items-center gap-2 text-left">
                <TrackAlbumLink
                  className="relative h-auto shrink-0 overflow-hidden p-0 text-left hover:bg-transparent"
                  onNavigate={onAlbum}
                  ariaLabel={`Open ${track.album}`}
                  busy={loadingAlbumId === track.albumId}
                  disabled={loadingAlbumId === track.albumId}
                  track={track}
                  title={`Open ${track.album}`}
                >
                  <CoverArt
                    size="small"
                    album={coverArtAlbumFromTrack(track)}
                  />
                  {loadingAlbumId === track.albumId ? (
                    <span className="pointer-events-none absolute inset-0 grid place-items-center bg-black/40">
                      <Spinner
                        aria-label={`Loading ${track.album}`}
                        className="size-5 text-white"
                      />
                    </span>
                  ) : null}
                </TrackAlbumLink>
                <span className="flex min-w-0 flex-col gap-1">
                  <Button
                    className="h-auto min-w-0 justify-start overflow-hidden p-0 text-left text-(length:--text-coda-compact) font-semibold text-[#d9d8d2] hover:bg-transparent hover:text-[#d9d8d2]"
                    onClick={() => onPlay(absoluteIndex)}
                    size="compact"
                    variant="text"
                  >
                    <OverflowMarquee className="w-full" text={track.title} />
                  </Button>
                  <TrackArtistLink
                    className="h-auto justify-start truncate p-0 text-(length:--text-coda-meta) font-normal text-coda-metadata-link hover:bg-transparent hover:text-coda-link-hover"
                    onNavigate={onArtist}
                    onRadioSeries={onRadioSeries}
                    track={track}
                  >
                    {track.artist}
                  </TrackArtistLink>
                </span>
              </div>
              <span className="text-coda-micro text-[#666a66] tabular-nums">
                {formatTime(track.duration)}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      className="size-6 scale-100 opacity-60 transition-[color,opacity,transform] duration-(--duration-coda-standard) group-hover:opacity-100 group-focus-within:scale-100 group-focus-within:opacity-100 focus-visible:scale-100 focus-visible:opacity-100"
                      onClick={() => onRemove(absoluteIndex)}
                      aria-label={`Remove ${track.title}`}
                      size="icon-compact"
                      variant="ghost"
                    />
                  }
                >
                  <X size={14} />
                </TooltipTrigger>
                <TooltipContent>Remove</TooltipContent>
              </Tooltip>
            </m.div>
          )}
          startIndex={currentIndex + 1}
          tabIndex={0}
        />
      </Suspense>

      {upcoming.length && recommendationCard ? (
        <div className="shrink-0 bg-coda-queue px-2 pb-2">
          {recommendationCard}
        </div>
      ) : null}

      <DrawerFooter className="mt-0 flex-row justify-between gap-0 border-t border-border bg-coda-queue p-3 text-(length:--text-coda-micro) text-[#696d68] tabular-nums">
        <m.span
          key={upcoming.length}
          initial={{ opacity: 0, transform: "translateY(4px)" }}
          animate={{
            opacity: 1,
            transform: "translateY(0px)",
            transition: codaMotion.componentEnter,
          }}
        >
          {hasDeferredTracks && !upcoming.length
            ? "More tracks pending"
            : `${countLabel(upcoming.length, "track")} next`}
        </m.span>
        <span>
          {hasDeferredTracks
            ? "Loading remaining tracks…"
            : upcoming.length
              ? `${formatTime(remaining)} remaining`
              : "Queue ready"}
        </span>
      </DrawerFooter>
    </DrawerContent>
  );
});
