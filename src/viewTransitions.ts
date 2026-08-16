import { flushSync } from "react-dom";
import {
  animate,
  type AnimationPlaybackControls,
  type Transition,
} from "motion";
import { acquireTemporaryStyleProperty } from "@/features/navigation/temporaryDomMarkers";
import { enforceDocumentViewTransitionCompositing } from "./compositorViewTransition";
import {
  beginMotionDiagnostic,
  endpointIssues,
  finishMotionDiagnostic,
  getMotionDiagnostic,
  inspectMotionPseudoLayers,
  rectSnapshot,
  updateMotionDiagnostic,
} from "./motionDiagnostics";
import type { ResolvedMotionProfile } from "./motionProfile";
import { snapshotMotionProfile } from "./motionProfileStore";

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

export type CodaViewTransitionUpdate = (
  routerViewTransition?: boolean,
) => void | Promise<void>;

export type ViewTransitionMotionDriver = Readonly<{
  animate: typeof animate;
}>;

const defaultMotionDriver: ViewTransitionMotionDriver = { animate };
let motionDriver = defaultMotionDriver;

export function installViewTransitionMotionDriver(
  driver: ViewTransitionMotionDriver,
): () => void {
  const previous = motionDriver;
  motionDriver = driver;
  return () => {
    if (motionDriver === driver) motionDriver = previous;
  };
}

const TRANSITION_CLASSES = {
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
} satisfies Record<CodaViewTransitionKind, string>;
const TRANSITION_CLASS_NAMES = Object.values(TRANSITION_CLASSES);
const NATIVE_DETAIL_DURATION_MS = 460;
const NATIVE_NOW_PLAYING_DURATION_MS = 440;
let latestTransitionId = 0;
let activeTransition:
  { id: number; transition: CodaViewTransition } | undefined;
let releaseActiveSourceSuppression: (() => void) | undefined;
let activePageAnimations: AnimationPlaybackControls[] = [];
let recordActivePageExit: (() => void) | undefined;
let cancelActivePageAnimationWait: (() => void) | undefined;
let releaseActivePageStyles: (() => void) | undefined;
let pendingPageEntrance:
  | {
      coordinatorStartedAt: number;
      diagnosticId: number;
      id: number;
      opacity?: number;
      resolve: () => void;
      sourceKey?: string;
      transform: string;
      transition: Transition;
    }
  | undefined;

function stopActivePageAnimations() {
  recordActivePageExit?.();
  recordActivePageExit = undefined;
  for (const controls of activePageAnimations) controls.stop();
  activePageAnimations = [];
  cancelActivePageAnimationWait?.();
  cancelActivePageAnimationWait = undefined;
  pendingPageEntrance?.resolve();
  pendingPageEntrance = undefined;
  releaseActivePageStyles?.();
  releaseActivePageStyles = undefined;
}

const SHARED_SOURCE_SELECTORS = {
  "album-detail": [".coda-album-artwork-source"],
  "album-detail-close": ["[data-coda-album-artwork-detail]"],
  "artist-detail": [
    "[data-coda-artist-artwork-source] [data-slot='cover']",
    "[data-coda-artist-artwork-source][data-slot='cover']",
  ],
  "artist-detail-close": [
    "[data-coda-artist-artwork-detail][data-slot='cover']",
    "[data-coda-artist-artwork-detail] [data-slot='cover']",
  ],
  "daily-detail": ["[data-coda-daily-artwork-source]"],
  "daily-detail-close": ["[data-coda-daily-artwork-detail]"],
  "discover-detail": ["[data-coda-discover-artwork-source]"],
  "discover-detail-close": ["[data-coda-discover-artwork-detail]"],
  "playlist-detail": ["[data-coda-playlist-identity-source]"],
  "playlist-detail-close": ["[data-coda-playlist-identity-detail]"],
  "radio-detail": ["[data-coda-radio-artwork-source]"],
  "radio-detail-close": ["[data-coda-radio-artwork-detail]"],
  "now-playing-open": [".player__art-link"],
  "now-playing-close": [".now-playing__artwork"],
} satisfies Partial<Record<CodaViewTransitionKind, readonly string[]>>;

