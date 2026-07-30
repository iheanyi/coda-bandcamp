import { flushSync } from "react-dom";
import {
  motionViewTransitionsEnabled,
  supersedeMotionViewTransition,
  transitionCodaViewWithMotion,
} from "./motionViewTransitions";

export type CodaViewTransitionKind =
  | "album-detail"
  | "artist-detail"
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
  startViewTransition?: (update: () => void) => CodaViewTransition;
};

const TRANSITION_CLASSES: Record<CodaViewTransitionKind, string> = {
  "album-detail": "coda-transition--album-detail",
  "artist-detail": "coda-transition--artist-detail",
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
let latestTransitionId = 0;
let activeTransition:
  | { id: number; transition: CodaViewTransition }
  | undefined;

function clearTransitionClasses() {
  document.documentElement.classList.remove(
    "coda-view-transitioning",
    ...TRANSITION_CLASS_NAMES,
  );
}

function clearTransitionSupport() {
  document.documentElement.classList.remove(
    "coda-view-transitions-supported",
  );
}

export function transitionCodaView(
  update: () => void,
  kind: CodaViewTransitionKind,
  options: CodaViewTransitionOptions = {},
): Promise<void> {
  const transitionId = ++latestTransitionId;
  activeTransition?.transition.skipTransition?.();
  activeTransition = undefined;
  clearTransitionClasses();

  if (options.skipSnapshot || kind === "page-back") {
    if (motionViewTransitionsEnabled()) {
      supersedeMotionViewTransition();
    }
    update();
    return Promise.resolve();
  }

  const transitionDocument = document as ViewTransitionDocument;
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!transitionDocument.startViewTransition || prefersReducedMotion) {
    if (motionViewTransitionsEnabled()) {
      supersedeMotionViewTransition();
    }
    update();
    return Promise.resolve();
  }

  if (motionViewTransitionsEnabled()) {
    document.documentElement.classList.add(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
    );
    return transitionCodaViewWithMotion(update, kind).finally(() => {
      document.documentElement.classList.remove("coda-view-transitioning");
    });
  }

  const transitionClass = TRANSITION_CLASSES[kind];
  let updated = false;
  let failed = false;
  const commitUpdate = (snapshot: boolean) => {
    if (latestTransitionId !== transitionId || updated || failed) {
      return;
    }
    updated = true;
    if (snapshot) {
      flushSync(update);
    } else {
      update();
    }
  };
  const handleTransitionFailure = () => {
    if (latestTransitionId !== transitionId || failed) return;
    failed = true;
    activeTransition = undefined;
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
        commitUpdate(true);
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
      transition.updateCallbackDone?.then(
        undefined,
        handleTransitionFailure,
      ),
    ].filter((promise): promise is Promise<void> => Boolean(promise));
    return Promise.all(lifecycle)
      .then(() => undefined)
      .finally(() => {
        if (latestTransitionId !== transitionId) return;
        activeTransition = undefined;
        clearTransitionClasses();
      });
  } catch {
    if (latestTransitionId === transitionId) {
      handleTransitionFailure();
    }
    return Promise.resolve();
  }
}
