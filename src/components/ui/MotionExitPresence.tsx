import type { ComponentType, CSSProperties, ReactNode } from "react";
import { type HTMLMotionProps, usePresence } from "motion/react";
import * as m from "motion/react-m";

import { useMotionExitWatchdog } from "@/components/ui/useMotionExitWatchdog";

export type MotionExitElementProps = Readonly<{
  "aria-hidden"?: boolean;
  animate?: HTMLMotionProps<"div">["animate"];
  children: ReactNode;
  className?: string;
  "data-slot"?: string;
  exit?: HTMLMotionProps<"div">["exit"];
  inert?: boolean;
  initial?: HTMLMotionProps<"div">["initial"];
  onAnimationComplete?: () => void;
  style?: CSSProperties;
  transition?: HTMLMotionProps<"div">["transition"];
}>;

type MotionExitElement =
  | ComponentType<MotionExitElementProps>
  | typeof m.div;

type MotionExitPresenceProps = Omit<
  MotionExitElementProps,
  "aria-hidden" | "inert" | "onAnimationComplete"
> &
  Readonly<{
    motionComponent?: MotionExitElement;
  }>;

export function MotionExitPresence({
  children,
  motionComponent: MotionComponent = m.div,
  style,
  ...props
}: MotionExitPresenceProps) {
  const [isPresent, safeToRemove] = usePresence();
  const completeExit = useMotionExitWatchdog({
    open: isPresent,
    onExitComplete: () => safeToRemove?.(),
  });
  const presenceStyle: CSSProperties = {
    ...style,
    pointerEvents: isPresent ? style?.pointerEvents : "none",
  };

  return (
    <MotionComponent
      {...props}
      aria-hidden={!isPresent || undefined}
      inert={!isPresent || undefined}
      onAnimationComplete={completeExit}
      style={presenceStyle}
    >
      {children}
    </MotionComponent>
  );
}