const SHARED_DESTINATION_SELECTORS = {
  "album-detail": ["[data-coda-album-artwork-detail]"],
  "album-detail-close": ["[data-coda-album-artwork-return]"],
  "artist-detail": [
    "[data-coda-artist-artwork-detail][data-slot='cover']",
    "[data-coda-artist-artwork-detail] [data-slot='cover']",
  ],
  "artist-detail-close": ["[data-coda-artist-artwork-return]"],
  "daily-detail": ["[data-coda-daily-artwork-detail]"],
  "daily-detail-close": ["[data-coda-daily-artwork-return]"],
  "discover-detail": ["[data-coda-discover-artwork-detail]"],
  "discover-detail-close": ["[data-coda-discover-artwork-return]"],
  "playlist-detail": ["[data-coda-playlist-identity-detail]"],
  "playlist-detail-close": ["[data-coda-playlist-identity-return]"],
  "radio-detail": ["[data-coda-radio-artwork-detail]"],
  "radio-detail-close": ["[data-coda-radio-artwork-return]"],
  "now-playing-open": [".now-playing__artwork"],
  "now-playing-close": [".player__art-link"],
} satisfies Partial<Record<CodaViewTransitionKind, readonly string[]>>;

const DETAIL_TRANSITION_NAMES = {
  "album-detail": ["coda-album-artwork", "coda-detail-surface"],
  "album-detail-close": ["coda-album-artwork", "coda-detail-surface"],
  "artist-detail": ["coda-artist-artwork", "coda-detail-surface"],
  "artist-detail-close": ["coda-artist-artwork", "coda-detail-surface"],
  "daily-detail": ["coda-daily-artwork", "coda-detail-surface"],
  "daily-detail-close": ["coda-daily-artwork", "coda-detail-surface"],
  "discover-detail": ["coda-discover-artwork", "coda-detail-surface"],
  "discover-detail-close": ["coda-discover-artwork", "coda-detail-surface"],
  "playlist-detail": ["coda-playlist-identity", "coda-detail-surface"],
  "playlist-detail-close": ["coda-playlist-identity", "coda-detail-surface"],
  "radio-detail": ["coda-radio-artwork", "coda-detail-surface"],
  "radio-detail-close": ["coda-radio-artwork", "coda-detail-surface"],
  "now-playing-open": ["coda-now-playing-artwork", "coda-detail-surface"],
  "now-playing-close": ["coda-now-playing-artwork", "coda-detail-surface"],
} satisfies Partial<Record<CodaViewTransitionKind, readonly string[]>>;

function mappedTransitionValues<Value>(
  mapping: Partial<Record<CodaViewTransitionKind, readonly Value[]>>,
  kind: CodaViewTransitionKind,
): readonly Value[] {
  return mapping[kind] ?? [];
}

function sharedSourceCandidates(kind: CodaViewTransitionKind) {
  const elements = new Set<HTMLElement>();
  for (const selector of mappedTransitionValues(SHARED_SOURCE_SELECTORS, kind)) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      elements.add(element);
    });
  }
  return [...elements];
}

