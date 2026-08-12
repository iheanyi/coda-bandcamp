import { flushSync } from "react-dom";
import { acquireTemporaryStyleProperty } from "@/features/navigation/temporaryDomMarkers";
import {
  motionViewTransitionsEnabled,
  supersedeMotionViewTransition,
  transitionCodaViewWithMotion,
} from "./motionViewTransitions";

export type CodaViewTransitionKind =
  | "album-detail"
  | "album-detail-close"
  | "artist-detail"
  | "artist-detail-close"
  | "discover-detail"
  | "playlist-detail"
  | "playlist-detail-close"
  | "radio-detail"
  | "radio-detail-close"
  | "now-playing-open"
  | "now-playing-close"
  | "page-forward"
  | "page-back"
  | "page-crossfade";

type CodaViewTransition = {
  finished: Promise<void>;
  ready?: Promise<void>;
  skipTransition?: () => void;
  updateCallbackDone?: Promise<void>;
};

type CodaViewTransitionOptions = {
  skipSnapshot?: boolean;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    update: () => void | Promise<void>,
  ) => CodaViewTransition;
};

export type CodaViewTransitionUpdate = () => void | Promise<void>;

const TRANSITION_CLASSES: Record<CodaViewTransitionKind, string> = {
  "album-detail": "coda-transition--album-detail",
  "album-detail-close": "coda-transition--album-detail-close",
  "artist-detail": "coda-transition--artist-detail",
  "artist-detail-close": "coda-transition--artist-detail-close",
  "discover-detail": "coda-transition--discover-detail",
  "playlist-detail": "coda-transition--playlist-detail",
  "playlist-detail-close": "coda-transition--playlist-detail-close",
  "radio-detail": "coda-transition--radio-detail",
  "radio-detail-close": "coda-transition--radio-detail-close",
  "now-playing-open": "coda-transition--now-playing-open",
  "now-playing-close": "coda-transition--now-playing-close",
  "page-forward": "coda-transition--page-forward",
  "page-back": "coda-transition--page-back",
  "page-crossfade": "coda-transition--page-crossfade",
};
const TRANSITION_CLASS_NAMES = Object.values(TRANSITION_CLASSES);
const NATIVE_VIEW_TRANSITION_WATCHDOG_MS = 2_500;
let latestTransitionId = 0;
let activeTransition:
  { id: number; transition: CodaViewTransition } | undefined;
let releaseActiveSourceSuppression: (() => void) | undefined;

const SHARED_SOURCE_SELECTORS: Partial<
  Record<CodaViewTransitionKind, readonly string[]>
> = {
  "album-detail": [
    ".coda-album-artwork-source",
    "[data-coda-album-title-source]",
  ],
  "album-detail-close": [
    "[data-coda-album-artwork-detail]",
    "[data-coda-album-title-detail]",
  ],
  "artist-detail": [
    "[data-coda-artist-artwork-source] [data-slot='cover']",
    "[data-coda-artist-artwork-source][data-slot='cover']",
    "[data-coda-artist-name-source]",
  ],
  "artist-detail-close": [
    "[data-coda-artist-artwork-detail][data-slot='cover']",
    "[data-coda-artist-artwork-detail] [data-slot='cover']",
    "[data-coda-artist-name-detail]",
  ],
  "discover-detail": [
    "[data-coda-discover-artwork-source]",
    "[data-coda-discover-title-source]",
  ],
  "playlist-detail": [
    "[data-coda-playlist-identity-source]",
    "[data-coda-playlist-title-source]",
  ],
  "playlist-detail-close": [
    "[data-coda-playlist-identity-detail]",
    "[data-coda-playlist-title-detail]",
  ],
  "radio-detail": [
    "[data-coda-radio-artwork-source]",
    "[data-coda-radio-title-source]",
  ],
  "radio-detail-close": [
    "[data-coda-radio-artwork-detail]",
    "[data-coda-radio-title-detail]",
  ],
  "now-playing-open": [
    ".player__art-link",
    "[data-coda-now-playing-title-compact]",
  ],
  "now-playing-close": [
    ".now-playing__artwork",
    "[data-coda-now-playing-title-detail]",
  ],
};

function sharedSourceCandidates(kind: CodaViewTransitionKind) {
  const elements = new Set<HTMLElement>();
  for (const selector of SHARED_SOURCE_SELECTORS[kind] ?? []) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      elements.add(element);
    });
  }
  return [...elements];
}

function suppressSourcesThatSurvive(
  candidates: readonly HTMLElement[],
): () => void {
  const releases = candidates
    .filter((element) => element.isConnected)
    .map((element) =>
      // A persistent route parent or root-owned player can leave the outgoing
      // element mounted beside its destination. Exclude that old endpoint from
      // the incoming snapshot so the shared name remains unique.
      acquireTemporaryStyleProperty(
        element,
        "view-transition-name",
        "none",
        "important",
      ),
    );
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (let index = releases.length - 1; index >= 0; index -= 1) {
      releases[index]?.();
    }
  };
}

