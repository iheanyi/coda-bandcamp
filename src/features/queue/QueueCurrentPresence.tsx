import type { ReactNode } from "react";
import { MotionExitPresence } from "@/components/ui/MotionExitPresence";
import { cn } from "@/lib/utils";
import { useCodaMotion } from "@/motion";

export type QueueCurrentPresenceProps = {
  children: ReactNode;
  className?: string;
};

export function QueueCurrentPresence({
  children,
  className,
}: QueueCurrentPresenceProps) {
  const codaMotion = useCodaMotion();
  return (
    <MotionExitPresence
      className={cn(
        "mx-3 mb-2 overflow-hidden rounded-md border border-primary/25 bg-[linear-gradient(135deg,rgba(221,101,73,0.14),transparent_62%),#1c1a1b] p-2.5",
        className,
      )}
      initial={{
        opacity: codaMotion.profile.component.opacityFrom,
        transform: `translateX(${codaMotion.profile.component.translationPx}px) scale(${codaMotion.profile.component.scaleFrom})`,
      }}
      animate={{
        opacity: 1,
        transform: "translateX(0px) scale(1)",
        transition: codaMotion.componentEnter,
      }}
      exit={{
        opacity: codaMotion.profile.component.opacityFrom,
        transform: `translateX(${-codaMotion.profile.component.translationPx * 0.75}px) scale(${codaMotion.profile.component.scaleFrom})`,
        transition: codaMotion.componentExit,
      }}
      style={{ pointerEvents: "auto" }}
    >
      {children}
    </MotionExitPresence>
  );
}
