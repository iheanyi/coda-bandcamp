import { useLayoutEffect, useMemo, useRef } from "react";
import { useReducedMotionConfig, type Transition } from "motion/react";

import { codaMotion, useCodaMotion } from "@/motion";

const SELECTION_PILL_DURATION_PER_STEP = 0.055;
const SELECTION_PILL_MAX_DURATION = 0.46;

export type DistanceAwareSelectionPill = Readonly<{
  transition: Transition;
  travelSteps: number;
}>;

function boundedTravelSteps(distanceSteps: number): number {
  if (!Number.isFinite(distanceSteps)) return 0;
  return Math.max(0, Math.round(Math.abs(distanceSteps)));
}

export function selectionPillTransitionForDistance(
  distanceSteps: number,
  reducedMotion: boolean,
  base: Transition = codaMotion.selectionPill,
): Transition {
  if (reducedMotion) return { duration: 0 };

  const travelSteps = Math.max(1, boundedTravelSteps(distanceSteps));
  return {
    ...base,
    visualDuration: Math.min(
      Number(base.visualDuration ?? 0.3) +
        (travelSteps - 1) * SELECTION_PILL_DURATION_PER_STEP,
      SELECTION_PILL_MAX_DURATION,
    ),
    bounce: travelSteps > 2 ? 0.02 : base.bounce,
  };
}

export function useDistanceAwareSelectionPill(
  selectedIndex: number,
  distanceOverride?: number,
): DistanceAwareSelectionPill {
  const codaMotion = useCodaMotion();
  const reducedMotion = useReducedMotionConfig() === true;
  const previousIndexRef = useRef(selectedIndex);
  const travelSteps = boundedTravelSteps(
    distanceOverride ?? selectedIndex - previousIndexRef.current,
  );

  useLayoutEffect(() => {
    previousIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const transition = useMemo(
    () =>
      selectionPillTransitionForDistance(
        travelSteps,
        reducedMotion,
        codaMotion.selectionPill,
      ),
    [codaMotion.selectionPill, reducedMotion, travelSteps],
  );

  return { transition, travelSteps };
}
