import {
  ArrowLeft,
  Clock3,
  ExternalLink,
  Heart,
  ListMusic,
  ListPlus,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  memo,
  startTransition,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DrawerTrigger } from "@/components/ui/drawer";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AirPlayButton } from "@/features/player/AirPlayButton";
import { DEFAULT_VOLUME } from "@/features/player/constants";
import { usePlaybackPosition } from "@/features/player/playbackClockHooks";
import {
  TrackAlbumLink,
  TrackArtistLink,
} from "@/features/player/TrackRouteLinks";
import {
  queueOrChapterCanNext,
  queueOrChapterCanPrevious,
} from "@/features/player/transportEnablement";
import { useActivateDetailDestination } from "@/features/navigation/useActivateDetailDestination";
import { useOpenExternalBandcampItem } from "@/features/radio/useOpenExternalBandcampItem";
import { cn } from "@/lib/utils";
import { countLabel } from "@/countLabel";
import { formatTime, openBandcampUrl } from "@/lib";
import { normalizedReleaseTitle } from "@/playerState";
import type { RadioChapterLocalLinks } from "@/RadioChapterMetadata";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import { radioEpisodeUrl, radioSeriesByTitle } from "@/radioSeries";
import type { PlaybackClock } from "@/playbackClock";
import type { QueueRecommendation } from "@/queueRecommendation";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
  stringifyRadioSeriesIdParam,
  stringifyRadioShowIdParam,
} from "@/routing/routeContracts";
import type { Album, RadioChapter, RepeatMode, Track } from "@/types";

import {
  NowPlayingRadioSummary,
  NowPlayingRadioTimeline,
} from "./NowPlayingRadioTimeline";
import { NowPlayingUpNext } from "./NowPlayingUpNext";

export type NowPlayingViewProps = {
  track: Track;
  radioTimeline: readonly RadioChapter[];
  queue: Track[];
  currentIndex: number;
  hasDeferredTracks?: boolean;
  playing: boolean;
  playbackClock: PlaybackClock;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  artwork: ReactNode;
  airPlayAvailable: boolean;
  queueOpen: boolean;
  queueControlRef?: RefObject<HTMLButtonElement | null>;
  onBack: () => void;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onRepeat: () => void;
  onAirPlay: () => void;
  onArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
    sourceTrigger?: HTMLElement,
  ) => void;
  onAlbum: (track: Track, trigger?: HTMLElement) => void;
  albumLoading?: boolean;
  onPlayQueueIndex: (index: number) => void;
  onRadioSeries: (seriesId?: number, trigger?: HTMLAnchorElement) => void;
  recommendation?: QueueRecommendation;
  recommendationArtwork?: ReactNode;
  recommendationLoading: boolean;
  recommendationQueueLoading?: boolean;
  onQueueRecommendation?: () => void;
  onPlayRecommendation: () => void;
  onAnotherRecommendation: () => void;
  onRecommendationAlbum?: (album: Album, trigger: HTMLAnchorElement) => void;
  getRadioChapterLocalLinks?: (chapter: RadioChapter) => RadioChapterLocalLinks;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  onAddToPlaylist?: () => void;
  openExternal?: (url: string) => Promise<void>;
};

type NowPlayingArtworkStyle = CSSProperties & {
  "--now-playing-accent": string;
  "--now-playing-base": string;
};