function clearTransitionClasses() {
  document.documentElement.classList.remove(
    "coda-view-transitioning",
    ...TRANSITION_CLASS_NAMES,
  );
}

function clearTransitionSupport() {
  document.documentElement.classList.remove("coda-view-transitions-supported");
}

export function transitionCodaView(
  update: CodaViewTransitionUpdate,
  kind: CodaViewTransitionKind,
  options: CodaViewTransitionOptions = {},
): Promise<void> {
  const transitionId = ++latestTransitionId;
  activeTransition?.transition.skipTransition?.();
  activeTransition = undefined;
  releaseActiveSourceSuppression?.();
  releaseActiveSourceSuppression = undefined;
  clearTransitionClasses();

  if (options.skipSnapshot) {
    if (motionViewTransitionsEnabled()) {
      supersedeMotionViewTransition();
    }
    return Promise.resolve(update()).then(() => undefined);
  }

  const transitionDocument = document as ViewTransitionDocument;
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!transitionDocument.startViewTransition || prefersReducedMotion) {
    if (motionViewTransitionsEnabled()) {
      supersedeMotionViewTransition();
    }
    return Promise.resolve(update()).then(() => undefined);
  }

  if (motionViewTransitionsEnabled()) {
    document.documentElement.classList.add(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
    );
    return transitionCodaViewWithMotion(update, kind).finally(() => {
      if (latestTransitionId === transitionId) {
        document.documentElement.classList.remove("coda-view-transitioning");
      }
    });
  }

  const transitionClass = TRANSITION_CLASSES[kind];
  let updated = false;
  let failed = false;
  let lifecycleActive = true;
  let releaseSourceSuppression: (() => void) | undefined;
  const commitUpdate = (snapshot: boolean): void | Promise<void> => {
    if (latestTransitionId !== transitionId || updated || failed) {
      return;
    }
    updated = true;
    if (snapshot) {
      const sourceCandidates = sharedSourceCandidates(kind);
      const result = flushSync(update);
      return Promise.resolve(result).then(() => {
        if (latestTransitionId !== transitionId || failed || !lifecycleActive) {
          return;
        }
        releaseSourceSuppression = suppressSourcesThatSurvive(sourceCandidates);
        if (latestTransitionId === transitionId) {
          releaseActiveSourceSuppression = releaseSourceSuppression;
        }
      });
    }
    return update();
  };
  const handleTransitionFailure = () => {
    if (latestTransitionId !== transitionId || failed) return;
    failed = true;
    activeTransition = undefined;
    releaseSourceSuppression?.();
    if (releaseActiveSourceSuppression === releaseSourceSuppression) {
      releaseActiveSourceSuppression = undefined;
    }
    clearTransitionClasses();
    clearTransitionSupport();
    if (!updated) {
      updated = true;
      update();
    }
  };
  document.documentElement.classList.add(
    "coda-view-transitions-supported",
    "coda-view-transitioning",
    transitionClass,
  );
  try {
    const transition = transitionDocument.startViewTransition.call(
      transitionDocument,
      () => {
        return commitUpdate(true);
      },
    );
    if (latestTransitionId === transitionId) {
      activeTransition = { id: transitionId, transition };
    } else {
      transition.skipTransition?.();
    }
    const lifecycle = [
      transition.finished.then(undefined, handleTransitionFailure),
      transition.ready?.then(undefined, handleTransitionFailure),
      transition.updateCallbackDone?.then(undefined, handleTransitionFailure),
    ].filter((promise): promise is Promise<void> => Boolean(promise));
    let watchdogId: number | undefined;
    const watchdog = new Promise<void>((resolve) => {
      watchdogId = window.setTimeout(() => {
        if (latestTransitionId === transitionId) {
          transition.skipTransition?.();
          void Promise.resolve(commitUpdate(false)).finally(resolve);
          return;
        }
        resolve();
      }, NATIVE_VIEW_TRANSITION_WATCHDOG_MS);
    });
    return Promise.race([
      Promise.all(lifecycle).then(() => undefined),
      watchdog,
    ]).finally(() => {
      if (watchdogId !== undefined) window.clearTimeout(watchdogId);
      if (latestTransitionId !== transitionId) return;
      lifecycleActive = false;
      activeTransition = undefined;
      releaseSourceSuppression?.();
      if (releaseActiveSourceSuppression === releaseSourceSuppression) {
        releaseActiveSourceSuppression = undefined;
      }
      clearTransitionClasses();
    });
  } catch {
    if (latestTransitionId === transitionId) {
      handleTransitionFailure();
    }
    return Promise.resolve();
  }
}
