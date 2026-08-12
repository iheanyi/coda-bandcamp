import { usePresence } from "motion/react";
import * as m from "motion/react-m";
import type { ReactNode } from "react";
import { useMotionExitWatchdog } from "@/components/ui/useMotionExitWatchdog";
import { cn } from "@/lib/utils";
import { codaMotion } from "@/motion";

export type QueueCurrentPresenceProps = {
  children: ReactNode;
  className?: string;
};

export function QueueCurrentPresence({
  children,
  className,
}: QueueCurrentPresenceProps) {
  const [isPresent, safeToRemove] = usePresence();
  const completeExit = useMotionExitWatchdog({
    open: isPresent,
    onExitComplete: () => safeToRemove?.(),
  });
  return (
    <m.div
      aria-hidden={!isPresent || undefined}
      className={cn(
        "mx-3 mb-2 overflow-hidden rounded-md border border-primary/25 bg-[linear-gradient(135deg,rgba(221,101,73,0.14),transparent_62%),#1c1a1b] p-2.5",
        className,
      )}
      inert={!isPresent || undefined}
      initial={{
        opacity: 0,
        transform: "translateX(8px)",
      }}
      animate={{
        opacity: 1,
        transform: "translateX(0px)",
        transition: codaMotion.componentEnter,
      }}
      exit={{
        opacity: 0,
        transform: "translateX(-6px)",
        transition: codaMotion.componentExit,
      }}
      onAnimationComplete={completeExit}
      style={{ pointerEvents: isPresent ? "auto" : "none" }}
    >
      {children}
    </m.div>
  );
}
