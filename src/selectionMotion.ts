import { useLayoutEffect, useMemo, useRef } from "react";
import { useReducedMotionConfig, type Transition } from "motion/react";

import { codaMotion } from "@/motion";

const SELECTION_PILL_DURATION_PER_STEP = 0.055;
const SELECTION_PILL_MAX_DURATION = 0.46;

function boundedTravelSteps(distanceSteps: number): number {
  if (!Number.isFinite(distanceSteps)) return 0;
  return Math.max(0, Math.round(Math.abs(distanceSteps)));
}

export function selectionPillTransitionForDistance(
  distanceSteps: number,
  reducedMotion: boolean,
): Transition {
  if (reducedMotion) return { duration: 0 };

  const travelSteps = Math.max(1, boundedTravelSteps(distanceSteps));
  return {
    ...codaMotion.selectionPill,
    visualDuration: Math.min(
      codaMotion.selectionPill.visualDuration +
        (travelSteps - 1) * SELECTION_PILL_DURATION_PER_STEP,
      SELECTION_PILL_MAX_DURATION,
    ),
    bounce: travelSteps > 2 ? 0.02 : codaMotion.selectionPill.bounce,
  };
}

export function useDistanceAwareSelectionPill(
  selectedIndex: number,
  distanceOverride?: number,
): Readonly<{
  transition: Transition;
  travelSteps: number;
}> {
  const reducedMotion = useReducedMotionConfig() === true;
  const previousIndexRef = useRef(selectedIndex);
  const travelSteps = boundedTravelSteps(
    distanceOverride ?? selectedIndex - previousIndexRef.current,
  );

  useLayoutEffect(() => {
    previousIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  const transition = useMemo(
    () => selectionPillTransitionForDistance(travelSteps, reducedMotion),
    [reducedMotion, travelSteps],
  );

  return { transition, travelSteps };
}