const NowPlayingPlaybackControls = memo(function NowPlayingPlaybackControls({
  playbackClock,
  timeline,
  duration,
  playing,
  repeat,
  queueOpen,
  queueControlRef,
  canPrevious,
  canNext,
  onSeek,
  onRepeat,
  onPrevious,
  onToggle,
  onNext,
}: {
  playbackClock: PlaybackClock;
  timeline: readonly RadioChapter[];
  duration: number;
  playing: boolean;
  repeat: RepeatMode;
  queueOpen: boolean;
  queueControlRef?: RefObject<HTMLButtonElement | null>;
  canPrevious: boolean;
  canNext: boolean;
  onSeek: (value: number) => void;
  onRepeat: () => void;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
}) {
  const currentTime = usePlaybackPosition(playbackClock);
  const remaining = Math.max(0, duration - currentTime);
  const repeatLabel =
    repeat === "off"
      ? "Repeat off"
      : repeat === "all"
        ? "Repeat queue"
        : "Repeat current track";
  const chapterCanPrevious = queueOrChapterCanPrevious(
    canPrevious,
    currentTime,
    timeline,
  );
  const chapterCanNext = queueOrChapterCanNext(canNext, currentTime, timeline);

  return (
    <>
      <div className="mt-12 max-xl:mt-7">
        <Slider
          className="**:data-[slot=slider-range]:bg-[#ebe8e1] **:data-[slot=slider-thumb]:size-3 **:data-[slot=slider-thumb]:opacity-100 **:data-[slot=slider-track]:h-1 **:data-[slot=slider-track]:bg-white/15"
          aria-label="Now playing position"
          min={0}
          max={duration || 1}
          step={1}
          value={[Math.min(Math.max(0, currentTime), duration || 1)]}
          onValueChange={(values) => onSeek(values[0] ?? 0)}
        />
        <div
          className="mt-2 flex justify-between text-xs text-[#8e918c] tabular-nums"
          aria-hidden="true"
        >
          <span>{formatTime(currentTime)}</span>
          <span>−{formatTime(remaining)}</span>
        </div>
      </div>

      <div
        className="mt-5 grid grid-cols-[2.5rem_3rem_4rem_3rem_2.5rem] items-center justify-center gap-2 max-lg:grid-cols-[2rem_2.5rem_3.5rem_2.5rem_2rem] max-lg:gap-0.5"
        role="group"
        aria-label="Playback controls"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "justify-self-center text-[#7e817d]",
                  repeat !== "off" && "text-primary",
                )}
                onClick={onRepeat}
                aria-label={repeatLabel}
                aria-pressed={repeat !== "off"}
              />
            }
          >
            {repeat === "one" ? (
              <Repeat1 className="size-5" size={20} />
            ) : (
              <Repeat className="size-5" size={20} />
            )}
          </TooltipTrigger>
          <TooltipContent>{repeatLabel}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-11 justify-self-center text-[#dedcd6] max-lg:size-9"
                onClick={onPrevious}
                disabled={!chapterCanPrevious}
                aria-label="Previous"
              />
            }
          >
            <SkipBack className="size-6" size={24} fill="currentColor" />
          </TooltipTrigger>
          <TooltipContent>Previous</TooltipContent>
        </Tooltip>
        <Button
          variant="secondary"
          size="icon"
          className="size-16 justify-self-center rounded-full border-0 bg-[#f1eee7] text-[#141618] shadow-[0_14px_30px_rgba(0,0,0,0.27)] transition-[background-color,transform,box-shadow] duration-(--duration-coda-standard) ease-coda-enter hover:scale-[1.035] hover:bg-white hover:shadow-[0_16px_34px_rgba(0,0,0,0.32)] active:scale-[0.965] motion-reduce:transition-none max-lg:size-14"
          onClick={onToggle}
          aria-label={playing ? "Pause" : "Play"}
        >
          <PlaybackIcon className="size-7" playing={playing} />
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="size-11 justify-self-center text-[#dedcd6] max-lg:size-9"
                onClick={onNext}
                disabled={!chapterCanNext}
                aria-label="Next"
              />
            }
          >
            <SkipForward className="size-6" size={24} fill="currentColor" />
          </TooltipTrigger>
          <TooltipContent>Next</TooltipContent>
        </Tooltip>
        <Tooltip>
          <DrawerTrigger
            render={
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    ref={queueControlRef}
                    className={cn(
                      "justify-self-center text-[#7e817d]",
                      queueOpen && "text-primary",
                    )}
                    aria-label={queueOpen ? "Hide queue" : "Show queue"}
                    aria-pressed={queueOpen}
                  />
                }
              >
                <ListMusic className="size-5" size={20} />
              </TooltipTrigger>
            }
          />
          <TooltipContent>
            {queueOpen ? "Hide queue" : "Show queue"}
          </TooltipContent>
        </Tooltip>
      </div>
    </>
  );
});

