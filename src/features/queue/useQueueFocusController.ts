import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
} from "react";

export type QueueFocusScheduler = (
  focus: () => void,
) => () => void;

function scheduleQueueFocus(focus: () => void): () => void {
  if (typeof window.requestAnimationFrame === "function") {
    const frame = window.requestAnimationFrame(focus);
    return () => window.cancelAnimationFrame(frame);
  }

  const timer = window.setTimeout(focus, 0);
  return () => window.clearTimeout(timer);
}

export type QueueFocusControllerOptions = Readonly<{
  open: boolean;
  setOpen: (open: boolean) => void;
  scheduleFocus?: QueueFocusScheduler;
}>;

export type QueueFocusController = Readonly<{
  controlRef: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  panelRef: RefObject<HTMLDivElement | null>;
}>;

/**
 * Coordinates focus for the persistent queue drawer. Opening focuses the
 * panel after it mounts; closing restores the single player control. Pending
 * work is cancelled when the direction changes or the shell unmounts.
 */
export function useQueueFocusController({
  open,
  setOpen,
  scheduleFocus = scheduleQueueFocus,
}: QueueFocusControllerOptions): QueueFocusController {
  const panelRef = useRef<HTMLDivElement>(null);
  const controlRef = useRef<HTMLButtonElement>(null);
  const panelFocusRequestedRef = useRef(false);
  const cancelPanelFocusRef = useRef<(() => void) | undefined>(undefined);
  const cancelControlFocusRef = useRef<(() => void) | undefined>(undefined);

  const cancelPanelFocus = useCallback(() => {
    cancelPanelFocusRef.current?.();
    cancelPanelFocusRef.current = undefined;
  }, []);
  const cancelControlFocus = useCallback(() => {
    cancelControlFocusRef.current?.();
    cancelControlFocusRef.current = undefined;
  }, []);

  useEffect(
    () => () => {
      cancelPanelFocus();
      cancelControlFocus();
    },
    [cancelControlFocus, cancelPanelFocus],
  );

  useEffect(() => {
    if (!open || !panelFocusRequestedRef.current) return;
    panelFocusRequestedRef.current = false;
    cancelPanelFocus();
    const cancelScheduledFocus = scheduleFocus(() => {
      cancelPanelFocusRef.current = undefined;
      panelRef.current?.focus({ preventScroll: true });
    });
    cancelPanelFocusRef.current = cancelScheduledFocus;
    return () => {
      if (cancelPanelFocusRef.current === cancelScheduledFocus) {
        cancelPanelFocus();
      }
    };
  }, [cancelPanelFocus, open, scheduleFocus]);

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      cancelPanelFocus();
      cancelControlFocus();
      if (nextOpen) {
        panelFocusRequestedRef.current = true;
      } else {
        panelFocusRequestedRef.current = false;
        cancelControlFocusRef.current = scheduleFocus(() => {
          cancelControlFocusRef.current = undefined;
          controlRef.current?.focus({ preventScroll: true });
        });
      }
      setOpen(nextOpen);
    },
    [cancelControlFocus, cancelPanelFocus, scheduleFocus, setOpen],
  );

  return {
    controlRef,
    onOpenChange,
    panelRef,
  };
}