function sharedDestinationCandidates(kind: CodaViewTransitionKind) {
  const elements = new Set<HTMLElement>();
  for (const selector of mappedTransitionValues(
    SHARED_DESTINATION_SELECTORS,
    kind,
  )) {
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

type StartViewTransition = (
  update: () => void | Promise<void>,
) => CodaViewTransition;

function isStartViewTransition<Value>(
  value: Value,
): value is Value & StartViewTransition {
  return Object.prototype.toString.call(value) === "[object Function]";
}

function readStartViewTransition(
  owner: Document,
): StartViewTransition | undefined {
  if (!("startViewTransition" in owner)) return undefined;
  const candidate = owner.startViewTransition;
  if (!isStartViewTransition(candidate)) return undefined;
  return (update) => candidate.call(owner, update);
}

function isAnimationFrameRequester<Value>(
  value: Value,
): value is Value & ((callback: FrameRequestCallback) => number) {
  return Object.prototype.toString.call(value) === "[object Function]";
}

function isMediaQueryMatcher<Value>(
  value: Value,
): value is Value & ((query: string) => MediaQueryList) {
  return Object.prototype.toString.call(value) === "[object Function]";
}

function reducedMotionRequested(): boolean {
  const matchMedia = window.matchMedia;
  return (
    isMediaQueryMatcher(matchMedia) &&
    matchMedia.call(window, "(prefers-reduced-motion: reduce)").matches
  );
}

function isPageTransition(
  kind: CodaViewTransitionKind,
): kind is "page-forward" | "page-back" | "page-crossfade" {
  return kind.startsWith("page");
}

function configuredTransitionDurationMs(
  kind: CodaViewTransitionKind,
  motion: ResolvedMotionProfile,
) {
  if (isPageTransition(kind)) {
    return (
      (motion.profile.page.exit.durationMs +
        motion.profile.page.enter.durationMs +
        motion.profile.page.enterDelayMs) /
      motion.profile.speed
    );
  }
  return kind === "now-playing-open" || kind === "now-playing-close"
    ? NATIVE_NOW_PLAYING_DURATION_MS
    : NATIVE_DETAIL_DURATION_MS;
}

function motionDiagnosticsVisible() {
  return document.querySelector("[data-coda-motion-lab]") !== null;
}

function beginSharedSourceFeedback(source: HTMLElement | null) {
  const requestFrame = globalThis.requestAnimationFrame;
  if (!source || !isAnimationFrameRequester(requestFrame)) return undefined;
  let animation: Animation;
  try {
    animation = source.animate(
      [
        { opacity: 0.86, transform: "scale(0.975)" },
        { opacity: 0.94, transform: "scale(0.985)" },
      ],
      {
        duration: 120,
        easing: "cubic-bezier(0.2, 0.9, 0.2, 1)",
        fill: "both",
      },
    );
  } catch {
    return undefined;
  }
  let frame = 0;
  let timeout = 0;
  let resolvePainted = () => {};
  const painted = new Promise<void>((resolve) => {
    resolvePainted = resolve;
  });
  const readyToCapture = new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve();
    };
    timeout = window.setTimeout(settle, 32);
    frame = requestFrame.call(globalThis, () => {
      resolvePainted();
      settle();
    });
  });
  return {
    cancel: () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
      animation.cancel();
    },
    painted,
    readyToCapture,
  };
}

function preservePageInlineStyles(element: HTMLElement) {
  const properties = ["opacity", "transform", "will-change"] as const;
  const previous = properties.map((property) => ({
    property,
    priority: element.style.getPropertyPriority(property),
    value: element.style.getPropertyValue(property),
  }));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const { property, priority, value } of previous) {
      element.style.setProperty(property, value, priority);
    }
  };
}

function armPageEntrance(
  id: number,
  transform: string,
  transition: Transition,
  diagnosticId: number,
  coordinatorStartedAt: number,
  opacity?: number,
  sourceKey?: string,
) {
  return new Promise<void>((resolve) => {
    pendingPageEntrance = {
      coordinatorStartedAt,
      diagnosticId,
      id,
      opacity,
      resolve,
      sourceKey,
      transform,
      transition,
    };
  });
}

/**
 * AppShell calls this from a layout effect after a route commit. Applying the
 * first frame there prevents the destination from painting in its settled
 * position before Motion starts.
 */
export function consumePendingPageEntrance(
  destination: HTMLElement,
  destinationKey = destination.dataset.codaTransitionKey,
) {
  const entrance = pendingPageEntrance;
  if (!entrance) return false;
  if (entrance.id !== latestTransitionId) {
    pendingPageEntrance = undefined;
    entrance.resolve();
    return false;
  }
  if (
    entrance.sourceKey !== undefined &&
    (destinationKey === undefined || destinationKey === entrance.sourceKey)
  ) {
    return false;
  }
  pendingPageEntrance = undefined;

  recordActivePageExit?.();
  recordActivePageExit = undefined;
  for (const controls of activePageAnimations) controls.stop();
  activePageAnimations = [];
  const entranceStartedAt = performance.now();
  updateMotionDiagnostic(entrance.diagnosticId, {
    phaseTimings: {
      entranceStartMs: entranceStartedAt - entrance.coordinatorStartedAt,
    },
  });
  releaseActivePageStyles?.();
  releaseActivePageStyles = preservePageInlineStyles(destination);
  destination.style.setProperty("transform", entrance.transform);
  destination.style.setProperty(
    "will-change",
    entrance.opacity === undefined ? "transform" : "opacity",
  );
  if (entrance.opacity !== undefined) {
    destination.style.setProperty("opacity", String(entrance.opacity));
  }
  const keyframes =
    entrance.opacity === undefined
      ? {
          transform: [entrance.transform, "translateX(0px) scale(1)"],
        }
      : {
          opacity: [entrance.opacity, 1],
          transform: [entrance.transform, "translateX(0px) scale(1)"],
        };
  let controls: AnimationPlaybackControls;
  try {
    controls = motionDriver.animate(destination, keyframes, entrance.transition);
  } catch {
    entrance.resolve();
    return false;
  }
  let settled = false;
  const settleEntrance = () => {
    if (settled) return;
    settled = true;
    updateMotionDiagnostic(entrance.diagnosticId, {
      phaseTimings: {
        entranceMs: performance.now() - entranceStartedAt,
      },
    });
    entrance.resolve();
  };
  activePageAnimations = [controls];
  cancelActivePageAnimationWait = settleEntrance;
  void controls.finished.then(settleEntrance, settleEntrance);
  return true;
}

