import { Airplay, ListMusic, ListPlus, Volume2, VolumeX } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { DrawerClose, DrawerTrigger } from "@/components/ui/drawer";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RadioChapterLocalLinks } from "@/RadioChapterMetadata";
import { cn } from "@/lib/utils";
import type { PlaybackClock } from "@/playbackClock";
import type { RadioChapter, RepeatMode, Track } from "@/types";
import type { ArtistNavigationHandler } from "@/features/library/types";
import { PlayerTrack } from "./PlayerTrack";
import { PlayerTransport } from "./PlayerTransport";

export type PlayerDockProps = {
  mode?: "full" | "now-playing-queue";
  track?: Track;
  radioTimeline: readonly RadioChapter[];
  playing: boolean;
  playbackClock: PlaybackClock;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onRepeat: () => void;
  airPlayAvailable: boolean;
  onAirPlay: () => void;
  onArtist: ArtistNavigationHandler;
  onAlbum: (track: Track, trigger?: HTMLElement) => void;
  albumLoading: boolean;
  onNowPlaying: () => void;
  onOpenRadioItem: (url: string) => void;
  getRadioChapterLocalLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
  favorite: boolean;
  onToggleFavorite?: () => void;
  onAddToPlaylist?: () => void;
  queueOpen: boolean;
  queueControlRef: RefObject<HTMLButtonElement | null>;
  className?: string;
};

export function PlayerDock({
  mode = "full",
  track,
  radioTimeline,
  playing,
  playbackClock,
  duration,
  volume,
  repeat,
  onToggle,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  onSeek,
  onVolume,
  onRepeat,
  airPlayAvailable,
  onAirPlay,
  onArtist,
  onAlbum,
  albumLoading,
  onNowPlaying,
  onOpenRadioItem,
  getRadioChapterLocalLinks,
  favorite,
  onToggleFavorite,
  onAddToPlaylist,
  queueOpen,
  queueControlRef,
  className,
}: PlayerDockProps) {
  return (
    <footer
      className={cn(
        "relative z-3 grid grid-cols-[minmax(0,1fr)_minmax(18rem,1.4fr)_minmax(0,1fr)] items-center gap-3 border-t border-(--line-strong) bg-coda-player px-3 shadow-coda-player lg:grid-cols-[minmax(0,1fr)_minmax(22rem,1.5fr)_minmax(0,1fr)] lg:gap-6 lg:px-4",
        mode === "now-playing-queue" && "fixed inset-x-0 bottom-0 h-23",
        className,
      )}
      data-player-mode={mode}
    >
      {mode === "full" ? (
        <PlayerTrack
          track={track}
          radioTimeline={radioTimeline}
          playbackClock={playbackClock}
          favorite={favorite}
          onToggleFavorite={onToggleFavorite}
          onArtist={onArtist}
          onAlbum={onAlbum}
          albumLoading={albumLoading}
          onNowPlaying={onNowPlaying}
          onOpenRadioItem={onOpenRadioItem}
          getRadioChapterLocalLinks={getRadioChapterLocalLinks}
        />
      ) : (
        <span aria-hidden="true" />
      )}
      <PlayerTransport
        track={track}
        radioTimeline={radioTimeline}
        playbackClock={playbackClock}
        playing={playing}
        duration={duration}
        repeat={repeat}
        canPrevious={canPrevious}
        canNext={canNext}
        onToggle={onToggle}
        onPrevious={onPrevious}
        onNext={onNext}
        onSeek={onSeek}
        onRepeat={onRepeat}
      />
      <div className="flex w-full min-w-0 items-center justify-end justify-self-end gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                onClick={() => onVolume(volume ? 0 : 0.72)}
                aria-label={volume ? "Mute" : "Unmute"}
                size="icon"
                variant="ghost"
              />
            }
          >
            {volume ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </TooltipTrigger>
          <TooltipContent>{volume ? "Mute" : "Unmute"}</TooltipContent>
        </Tooltip>
        <Slider
          aria-label="Volume"
          className={
            mode === "now-playing-queue"
              ? "w-16 lg:w-20"
              : "hidden w-20 lg:block"
          }
          min={0}
          max={1}
          step={0.01}
          value={[volume]}
          onValueChange={([nextVolume]) => onVolume(nextVolume)}
        />
        {airPlayAvailable ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  onClick={onAirPlay}
                  disabled={!track}
                  aria-label="Choose AirPlay device"
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <Airplay size={18} />
            </TooltipTrigger>
            <TooltipContent>Choose AirPlay device</TooltipContent>
          </Tooltip>
        ) : null}
        {mode === "full" && track && onAddToPlaylist ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  onClick={onAddToPlaylist}
                  aria-label={`Add ${track.title} to playlist`}
                  size="icon"
                  variant="ghost"
                />
              }
            >
              <ListPlus size={17} />
            </TooltipTrigger>
            <TooltipContent>Add to playlist</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          {queueOpen ? (
            <DrawerClose
              render={
                <TooltipTrigger
                  render={
                    <Button
                      className="text-primary"
                      ref={queueControlRef}
                      aria-controls="queue-drawer"
                      aria-expanded="true"
                      aria-haspopup="dialog"
                      aria-label="Hide queue"
                      aria-pressed="true"
                      size="icon"
                      variant="ghost"
                    />
                  }
                >
                  <ListMusic size={18} />
                </TooltipTrigger>
              }
            />
          ) : (
            <DrawerTrigger
              render={
                <TooltipTrigger
                  render={
                    <Button
                      className={queueOpen ? "text-primary" : ""}
                      ref={queueControlRef}
                      aria-label={queueOpen ? "Hide queue" : "Show queue"}
                      aria-pressed={queueOpen}
                      size="icon"
                      variant="ghost"
                    />
                  }
                >
                  <ListMusic size={18} />
                </TooltipTrigger>
              }
            />
          )}
          <TooltipContent>
            {queueOpen ? "Hide queue" : "Show queue"}
          </TooltipContent>
        </Tooltip>
      </div>
    </footer>
  );
}
