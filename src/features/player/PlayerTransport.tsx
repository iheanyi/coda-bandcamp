import { Repeat, Repeat1, SkipBack, SkipForward } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import type { PlaybackClock } from "@/playbackClock";
import {
  nextRadioChapterTimeInTimeline,
  previousRadioChapterTimeInTimeline,
} from "@/radioPlayback";
import type { RadioChapter, RepeatMode, Track } from "@/types";
import { PREVIOUS_RESTART_THRESHOLD_SECONDS } from "./constants";
import { usePlaybackPosition } from "./playbackClockHooks";

export type PlayerTransportProps = {
  track?: Track;
  radioTimeline: readonly RadioChapter[];
  playbackClock: PlaybackClock;
  playing: boolean;
  duration: number;
  repeat: RepeatMode;
  canPrevious: boolean;
  canNext: boolean;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (value: number) => void;
  onRepeat: () => void;
  className?: string;
};

export const PlayerTransport = memo(function PlayerTransport({
  track,
  radioTimeline,
  playbackClock,
  playing,
  duration,
  repeat,
  canPrevious,
  canNext,
  onToggle,
  onPrevious,
  onNext,
  onSeek,
  onRepeat,
  className,
}: PlayerTransportProps) {
  const currentTime = usePlaybackPosition(playbackClock);
  const positionCanPrevious =
    Boolean(track) &&
    (currentTime > PREVIOUS_RESTART_THRESHOLD_SECONDS ||
      previousRadioChapterTimeInTimeline(radioTimeline, currentTime) !==
        undefined);
  const positionCanNext =
    Boolean(track) &&
    nextRadioChapterTimeInTimeline(radioTimeline, currentTime) !== undefined;

  return (
    <div
      className={cn(
        "flex w-full max-w-3xl flex-col items-stretch gap-2 justify-self-center",
        className,
      )}
    >
      <div
        className="grid grid-cols-[repeat(5,2rem)] items-center justify-center gap-2"
        role="group"
        aria-label="Playback controls"
      >
        <span aria-hidden="true" className="size-8" />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                onClick={onPrevious}
                disabled={!canPrevious && !positionCanPrevious}
                aria-label="Previous"
                size="icon"
                variant="ghost"
              />
            }
          >
            <SkipBack size={18} fill="currentColor" />
          </TooltipTrigger>
          <TooltipContent>Previous</TooltipContent>
        </Tooltip>
        <Button
          className="size-9 rounded-full border-0 bg-[#eeece6] p-0 text-[#17191b] transition-[background-color,transform,box-shadow] duration-(--duration-coda-fast) hover:scale-105 hover:bg-white hover:shadow-[0_5px_16px_rgba(0,0,0,0.22)] active:scale-95"
          onClick={onToggle}
          disabled={!track}
          aria-label={playing ? "Pause" : "Play"}
          size="icon"
        >
          <PlaybackIcon playing={playing} />
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                onClick={onNext}
                disabled={!canNext && !positionCanNext}
                aria-label="Next"
                size="icon"
                variant="ghost"
              />
            }
          >
            <SkipForward size={18} fill="currentColor" />
          </TooltipTrigger>
          <TooltipContent>Next</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                className={repeat !== "off" ? "text-primary" : ""}
                onClick={onRepeat}
                disabled={!track}
                aria-label={`Repeat ${repeat}`}
                size="icon"
                variant="ghost"
              />
            }
          >
            {repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </TooltipTrigger>
          <TooltipContent>Repeat</TooltipContent>
        </Tooltip>
      </div>
      <div className="grid grid-cols-[2rem_minmax(6rem,1fr)_2rem] items-center gap-2">
        <span className="text-xs text-[#70746f]">
          {formatTime(currentTime)}
        </span>
        <Slider
          aria-label="Track position"
          min={0}
          max={duration || 1}
          step={1}
          value={[Math.min(currentTime, duration || 1)]}
          disabled={!track}
          onValueChange={([nextPosition]) => onSeek(nextPosition)}
        />
        <span className="text-right text-xs text-[#70746f]">
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
});