async function transitionRouterOwnedPage(
  update: CodaViewTransitionUpdate,
  kind: "page-forward" | "page-back" | "page-crossfade",
  motion: ResolvedMotionProfile,
  transitionId: number,
) {
  // Snapshotting this scroll surface makes WebKit rasterize the virtualized
  // Collection. Animate the persistent pane on both sides of the atomic React
  // commit instead, with the entrance armed by AppShell before paint.
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
  const sourceKey = source?.dataset.codaTransitionKey;
  const diagnosticsVisible = motionDiagnosticsVisible();
  const configuredDurationMs = configuredTransitionDurationMs(kind, motion);
  const coordinatorStartedAt = performance.now();
  const diagnosticId = beginMotionDiagnostic({
    kind,
    configuredDurationMs,
    speed: motion.profile.speed,
    transitionClass,
    transitionNames: [],
    transitionClasses: [transitionClass, "coda-live-page"],
    sourceRect:
      diagnosticsVisible && source
        ? rectSnapshot(source.getBoundingClientRect())
        : undefined,
    sourceCount: document.querySelectorAll(".library-pane").length,
    destinationCount: 0,
    sharedExpected: false,
  });
  const direction = kind === "page-back" ? -1 : 1;
  const slide =
    kind !== "page-crossfade" && motion.profile.page.mode === "slide";
  const oldTransform = slide
    ? `translateX(${-direction * motion.profile.page.translationPx * 0.6}px) scale(${motion.profile.page.scaleFrom})`
    : "translateX(0px) scale(1)";
  const newTransform = slide
    ? `translateX(${direction * motion.profile.page.translationPx}px) scale(${motion.profile.page.scaleFrom})`
    : "translateX(0px) scale(1)";
  const crossfadeOpacity = slide ? undefined : 0.94;
  let sourcePaintFrame: number | undefined;

  try {
    const exitStartedAt = performance.now();
    if (source) {
      releaseActivePageStyles = preservePageInlineStyles(source);
      source.style.setProperty("will-change", slide ? "transform" : "opacity");
      try {
        const exit = motionDriver.animate(
          source,
          slide
            ? {
                transform: ["translateX(0px) scale(1)", oldTransform],
              }
            : { opacity: [1, crossfadeOpacity] },
          motion.viewExit,
        );
        activePageAnimations = [exit];
        updateMotionDiagnostic(diagnosticId, {
          phaseTimings: {
            sourceFeedbackMs: performance.now() - coordinatorStartedAt,
          },
        });
        const requestFrame = globalThis.requestAnimationFrame;
        if (isAnimationFrameRequester(requestFrame)) {
          sourcePaintFrame = requestFrame.call(globalThis, () => {
            updateMotionDiagnostic(diagnosticId, {
              phaseTimings: {
                sourceFeedbackPaintMs:
                  performance.now() - coordinatorStartedAt,
              },
            });
          });
        }
        let exitRecorded = false;
        const recordExit = () => {
          if (exitRecorded) return;
          exitRecorded = true;
          if (recordActivePageExit === recordExit) {
            recordActivePageExit = undefined;
          }
          updateMotionDiagnostic(diagnosticId, {
            phaseTimings: {
              exitMs: performance.now() - exitStartedAt,
            },
          });
        };
        recordActivePageExit = recordExit;
        void exit.finished.then(recordExit, recordExit);
      } catch {
        releaseActivePageStyles?.();
        releaseActivePageStyles = undefined;
      }
      if (transitionId !== latestTransitionId) return;
    }
    const updateStartedAt = performance.now();
    updateMotionDiagnostic(diagnosticId, {
      phaseTimings: source
        ? { updateStartMs: updateStartedAt - coordinatorStartedAt }
        : {
            exitMs: updateStartedAt - exitStartedAt,
            updateStartMs: updateStartedAt - coordinatorStartedAt,
          },
    });

    const entranceFinished = source
      ? armPageEntrance(
          transitionId,
          newTransform,
          motion.viewEnter,
          diagnosticId,
          coordinatorStartedAt,
          crossfadeOpacity,
          sourceKey,
        )
      : Promise.resolve();
    try {
      await update(false);
    } finally {
      updateMotionDiagnostic(diagnosticId, {
        phaseTimings: {
          updateMs: performance.now() - updateStartedAt,
        },
      });
    }
    if (transitionId !== latestTransitionId) return;
    const destination = document.querySelector<HTMLElement>(".library-pane");
    if (pendingPageEntrance?.id === transitionId) {
      pendingPageEntrance.resolve();
      pendingPageEntrance = undefined;
    }
    await entranceFinished;
    recordActivePageExit?.();
    recordActivePageExit = undefined;
    updateMotionDiagnostic(diagnosticId, {
      actualDurationMs: performance.now() - coordinatorStartedAt,
      destinationCount: document.querySelectorAll(".library-pane").length,
      destinationRect:
        diagnosticsVisible && destination
          ? rectSnapshot(destination.getBoundingClientRect())
          : undefined,
    });
    finishMotionDiagnostic(diagnosticId, "finished");
  } catch (cause) {
    recordActivePageExit?.();
    recordActivePageExit = undefined;
    finishMotionDiagnostic(
      diagnosticId,
      "fallback",
      cause instanceof Error ? cause.message.slice(0, 160) : "router-error",
    );
    throw cause;
  } finally {
    if (sourcePaintFrame !== undefined) {
      cancelAnimationFrame(sourcePaintFrame);
    }
    if (latestTransitionId === transitionId) {
      pendingPageEntrance?.resolve();
      pendingPageEntrance = undefined;
      activePageAnimations = [];
      cancelActivePageAnimationWait = undefined;
      releaseActivePageStyles?.();
      releaseActivePageStyles = undefined;
      clearTransitionClasses();
    }
  }
}

