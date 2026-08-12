import { flushSync } from "react-dom";
import { animate, type AnimationPlaybackControls } from "motion";
import { acquireTemporaryStyleProperty } from "@/features/navigation/temporaryDomMarkers";
import {
  motionViewTransitionsEnabled,
  supersedeMotionViewTransition,
  transitionCodaViewWithMotion,
} from "./motionViewTransitions";
import {
  beginMotionDiagnostic,
  finishMotionDiagnostic,
  inspectMotionPseudoLayers,
  rectSnapshot,
  updateMotionDiagnostic,
} from "./motionDiagnostics";
import type { MotionEase, ResolvedMotionProfile } from "./motionProfile";
import { snapshotMotionProfile } from "./motionProfileStore";

export type CodaViewTransitionKind =
  | "album-detail"
  | "album-detail-close"
  | "artist-detail"
  | "artist-detail-close"
  | "discover-detail"
  | "discover-detail-close"
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
  routerOwnedPage?: boolean;
  skipSnapshot?: boolean;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    update: () => void | Promise<void>,
  ) => CodaViewTransition;
};

export type CodaViewTransitionUpdate = (
  routerViewTransition?: boolean,
) => void | Promise<void>;

const TRANSITION_CLASSES: Record<CodaViewTransitionKind, string> = {
  "album-detail": "coda-transition--album-detail",
  "album-detail-close": "coda-transition--album-detail-close",
  "artist-detail": "coda-transition--artist-detail",
  "artist-detail-close": "coda-transition--artist-detail-close",
  "discover-detail": "coda-transition--discover-detail",
  "discover-detail-close": "coda-transition--discover-detail-close",
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
const PAGE_MOTION_STYLE_PROPERTIES = [
  "--coda-motion-page-enter-duration",
  "--coda-motion-page-exit-duration",
  "--coda-motion-page-total-duration",
  "--coda-motion-page-enter-delay",
  "--coda-motion-page-enter-ease",
  "--coda-motion-page-exit-ease",
  "--coda-motion-page-old-x",
  "--coda-motion-page-new-x",
  "--coda-motion-page-scale-from",
  "--coda-motion-page-opacity-from",
] as const;
let latestTransitionId = 0;
let activeTransition:
  { id: number; transition: CodaViewTransition } | undefined;
let releaseActiveSourceSuppression: (() => void) | undefined;
let activePageAnimations: AnimationPlaybackControls[] = [];
let releaseActivePageStyles: (() => void) | undefined;

function stopActivePageAnimations() {
  for (const controls of activePageAnimations) controls.stop();
  activePageAnimations = [];
  releaseActivePageStyles?.();
  releaseActivePageStyles = undefined;
}

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
  "discover-detail-close": [
    "[data-coda-discover-artwork-detail]",
    "[data-coda-discover-title-detail]",
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
  for (const property of PAGE_MOTION_STYLE_PROPERTIES) {
    document.documentElement.style.removeProperty(property);
  }
}

function clearTransitionSupport() {
  document.documentElement.classList.remove("coda-view-transitions-supported");
}

const CSS_EASINGS: Record<MotionEase, string> = {
  emphasized: "cubic-bezier(0.22, 1, 0.36, 1)",
  standard: "cubic-bezier(0.4, 0, 0.2, 1)",
  accelerate: "cubic-bezier(0.4, 0, 1, 1)",
  linear: "linear",
};

function isPageTransition(
  kind: CodaViewTransitionKind,
): kind is "page-forward" | "page-back" | "page-crossfade" {
  return kind.startsWith("page");
}

function configureNativePageProfile(
  kind: "page-forward" | "page-back" | "page-crossfade",
  motion: ResolvedMotionProfile,
) {
  const root = document.documentElement;
  const { page, speed } = motion.profile;
  const reverse = kind === "page-back";
  const translation = page.translationPx;
  root.style.setProperty(
    "--coda-motion-page-enter-duration",
    `${page.enter.durationMs / speed}ms`,
  );
  root.style.setProperty(
    "--coda-motion-page-exit-duration",
    `${page.exit.durationMs / speed}ms`,
  );
  root.style.setProperty(
    "--coda-motion-page-total-duration",
    `${Math.max(page.exit.durationMs, page.enter.durationMs + page.enterDelayMs) / speed}ms`,
  );
  root.style.setProperty(
    "--coda-motion-page-enter-delay",
    `${page.enterDelayMs / speed}ms`,
  );
  root.style.setProperty(
    "--coda-motion-page-enter-ease",
    CSS_EASINGS[page.enter.ease],
  );
  root.style.setProperty(
    "--coda-motion-page-exit-ease",
    CSS_EASINGS[page.exit.ease],
  );
  root.style.setProperty(
    "--coda-motion-page-old-x",
    `${(reverse ? 1 : -1) * translation * 0.6}px`,
  );
  root.style.setProperty(
    "--coda-motion-page-new-x",
    `${(reverse ? -1 : 1) * translation}px`,
  );
  root.style.setProperty(
    "--coda-motion-page-scale-from",
    String(page.scaleFrom),
  );
  root.style.setProperty(
    "--coda-motion-page-opacity-from",
    String(page.opacityFrom),
  );
}

async function transitionRouterOwnedPage(
  update: CodaViewTransitionUpdate,
  kind: "page-forward" | "page-back" | "page-crossfade",
  motion: ResolvedMotionProfile,
  transitionId: number,
) {
  // Primary destinations can contain thousands of virtualized cards. Asking
  // WebKit to rasterize that whole pane for a native View Transition costs far
  // more than the animation itself. TanStack preloads the route first; animate
  // its committed destination live after the snapshot-free render
  // acknowledgement. The outgoing page stays interactive while loaders run.
  supersedeMotionViewTransition();
  stopActivePageAnimations();
  const transitionClass =
    motion.profile.page.mode === "crossfade"
      ? TRANSITION_CLASSES["page-crossfade"]
      : TRANSITION_CLASSES[kind];
  document.documentElement.classList.add(
    "coda-view-transitioning",
    transitionClass,
  );
  const source = document.querySelector<HTMLElement>(".library-pane");
  const configuredDurationMs =
    (motion.profile.page.enter.durationMs + motion.profile.page.enterDelayMs) /
    motion.profile.speed;
  const diagnosticId = beginMotionDiagnostic({
    kind,
    configuredDurationMs,
    speed: motion.profile.speed,
    transitionClass,
    transitionNames: [],
    transitionClasses: [transitionClass, "coda-live-page"],
    sourceRect: source
      ? rectSnapshot(source.getBoundingClientRect())
      : undefined,
    sourceCount: document.querySelectorAll(".library-pane").length,
    destinationCount: 0,
    sharedExpected: false,
  });
  const direction = kind === "page-back" ? -1 : 1;
  const slide =
    kind !== "page-crossfade" && motion.profile.page.mode === "slide";
  const newTransform = slide
    ? `translateX(${direction * motion.profile.page.translationPx}px) scale(${motion.profile.page.scaleFrom})`
    : `scale(${motion.profile.page.scaleFrom})`;

  try {
    await update(false);
    if (transitionId !== latestTransitionId) return;
    const destination = document.querySelector<HTMLElement>(".library-pane");
    const animationStartedAt = performance.now();
    if (destination) {
      const inlineOpacity = destination.style.getPropertyValue("opacity");
      const inlineTransform = destination.style.getPropertyValue("transform");
      const inlineOpacityPriority =
        destination.style.getPropertyPriority("opacity");
      const inlineTransformPriority =
        destination.style.getPropertyPriority("transform");
      let released = false;
      releaseActivePageStyles = () => {
        if (released) return;
        released = true;
        destination.style.setProperty(
          "opacity",
          inlineOpacity,
          inlineOpacityPriority,
        );
        destination.style.setProperty(
          "transform",
          inlineTransform,
          inlineTransformPriority,
        );
      };
      destination.style.setProperty(
        "opacity",
        String(motion.profile.page.opacityFrom),
      );
      destination.style.setProperty("transform", newTransform);
      const enter = animate(
        destination,
        {
          opacity: [motion.profile.page.opacityFrom, 1],
          transform: [newTransform, "translateX(0px) scale(1)"],
        },
        motion.viewEnter,
      );
      activePageAnimations = [enter];
      await enter.finished;
    }
    updateMotionDiagnostic(diagnosticId, {
      actualDurationMs: performance.now() - animationStartedAt,
      destinationCount: document.querySelectorAll(".library-pane").length,
      destinationRect: destination
        ? rectSnapshot(destination.getBoundingClientRect())
        : undefined,
    });
    finishMotionDiagnostic(diagnosticId, "finished");
  } catch (cause) {
    finishMotionDiagnostic(
      diagnosticId,
      "fallback",
      cause instanceof Error ? cause.message.slice(0, 160) : "router-error",
    );
  } finally {
    if (latestTransitionId === transitionId) {
      activePageAnimations = [];
      releaseActivePageStyles?.();
      releaseActivePageStyles = undefined;
      clearTransitionClasses();
    }
  }
}

export function transitionCodaView(
  update: CodaViewTransitionUpdate,
  kind: CodaViewTransitionKind,
  options: CodaViewTransitionOptions = {},
): Promise<void> {
  const transitionId = ++latestTransitionId;
  const motionProfile = snapshotMotionProfile();
  activeTransition?.transition.skipTransition?.();
  activeTransition = undefined;
  releaseActiveSourceSuppression?.();
  releaseActiveSourceSuppression = undefined;
  stopActivePageAnimations();
  clearTransitionClasses();

  if (options.skipSnapshot) {
    if (motionViewTransitionsEnabled()) {
      supersedeMotionViewTransition();
    }
    const diagnosticId = beginMotionDiagnostic({
      kind,
      configuredDurationMs: motionProfile.configuredDurationMs,
      speed: motionProfile.profile.speed,
      transitionClass: TRANSITION_CLASSES[kind],
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 0,
      destinationCount: 0,
      sharedExpected: false,
    });
    finishMotionDiagnostic(diagnosticId, "bypassed", "skip-snapshot");
    return Promise.resolve(update(false)).then(() => undefined);
  }

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nativePageTransition = isPageTransition(kind);
  if (
    nativePageTransition &&
    options.routerOwnedPage &&
    !prefersReducedMotion
  ) {
    return transitionRouterOwnedPage(update, kind, motionProfile, transitionId);
  }
  const transitionDocument = document as ViewTransitionDocument;
  if (!transitionDocument.startViewTransition || prefersReducedMotion) {
    if (motionViewTransitionsEnabled()) {
      supersedeMotionViewTransition();
    }
    const diagnosticId = beginMotionDiagnostic({
      kind,
      configuredDurationMs: motionProfile.configuredDurationMs,
      speed: motionProfile.profile.speed,
      transitionClass: TRANSITION_CLASSES[kind],
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 0,
      destinationCount: 0,
      sharedExpected: false,
    });
    finishMotionDiagnostic(
      diagnosticId,
      "bypassed",
      prefersReducedMotion ? "reduced-motion" : "native-unavailable",
    );
    return Promise.resolve(update(false)).then(() => undefined);
  }

  if (motionViewTransitionsEnabled() && !nativePageTransition) {
    document.documentElement.classList.add(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
    );
    return transitionCodaViewWithMotion(
      update,
      kind,
      motionProfile,
      TRANSITION_CLASSES[kind],
    ).finally(() => {
      if (latestTransitionId === transitionId) {
        document.documentElement.classList.remove("coda-view-transitioning");
      }
    });
  }

  const transitionClass =
    nativePageTransition && motionProfile.profile.page.mode === "crossfade"
      ? TRANSITION_CLASSES["page-crossfade"]
      : TRANSITION_CLASSES[kind];
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
        if (nativePageTransition) {
          const destination =
            document.querySelector<HTMLElement>(".library-pane");
          updateMotionDiagnostic(diagnosticId, {
            destinationCount: document.querySelectorAll(".library-pane").length,
            destinationRect: destination
              ? rectSnapshot(destination.getBoundingClientRect())
              : undefined,
          });
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
    finishMotionDiagnostic(diagnosticId, "fallback", "native-transition-error");
    if (!updated) {
      updated = true;
      update();
    }
  };
  if (nativePageTransition) {
    configureNativePageProfile(kind, motionProfile);
  }
  document.documentElement.classList.add(
    "coda-view-transitions-supported",
    "coda-view-transitioning",
    transitionClass,
  );
  const source = nativePageTransition
    ? document.querySelector<HTMLElement>(".library-pane")
    : null;
  const sourceCount = nativePageTransition
    ? document.querySelectorAll(".library-pane").length
    : 0;
  const transitionNames = nativePageTransition ? ["coda-page-content"] : [];
  const configuredDurationMs = nativePageTransition
    ? Math.max(
        motionProfile.profile.page.exit.durationMs,
        motionProfile.profile.page.enter.durationMs +
          motionProfile.profile.page.enterDelayMs,
      ) / motionProfile.profile.speed
    : motionProfile.configuredDurationMs;
  const diagnosticId = beginMotionDiagnostic({
    kind,
    configuredDurationMs,
    speed: motionProfile.profile.speed,
    transitionClass,
    transitionNames,
    transitionClasses: [
      transitionClass,
      nativePageTransition ? "coda-native-page" : "coda-native-fallback",
    ],
    sourceRect: source
      ? rectSnapshot(source.getBoundingClientRect())
      : undefined,
    sourceCount,
    destinationCount: 0,
    sharedExpected: false,
  });
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
      transition.finished.then(
        () => finishMotionDiagnostic(diagnosticId, "finished"),
        handleTransitionFailure,
      ),
      transition.ready?.then(() => {
        const pseudo = inspectMotionPseudoLayers(transitionNames);
        updateMotionDiagnostic(diagnosticId, {
          actualDurationMs: pseudo.actualDurationMs,
          pseudoLayers: pseudo.layers,
        });
      }, handleTransitionFailure),
      transition.updateCallbackDone?.then(undefined, handleTransitionFailure),
    ].filter((promise): promise is Promise<void> => Boolean(promise));
    return Promise.all(lifecycle)
      .then(() => undefined)
      .finally(() => {
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
