import {
  acquireTemporaryStyleProperty,
  combineMarkerReleases,
  type MarkerRelease,
} from "./temporaryDomMarkers";

const MAX_VIRTUAL_RETURN_ATTEMPTS = 8;
const DOM_OPPORTUNITY_TIMEOUT_MS = 50;

function nextDomOpportunity(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let frame: number | undefined;
    let timer: number | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
      resolve();
    };

    timer = window.setTimeout(finish, DOM_OPPORTUNITY_TIMEOUT_MS);
    if (typeof window.requestAnimationFrame === "function") {
      frame = window.requestAnimationFrame(finish);
    }
  });
}

/**
 * Restore the persistent scroll surface before asking a virtualizer for the
 * exact entity/slot that initiated navigation. The frame count and per-frame
 * timeout keep a suspended or background WebView from blocking navigation.
 */
export async function awaitVirtualReturnTrigger({
  findTrigger,
  isCurrent,
  scrollRoot,
  scrollTop,
}: Readonly<{
  findTrigger: () => HTMLElement | undefined;
  isCurrent: () => boolean;
  scrollRoot: HTMLElement | null;
  scrollTop: number;
}>): Promise<HTMLElement | undefined> {
  if (!isCurrent()) return undefined;
  if (scrollRoot) scrollRoot.scrollTop = scrollTop;

  for (let attempt = 0; attempt <= MAX_VIRTUAL_RETURN_ATTEMPTS; attempt += 1) {
    if (!isCurrent()) return undefined;
    const trigger = findTrigger();
    if (trigger?.isConnected) return trigger;
    if (attempt === MAX_VIRTUAL_RETURN_ATTEMPTS) return undefined;
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