export function transitionCodaView(
  update: CodaViewTransitionUpdate,
  kind: CodaViewTransitionKind,
): Promise<void> {
  const transitionId = ++latestTransitionId;
  const motionProfile = snapshotMotionProfile();
  activeTransition?.transition.skipTransition?.();
  activeTransition = undefined;
  releaseActiveSourceSuppression?.();
  releaseActiveSourceSuppression = undefined;
  stopActivePageAnimations();
  clearTransitionClasses();

  const prefersReducedMotion = reducedMotionRequested();
  const pageTransition = isPageTransition(kind);
  if (pageTransition && !prefersReducedMotion) {
    return transitionRouterOwnedPage(update, kind, motionProfile, transitionId);
  }
  const startViewTransition = readStartViewTransition(document);
  if (!startViewTransition || prefersReducedMotion) {
    const coordinatorStartedAt = performance.now();
    const diagnosticId = beginMotionDiagnostic({
      kind,
      configuredDurationMs: configuredTransitionDurationMs(kind, motionProfile),
      speed: pageTransition ? motionProfile.profile.speed : 1,
      transitionClass: TRANSITION_CLASSES[kind],
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 0,
      destinationCount: 0,
      sharedExpected: false,
    });
    const updateStartedAt = performance.now();
    updateMotionDiagnostic(diagnosticId, {
      phaseTimings: {
        updateStartMs: updateStartedAt - coordinatorStartedAt,
      },
    });
    let updateResult: void | Promise<void>;
    try {
      updateResult = update(false);
    } catch (cause) {
      updateMotionDiagnostic(diagnosticId, {
        phaseTimings: {
          updateMs: performance.now() - updateStartedAt,
        },
      });
      finishMotionDiagnostic(
        diagnosticId,
        "fallback",
        cause instanceof Error ? cause.message.slice(0, 160) : "router-error",
      );
      return Promise.reject(cause);
    }
    return Promise.resolve(updateResult).then(
      () => {
        const updateFinishedAt = performance.now();
        updateMotionDiagnostic(diagnosticId, {
          phaseTimings: {
            readyMs: updateFinishedAt - coordinatorStartedAt,
            updateMs: updateFinishedAt - updateStartedAt,
          },
        });
        finishMotionDiagnostic(
          diagnosticId,
          "bypassed",
          prefersReducedMotion ? "reduced-motion" : "native-unavailable",
        );
      },
      (cause) => {
        updateMotionDiagnostic(diagnosticId, {
          phaseTimings: {
            updateMs: performance.now() - updateStartedAt,
          },
        });
        finishMotionDiagnostic(
          diagnosticId,
          "fallback",
          cause instanceof Error ? cause.message.slice(0, 160) : "router-error",
        );
        throw cause;
      },
    );
  }

  const transitionClass = TRANSITION_CLASSES[kind];
  const coordinatorStartedAt = performance.now();
  const noUpdateFailure = Symbol("no-update-failure");
  let updated = false;
  let failed = false;
  let lifecycleActive = true;
  let updateFailure: unknown = noUpdateFailure;
  let recovery: Promise<void> | undefined;
  let bypassReason: string | undefined;
  let releaseSourceSuppression: (() => void) | undefined;
  const sourceCandidates = sharedSourceCandidates(kind);
  let destinationCount = 0;
  const commitUpdate = (snapshot: boolean): void | Promise<void> => {
    if (latestTransitionId !== transitionId || updated) {
      return;
    }
    updated = true;
    const updateStartedAt = performance.now();
    updateMotionDiagnostic(diagnosticId, {
      phaseTimings: {
        updateStartMs: updateStartedAt - coordinatorStartedAt,
      },
    });
    let result: void | Promise<void>;
    try {
      result = snapshot ? flushSync(update) : update(false);
    } catch (cause) {
      updateMotionDiagnostic(diagnosticId, {
        phaseTimings: {
          updateMs: performance.now() - updateStartedAt,
        },
      });
      updateFailure = cause;
      throw cause;
    }
    return Promise.resolve(result).then(
      () => {
        updateMotionDiagnostic(diagnosticId, {
          phaseTimings: {
            updateMs: performance.now() - updateStartedAt,
          },
        });
        if (!snapshot) return;
        if (latestTransitionId !== transitionId || failed || !lifecycleActive) {
          return;
        }
        const destinationCandidates = sharedDestinationCandidates(kind);
        const destination = destinationCandidates[0] ?? null;
        destinationCount = destinationCandidates.length;
        updateMotionDiagnostic(diagnosticId, {
          destinationCount,
          destinationRect:
            diagnosticsVisible && destination
              ? rectSnapshot(destination.getBoundingClientRect())
              : undefined,
          ...endpointIssues(sourceCount, destinationCount),
        });
        releaseSourceSuppression = suppressSourcesThatSurvive(sourceCandidates);
        if (latestTransitionId === transitionId) {
          releaseActiveSourceSuppression = releaseSourceSuppression;
        }
      },
      (cause) => {
        updateMotionDiagnostic(diagnosticId, {
          phaseTimings: {
            updateMs: performance.now() - updateStartedAt,
          },
        });
        updateFailure = cause;
        throw cause;
      },
    );
  };
  const handleTransitionFailure = (cause?: unknown): Promise<void> => {
    if (latestTransitionId !== transitionId) return Promise.resolve();
    if (recovery) return recovery;
    failed = true;
    activeTransition = undefined;
    releaseSourceSuppression?.();
    if (releaseActiveSourceSuppression === releaseSourceSuppression) {
      releaseActiveSourceSuppression = undefined;
    }
    clearTransitionClasses();
    clearTransitionSupport();
    finishMotionDiagnostic(
      diagnosticId,
      "fallback",
      cause instanceof Error
        ? cause.message.slice(0, 160)
        : "native-transition-error",
    );
    if (!updated) {
      try {
        recovery = Promise.resolve(commitUpdate(false)).then(() => undefined);
      } catch (fallbackCause) {
        recovery = Promise.reject(fallbackCause);
      }
    } else if (updateFailure !== noUpdateFailure) {
      recovery = Promise.reject(updateFailure);
    } else {
      recovery = Promise.resolve();
    }
    return recovery;
  };
  const source = sourceCandidates[0] ?? null;
  const sourceCount = sourceCandidates.length;
  const transitionNames = [
    ...mappedTransitionValues(DETAIL_TRANSITION_NAMES, kind),
  ];
  const diagnosticsVisible = motionDiagnosticsVisible();
  const diagnosticId = beginMotionDiagnostic({
    kind,
    configuredDurationMs: configuredTransitionDurationMs(kind, motionProfile),
    speed: 1,
    transitionClass,
    transitionNames,
    transitionClasses: [transitionClass, "coda-native-detail"],
    sourceRect:
      diagnosticsVisible && source
        ? rectSnapshot(source.getBoundingClientRect())
        : undefined,
    sourceCount,
    destinationCount: 0,
    sharedExpected: sourceCount > 0,
  });
  const finalize = () => {
    if (latestTransitionId !== transitionId) return;
    lifecycleActive = false;
    activeTransition = undefined;
    releaseSourceSuppression?.();
    if (releaseActiveSourceSuppression === releaseSourceSuppression) {
      releaseActiveSourceSuppression = undefined;
    }
    clearTransitionClasses();
  };
  const startNativeTransition = (): Promise<void> => {
    if (latestTransitionId !== transitionId) return Promise.resolve();
    document.documentElement.classList.add(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
      transitionClass,
    );
    try {
      const transition = startViewTransition(() => commitUpdate(true));
      if (latestTransitionId === transitionId) {
        activeTransition = { id: transitionId, transition };
      } else {
        transition.skipTransition?.();
      }
      const lifecycle = [
        transition.finished.catch(handleTransitionFailure),
        transition.ready?.then(() => {
          if (failed) return;
          const readyAt = performance.now();
          const compositing =
            enforceDocumentViewTransitionCompositing(transitionNames);
          if (!compositing.safe) {
            bypassReason = "unsafe-compositor";
            transition.skipTransition?.();
          }
          updateMotionDiagnostic(diagnosticId, {
            phaseTimings: {
              compositorMs: performance.now() - readyAt,
              readyMs: readyAt - coordinatorStartedAt,
            },
            sharedPaired:
              sourceCount === 1 && destinationCount === 1 && compositing.safe,
          });
          try {
            const pseudo = inspectMotionPseudoLayers(transitionNames);
            updateMotionDiagnostic(diagnosticId, {
              actualDurationMs: pseudo.actualDurationMs,
              pseudoLayers: pseudo.layers,
            });
          } catch {
            // Development diagnostics must never reject committed navigation.
          }
        }, handleTransitionFailure),
        transition.updateCallbackDone?.catch(handleTransitionFailure),
      ].filter((promise): promise is Promise<void> => Boolean(promise));
      return Promise.all(lifecycle)
        .then(() => {
          if (!failed) {
            finishMotionDiagnostic(
              diagnosticId,
              bypassReason ? "bypassed" : "finished",
              bypassReason,
            );
          }
        })
        .finally(finalize);
    } catch (cause) {
      if (latestTransitionId === transitionId) {
        return handleTransitionFailure(cause).finally(finalize);
      }
      finalize();
      return Promise.resolve();
    }
  };
  const activation = getMotionDiagnostic();
  const sourceFeedback =
    activation?.id === diagnosticId && activation.inputType
      ? beginSharedSourceFeedback(source)
      : undefined;
  if (!sourceFeedback) return startNativeTransition();
  updateMotionDiagnostic(diagnosticId, {
    phaseTimings: {
      sourceFeedbackMs: performance.now() - coordinatorStartedAt,
    },
  });
  void sourceFeedback.painted.then(() => {
    updateMotionDiagnostic(diagnosticId, {
      phaseTimings: {
        sourceFeedbackPaintMs: performance.now() - coordinatorStartedAt,
      },
    });
  });
  return sourceFeedback.readyToCapture
    .then(startNativeTransition)
    .finally(sourceFeedback.cancel);
}
