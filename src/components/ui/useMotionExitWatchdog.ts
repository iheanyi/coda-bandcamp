import * as React from "react";

// Motion exits in this project currently top out at 140 ms. This is not the
// animation clock; it is a last-resort lifecycle guard for an interrupted or
// stalled scheduler so Base UI cannot leave an invisible portal mounted.
const MOTION_EXIT_WATCHDOG_MS = 500;

type MotionExitWatchdogOptions = Readonly<{
  onExitComplete: () => void;
  open: boolean;
}>;

export function useMotionExitWatchdog({
  onExitComplete,
  open,
}: MotionExitWatchdogOptions): () => void {
  const openRef = React.useRef(open);
  const previousOpenRef = React.useRef(open);
  const exitGenerationRef = React.useRef(0);
  const onExitCompleteRef = React.useRef(onExitComplete);
  const hasOpenedRef = React.useRef(open);
  const completedGenerationRef = React.useRef<number | null>(null);

  openRef.current = open;
  onExitCompleteRef.current = onExitComplete;
  if (previousOpenRef.current !== open) {
    previousOpenRef.current = open;
    if (!open) exitGenerationRef.current += 1;
  }
  const exitGeneration = exitGenerationRef.current;
  if (open) {
    hasOpenedRef.current = true;
    completedGenerationRef.current = null;
  }

  const completeExit = React.useCallback(() => {
    if (
      openRef.current ||
      exitGeneration !== exitGenerationRef.current ||
      completedGenerationRef.current === exitGeneration ||
      !hasOpenedRef.current
    ) {
      return;
    }
    completedGenerationRef.current = exitGeneration;
    hasOpenedRef.current = false;
    onExitCompleteRef.current();
  }, [exitGeneration]);

  React.useEffect(() => {
    if (
      open ||
      !hasOpenedRef.current ||
      completedGenerationRef.current === exitGeneration
    ) {
      return;
    }
    const timeoutId = window.setTimeout(completeExit, MOTION_EXIT_WATCHDOG_MS);
    return () => window.clearTimeout(timeoutId);
  }, [completeExit, exitGeneration, open]);

  return completeExit;
}
