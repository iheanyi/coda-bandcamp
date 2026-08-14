import { flushSync } from "react-dom";
import { animate, type AnimationPlaybackControls } from "motion";
import {
  supersedeMotionViewTransition,
  transitionCodaViewWithMotion,
} from "./motionViewTransitions";
import {
  motionDiagnosticsActive,
  motionDiagnosticsRuntime,
} from "./motionDiagnosticsRuntime";
import type { MotionEase, ResolvedMotionProfile } from "./motionProfile";
import { snapshotMotionProfile } from "./motionProfileRuntime";

export type CodaViewTransitionKind =
  | "album-detail"
  | "album-detail-close"
  | "artist-detail"
  | "artist-detail-close"
  | "daily-detail"
  | "daily-detail-close"
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
  "daily-detail": "coda-transition--daily-detail",
  "daily-detail-close": "coda-transition--daily-detail-close",
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
const PAGE_TRANSITION_NAMES = ["coda-page-content"] as const;
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
let activePageAnimations: AnimationPlaybackControls[] = [];
let releaseActivePageStyles: (() => void) | undefined;

function stopActivePageAnimations() {
  for (const controls of activePageAnimations) controls.stop();
  activePageAnimations = [];
  releaseActivePageStyles?.();
  releaseActivePageStyles = undefined;
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
  const diagnostics = motionDiagnosticsActive()
    ? motionDiagnosticsRuntime
    : undefined;
  const source = diagnostics
    ? document.querySelector<HTMLElement>(".library-pane")
    : null;
  const diagnosticId = diagnostics?.begin({
    kind,
    configuredDurationMs:
      (motion.profile.page.enter.durationMs +
        motion.profile.page.enterDelayMs) /
      motion.profile.speed,
    speed: motion.profile.speed,
    transitionClass,
    transitionNames: [],
    transitionClasses: [transitionClass, "coda-live-page"],
    sourceRect: source
      ? diagnostics.rectSnapshot(source.getBoundingClientRect())
      : undefined,
    sourceCount: diagnostics
      ? document.querySelectorAll(".library-pane").length
      : 0,
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
    const animationStartedAt = diagnostics ? performance.now() : 0;
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
    if (diagnostics && diagnosticId !== undefined) {
      diagnostics.update(diagnosticId, {
        actualDurationMs: performance.now() - animationStartedAt,
        destinationCount: document.querySelectorAll(".library-pane").length,
        destinationRect: destination
          ? diagnostics.rectSnapshot(destination.getBoundingClientRect())
          : undefined,
      });
      diagnostics.finish(diagnosticId, "finished");
    }
  } catch (cause) {
    if (diagnostics && diagnosticId !== undefined) {
      diagnostics.finish(
        diagnosticId,
        "fallback",
        cause instanceof Error ? cause.message.slice(0, 160) : "router-error",
      );
    }
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
  const diagnostics = motionDiagnosticsActive()
    ? motionDiagnosticsRuntime
    : undefined;
  activeTransition?.transition.skipTransition?.();
  activeTransition = undefined;
  stopActivePageAnimations();
  clearTransitionClasses();

  if (options.skipSnapshot) {
    supersedeMotionViewTransition();
    const diagnosticId = diagnostics?.begin({
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
    if (diagnosticId !== undefined) {
      diagnostics?.finish(diagnosticId, "bypassed", "skip-snapshot");
    }
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
    supersedeMotionViewTransition();
    const diagnosticId = diagnostics?.begin({
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
    if (diagnosticId !== undefined) {
      diagnostics?.finish(
        diagnosticId,
        "bypassed",
        prefersReducedMotion ? "reduced-motion" : "native-unavailable",
      );
    }
    return Promise.resolve(update(false)).then(() => undefined);
  }

  if (!nativePageTransition) {
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
    motionProfile.profile.page.mode === "crossfade"
      ? TRANSITION_CLASSES["page-crossfade"]
      : TRANSITION_CLASSES[kind];
  let updated = false;
  let failed = false;
  const commitUpdate = (): void | Promise<void> => {
    if (latestTransitionId !== transitionId || updated || failed) {
      return;
    }
    updated = true;
    const result = flushSync(update);
    return Promise.resolve(result).then(() => {
      if (latestTransitionId !== transitionId || failed) return;
      const destination = document.querySelector<HTMLElement>(".library-pane");
      if (diagnostics && diagnosticId !== undefined) {
        diagnostics.update(diagnosticId, {
          destinationCount: document.querySelectorAll(".library-pane").length,
          destinationRect: destination
            ? diagnostics.rectSnapshot(destination.getBoundingClientRect())
            : undefined,
        });
      }
    });
  };
  const handleTransitionFailure = () => {
    if (latestTransitionId !== transitionId || failed) return;
    failed = true;
    activeTransition = undefined;
    clearTransitionClasses();
    clearTransitionSupport();
    if (diagnosticId !== undefined) {
      diagnostics?.finish(diagnosticId, "fallback", "native-transition-error");
    }
    if (!updated) {
      updated = true;
      update();
    }
  };
  configureNativePageProfile(kind, motionProfile);
  document.documentElement.classList.add(
    "coda-view-transitions-supported",
    "coda-view-transitioning",
    transitionClass,
  );
  const source = diagnostics
    ? document.querySelector<HTMLElement>(".library-pane")
    : null;
  const sourceCount = diagnostics
    ? document.querySelectorAll(".library-pane").length
    : 0;
  const transitionNames = PAGE_TRANSITION_NAMES;
  const diagnosticId = diagnostics?.begin({
    kind,
    configuredDurationMs:
      Math.max(
        motionProfile.profile.page.exit.durationMs,
        motionProfile.profile.page.enter.durationMs +
          motionProfile.profile.page.enterDelayMs,
      ) / motionProfile.profile.speed,
    speed: motionProfile.profile.speed,
    transitionClass,
    transitionNames,
    transitionClasses: [transitionClass, "coda-native-page"],
    sourceRect: source
      ? diagnostics.rectSnapshot(source.getBoundingClientRect())
      : undefined,
    sourceCount,
    destinationCount: 0,
    sharedExpected: false,
  });
  try {
    const transition = transitionDocument.startViewTransition.call(
      transitionDocument,
      commitUpdate,
    );
    if (latestTransitionId === transitionId) {
      activeTransition = { id: transitionId, transition };
    } else {
      transition.skipTransition?.();
    }
    const lifecycle = [
      transition.finished.then(() => {
        if (diagnosticId !== undefined) {
          diagnostics?.finish(diagnosticId, "finished");
        }
      }, handleTransitionFailure),
      transition.ready?.then(() => {
        if (diagnostics && diagnosticId !== undefined) {
          const pseudo = diagnostics.inspectPseudoLayers(transitionNames);
          diagnostics.update(diagnosticId, {
            actualDurationMs: pseudo.actualDurationMs,
            pseudoLayers: pseudo.layers,
          });
        }
      }, handleTransitionFailure),
      transition.updateCallbackDone?.then(undefined, handleTransitionFailure),
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
