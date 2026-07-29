import { Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";

function PlaybackIcon({
  className,
  playing,
}: {
  className?: string;
  playing: boolean;
}) {
  const transitionClassName =
    "absolute size-full transition-[opacity,transform] duration-(--duration-coda-fast) ease-coda-enter motion-reduce:transition-none";

  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-grid size-5 shrink-0 place-items-center", className)}
      data-playing={playing}
      data-slot="playback-icon"
    >
      <Play
        className={cn(
          transitionClassName,
          playing
            ? "scale-75 rotate-12 opacity-0"
            : "scale-100 rotate-0 opacity-100",
        )}
        fill="currentColor"
      />
      <Pause
        className={cn(
          transitionClassName,
          playing
            ? "scale-100 rotate-0 opacity-100"
            : "scale-75 -rotate-12 opacity-0",
        )}
        fill="currentColor"
      />
    </span>
  );
}

export { PlaybackIcon };
