import { Pause, Play } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

import { cn } from "@/lib/utils";
import { codaMotion } from "@/motion";

function PlaybackIcon({
  className,
  playing,
}: {
  className?: string;
  playing: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-grid size-5 shrink-0 place-items-center", className)}
      data-playing={playing}
      data-slot="playback-icon"
    >
      <AnimatePresence initial={false}>
        <m.span
          animate={{ opacity: 1, transform: "scale(1) rotate(0deg)" }}
          className="absolute inset-0 grid place-items-center"
          exit={{
            opacity: 0,
            transform: playing
              ? "scale(0.78) rotate(-10deg)"
              : "scale(0.78) rotate(10deg)",
          }}
          initial={{
            opacity: 0,
            transform: playing
              ? "scale(0.78) rotate(10deg)"
              : "scale(0.78) rotate(-10deg)",
          }}
          key={playing ? "pause" : "play"}
          transition={codaMotion.feedback}
        >
          {playing
            ? <Pause className="size-full" fill="currentColor" />
            : <Play className="size-full" fill="currentColor" />}
        </m.span>
      </AnimatePresence>
    </span>
  );
}

export { PlaybackIcon };