function NowPlayingViewComponent({
  track,
  radioTimeline,
  queue,
  currentIndex,
  hasDeferredTracks = false,
  playing,
  playbackClock,
  duration,
  volume,
  repeat,
  artwork,
  airPlayAvailable,
  queueOpen,
  queueControlRef,
  onBack,
  onToggle,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  onSeek,
  onVolume,
  onRepeat,
  onAirPlay,
  onArtist,
  onAlbum,
  albumLoading = false,
  onPlayQueueIndex,
  onRadioSeries,
  recommendation,
  recommendationArtwork,
  recommendationLoading,
  recommendationQueueLoading = false,
  onQueueRecommendation,
  onPlayRecommendation,
  onAnotherRecommendation,
  onRecommendationAlbum,
  getRadioChapterLocalLinks,
  favorite = false,
  onToggleFavorite,
  onAddToPlaylist,
  openExternal = openBandcampUrl,
}: NowPlayingViewProps) {
  const [radioLinkError, setRadioLinkError] = useState("");
  const [supplementalReady, setSupplementalReady] = useState(
    () =>
      !document.documentElement.classList.contains("coda-view-transitioning"),
  );
  const safeDuration = Math.max(0, duration);
  const radioShowId = radioShowIdFromTrackId(track.id);
  const radioShowRouteId =
    radioShowId === undefined ? undefined : parseRadioShowIdParam(radioShowId);
  const radioShowUrl =
    radioShowId === undefined ? undefined : radioEpisodeUrl(radioShowId);
  const radioSeries = radioShowUrl
    ? radioSeriesByTitle(track.album)
    : undefined;
  const radioSeriesRouteId = radioSeries
    ? parseRadioSeriesIdParam(radioSeries.id)
    : undefined;
  const releaseTitle = normalizedReleaseTitle(track.album);

  const openRadioChapter = useOpenExternalBandcampItem(
    openExternal,
    setRadioLinkError,
  );
  useActivateDetailDestination("now-playing", "now-playing");
  useEffect(() => {
    if (supplementalReady) return;
    let frame = 0;
    const reveal = () => {
      if (
        document.documentElement.classList.contains("coda-view-transitioning")
      ) {
        return;
      }
      observer.disconnect();
      frame = requestAnimationFrame(() => {
        startTransition(() => setSupplementalReady(true));
      });
    };
    const observer = new MutationObserver(reveal);
    observer.observe(document.documentElement, {
      attributeFilter: ["class"],
      attributes: true,
    });
    reveal();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [supplementalReady]);

  const artworkStyle: NowPlayingArtworkStyle = {
    "--now-playing-accent": track.palette[0],
    "--now-playing-base": track.palette[1],
  };

  return (
    <article
      className="relative isolate min-h-full overflow-hidden bg-[linear-gradient(155deg,color-mix(in_srgb,var(--now-playing-base)_34%,#17191b),#111315_62%)] px-16 pt-6 pb-10 max-xl:px-6 max-lg:px-4 max-lg:pt-5 max-lg:pb-8"
      aria-labelledby="now-playing-heading"
      style={artworkStyle}
    >
      <div
        className="now-playing__wash pointer-events-none absolute inset-0 -z-1 bg-[radial-gradient(circle_at_20%_26%,color-mix(in_srgb,var(--now-playing-accent)_28%,transparent),transparent_37%),radial-gradient(circle_at_82%_8%,color-mix(in_srgb,var(--now-playing-base)_58%,transparent),transparent_35%)] opacity-80 saturate-75 after:absolute after:inset-0 after:bg-[linear-gradient(to_bottom,rgba(17,19,21,0.08),#111315_90%)] after:content-['']"
        aria-hidden="true"
      />
      <header className="now-playing__header relative z-1 mx-auto mb-7 flex max-w-5xl items-center justify-between max-xl:max-w-xl max-lg:mb-5">
        <Button
          variant="secondary"
          size="compact"
          className="h-8 gap-2 rounded-lg border-white/7 bg-white/2.5 px-2.5 text-xs text-muted-foreground transition-[color,border-color,background-color,transform] hover:border-white/15 hover:bg-white/6 hover:text-foreground active:translate-y-px motion-reduce:transition-none"
          onClick={onBack}
          aria-label="Back"
          title="Back to previous view"
        >
          <ArrowLeft size={17} strokeWidth={2.2} />
          Back
        </Button>
        <Badge
          variant="artwork"
          className="gap-2 border-0 bg-transparent p-0 text-xs tracking-widest text-[#a7aaa4] uppercase"
          role="status"
          aria-live="polite"
        >
          <i
            className={cn(
              "relative block size-1.5 shrink-0 rounded-full bg-(--now-playing-accent) shadow-[0_0_0_4px_color-mix(in_srgb,var(--now-playing-accent)_13%,transparent)] after:absolute after:inset-0 after:rounded-full after:bg-(--now-playing-accent) after:content-['']",
              playing &&
                "after:animate-[now-playing-status-pulse_1.8s_var(--ease-coda-enter)_infinite] after:motion-reduce:animate-none",
            )}
            aria-hidden="true"
          />
          {playing ? "Playing now" : "Paused"}
        </Badge>
      </header>

      <div
        className="relative mx-auto grid w-full max-w-5xl grid-cols-[minmax(15rem,24rem)_minmax(17rem,1fr)] items-center gap-16 max-xl:max-w-xl max-xl:grid-cols-1 max-xl:gap-6"
        data-coda-now-playing-detail-surface=""
      >
        <div
          className="now-playing__artwork aspect-square w-full drop-shadow-[0_32px_44px_rgba(0,0,0,0.42)] **:data-[cover-size=large]:size-full **:data-[cover-size=large]:rounded-xl **:data-[cover-size=large]:border **:data-[cover-size=large]:border-white/10 **:data-[cover-size=large]:shadow-none max-xl:mx-auto max-xl:w-64 max-lg:w-52"
          data-coda-track-id={track.id}
        >
          {artwork}
        </div>
        <section
          className="now-playing__details min-w-0 max-xl:text-center"
          aria-label="Current track"
        >
          <h1
            id="now-playing-heading"
            className={cn(
              "m-0 max-w-3xl wrap-anywhere font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-6xl/tight font-bold tracking-tighter text-balance text-[#f5f2eb] outline-none max-xl:text-5xl max-lg:text-3xl",
              track.title.length > 32 &&
                "text-5xl leading-none max-xl:text-4xl max-lg:text-3xl",
            )}
            title={track.title}
            tabIndex={-1}
          >
            {radioShowRouteId ? (
              <Link
                className="inline-block max-w-full truncate text-inherit outline-none hover:text-(--now-playing-accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                data-coda-now-playing-title-detail={track.id}
                onClick={(event) =>
                  handleCodaLinkActivation(event, (trigger) =>
                    onAlbum(track, trigger),
                  )
                }
                params={{
                  showId: stringifyRadioShowIdParam(radioShowRouteId),
                }}
                title={`Open ${track.title} Radio show details`}
                to="/radio/shows/$showId"
              >
                {track.title}
              </Link>
            ) : (
              <span
                className="inline-block max-w-full align-top"
                data-coda-now-playing-title-detail={track.id}
              >
                {track.title}
              </span>
            )}
          </h1>
          <div className="mt-4 flex min-w-0 items-center gap-2 text-[#696d68] max-xl:justify-center">
            {radioShowUrl ? (
              <>
                <Link
                  className="h-auto max-w-[46%] truncate p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary"
                  onClick={(event) =>
                    handleCodaLinkActivation(event, (trigger) =>
                      onRadioSeries(undefined, trigger),
                    )
                  }
                  to="/radio"
                >
                  {BANDCAMP_RADIO_PROVIDER}
                </Link>
                <span aria-hidden="true">·</span>
                {radioSeriesRouteId ? (
                  <Link
                    className="h-auto max-w-[46%] truncate p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary"
                    onClick={(event) =>
                      handleCodaLinkActivation(event, (trigger) =>
                        onRadioSeries(radioSeries?.id, trigger),
                      )
                    }
                    params={{
                      seriesId: stringifyRadioSeriesIdParam(radioSeriesRouteId),
                    }}
                    to="/radio/series/$seriesId"
                  >
                    {releaseTitle}
                  </Link>
                ) : radioShowRouteId ? (
                  <Link
                    className="h-auto max-w-[46%] truncate p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary"
                    onClick={(event) =>
                      handleCodaLinkActivation(event, (trigger) =>
                        onAlbum(track, trigger),
                      )
                    }
                    params={{
                      showId: stringifyRadioShowIdParam(radioShowRouteId),
                    }}
                    to="/radio/shows/$showId"
                  >
                    {releaseTitle}
                  </Link>
                ) : null}
                <Button
                  aria-label={`Open ${track.title} on ${BANDCAMP_RADIO_PROVIDER}`}
                  className="group/show size-6 shrink-0 rounded-sm p-0 text-[#858984] hover:bg-transparent hover:text-(--now-playing-accent)"
                  onClick={() => openRadioChapter(radioShowUrl)}
                  size="icon-compact"
                  title={`Open show on ${BANDCAMP_RADIO_PROVIDER}`}
                  variant="text"
                >
                  <ExternalLink
                    aria-hidden="true"
                    className="size-4 transition-transform duration-(--duration-coda-standard) ease-coda-enter group-hover/show:translate-x-0.5 group-hover/show:-translate-y-0.5 motion-reduce:transition-none"
                  />
                </Button>
              </>
            ) : (
              <>
                <TrackArtistLink
                  className="h-auto min-w-0 max-w-[46%] overflow-hidden p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary"
                  onNavigate={onArtist}
                  track={track}
                >
                  <OverflowMarquee text={track.artist} />
                </TrackArtistLink>
                {releaseTitle ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <TrackAlbumLink
                      className="h-auto min-w-0 max-w-[46%] overflow-hidden p-0 text-sm font-medium text-[#c1c2bc] hover:bg-transparent hover:text-primary"
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
                          className="size-3 shrink-0 text-current motion-reduce:animate-none"
                        />
                      ) : null}
                      <OverflowMarquee className="flex-1" text={releaseTitle} />
                    </TrackAlbumLink>
                  </>
                ) : null}
              </>
            )}
          </div>
          {radioTimeline.length ? (
            <NowPlayingRadioSummary
              playbackClock={playbackClock}
              timeline={radioTimeline}
              onOpen={openRadioChapter}
              getLocalLinks={getRadioChapterLocalLinks}
            />
          ) : null}
          <div className="mt-3.5 flex items-center gap-2 text-xs text-[#7d817b] max-xl:justify-center max-lg:flex-wrap">
            <span className="inline-flex items-center gap-1 after:ml-2 after:text-[#505450] after:content-['·']">
              Track {track.track}
            </span>
            <span className="inline-flex items-center gap-1 after:ml-2 after:text-[#505450] after:content-['·']">
              <Clock3 size={13} /> {formatTime(safeDuration)}
            </span>
            <span className="inline-flex items-center gap-1">
              {countLabel(queue.length - currentIndex - 1, "track")} next
            </span>
          </div>
          {onToggleFavorite ||
          (!track.id.startsWith("radio:") && onAddToPlaylist) ? (
            <div className="mt-2.5 flex gap-2 max-xl:justify-center">
              {onToggleFavorite ? (
                <Button
                  variant="text"
                  size="compact"
                  className={cn(
                    "bg-white/2.5 px-2",
                    favorite &&
                      "bg-primary/10 text-coda-favorite ring-1 ring-primary/20 ring-inset hover:bg-primary/[0.18] hover:text-coda-favorite",
                  )}
                  onClick={onToggleFavorite}
                  aria-pressed={favorite}
                >
                  <Heart size={15} fill={favorite ? "currentColor" : "none"} />
                  {favorite ? "Favorited" : "Favorite"}
                </Button>
              ) : null}
              {!track.id.startsWith("radio:") && onAddToPlaylist ? (
                <Button
                  variant="text"
                  size="compact"
                  className="bg-white/2.5 px-2"
                  onClick={onAddToPlaylist}
                >
                  <ListPlus size={15} /> Add to playlist
                </Button>
              ) : null}
            </div>
          ) : null}

          <div
            data-now-playing-controls=""
            className={cn(queueOpen && "pointer-events-none invisible")}
            aria-hidden={queueOpen || undefined}
            inert={queueOpen || undefined}
          >
            <NowPlayingPlaybackControls
              playbackClock={playbackClock}
              timeline={radioTimeline}
              duration={safeDuration}
              playing={playing}
              repeat={repeat}
              queueOpen={queueOpen}
              queueControlRef={queueOpen ? undefined : queueControlRef}
              canPrevious={canPrevious}
              canNext={canNext}
              onSeek={onSeek}
              onRepeat={onRepeat}
              onPrevious={onPrevious}
              onToggle={onToggle}
              onNext={onNext}
            />

            <div className="mt-4 flex items-center justify-center gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onVolume(volume ? 0 : DEFAULT_VOLUME)}
                      aria-label={volume ? "Mute" : "Unmute"}
                    />
                  }
                >
                  {volume ? (
                    <Volume2 className="size-5" size={19} />
                  ) : (
                    <VolumeX className="size-5" size={19} />
                  )}
                </TooltipTrigger>
                <TooltipContent>{volume ? "Mute" : "Unmute"}</TooltipContent>
              </Tooltip>
              <Slider
                className="mr-3 data-horizontal:w-28 max-lg:data-horizontal:w-20"
                aria-label="Volume"
                min={0}
                max={1}
                step={0.01}
                value={[volume]}
                onValueChange={(values) => onVolume(values[0] ?? 0)}
              />
              {airPlayAvailable ? <AirPlayButton onClick={onAirPlay} /> : null}
            </div>
          </div>
        </section>
      </div>

      {supplementalReady ? (
        <>
          <NowPlayingRadioTimeline
            key={`${track.id}:${radioTimeline.length}`}
            playbackClock={playbackClock}
            timeline={radioTimeline}
            playing={playing}
            radioLinkError={radioLinkError}
            onSeek={onSeek}
            onOpen={openRadioChapter}
            getLocalLinks={getRadioChapterLocalLinks}
          />

          <NowPlayingUpNext
            queue={queue}
            currentIndex={currentIndex}
            hasDeferredTracks={hasDeferredTracks}
            recommendation={recommendation}
            recommendationArtwork={recommendationArtwork}
            recommendationLoading={recommendationLoading}
            recommendationQueueLoading={recommendationQueueLoading}
            onQueueRecommendation={onQueueRecommendation}
            onPlayRecommendation={onPlayRecommendation}
            onAnotherRecommendation={onAnotherRecommendation}
            onRecommendationAlbum={onRecommendationAlbum}
            onPlayQueueIndex={onPlayQueueIndex}
            onArtist={onArtist}
            onAlbum={onAlbum}
            onRadioSeries={onRadioSeries}
          />
        </>
      ) : null}
    </article>
  );
}

export const NowPlayingView = memo(NowPlayingViewComponent);
