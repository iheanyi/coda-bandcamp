import {
  acquireTemporaryStyleProperty,
  combineMarkerReleases,
  type MarkerRelease,
} from "./temporaryDomMarkers";

const DEFAULT_MAXIMUM_FRAME_WAITS = 8;

function nextDomOpportunity(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    queueMicrotask(resolve);
  });
}

/**
 * Restore the persistent scroll surface before asking a virtualizer for the
 * exact entity/slot that initiated navigation. Callers choose how many frames
 * the View Transition snapshot may wait for the virtualizer to mount it.
 */
export async function awaitVirtualReturnTrigger({
  findTrigger,
  isCurrent,
  maximumFrameWaits = DEFAULT_MAXIMUM_FRAME_WAITS,
  scrollRoot,
  scrollTop,
}: Readonly<{
  findTrigger: () => HTMLElement | undefined;
  isCurrent: () => boolean;
  maximumFrameWaits?: number;
  scrollRoot: HTMLElement | null;
  scrollTop: number;
}>): Promise<HTMLElement | undefined> {
  if (!isCurrent()) return undefined;
  if (scrollRoot) scrollRoot.scrollTop = scrollTop;

  for (let frameWaits = 0; frameWaits <= maximumFrameWaits; frameWaits += 1) {
    if (!isCurrent()) return undefined;
    const trigger = findTrigger();
    if (trigger?.isConnected) return trigger;
    if (frameWaits === maximumFrameWaits) return undefined;
    await nextDomOpportunity();
  }

  return undefined;
}

/**
 * `content-visibility: auto` may keep an offscreen virtualized card out of the
 * View Transition snapshot even after its DOM node mounts. Lease an inline
 * override through the transition, then restore every author's exact value.
 */
export function forcePaintedReturnAncestors(
  element: HTMLElement,
  scrollRoot: HTMLElement | null,
): MarkerRelease {
  const releases: MarkerRelease[] = [];
  let candidate: HTMLElement | null = element;
  while (candidate && candidate !== scrollRoot) {
    if (
      window
        .getComputedStyle(candidate)
        .getPropertyValue("content-visibility") === "auto"
    ) {
      releases.push(
        acquireTemporaryStyleProperty(
          candidate,
          "content-visibility",
          "visible",
        ),
      );
    }
    candidate = candidate.parentElement;
  }
  return combineMarkerReleases(releases);
}
