import {
  animate,
  type AnimationPlaybackControls,
  type Transition,
} from "motion";
import {
  applyDomEdits,
  type DomStyleEdit,
} from "@/features/navigation/domSnapshot";
import { enforceDocumentViewTransitionCompositing } from "./compositorViewTransition";
import {
  CODA_VIEW_TRANSITION_CLASSES,
  codaViewTransitionClass,
  resolveDetailTransition,
  type CodaViewTransitionKind,
  type PageViewTransitionKind,
} from "./detailTransitionDescriptors";
import {
  beginMotionDiagnostic,
  endpointIssues,
  finishMotionDiagnostic,
  inspectMotionPseudoLayers,
  rectSnapshot,
  updateMotionDiagnostic,
} from "./motionDiagnostics";
import type { ResolvedMotionProfile } from "./motionProfile";
import { snapshotMotionProfile } from "./motionProfileStore";

export type { CodaViewTransitionKind } from "./detailTransitionDescriptors";

type CodaViewTransition = {
  finished: Promise<void>;
  ready?: Promise<void>;
  skipTransition?: () => void;
  updateCallbackDone?: Promise<void>;
};

export type TransitionToken = Readonly<{
  id: number;
  isCurrent: () => boolean;
  settled: Promise<void>;
}>;

export type CodaViewTransitionUpdate = (
  token: TransitionToken,
) => void | Promise<void>;

const NATIVE_DETAIL_DURATION_MS = 460;
const NATIVE_NOW_PLAYING_DURATION_MS = 440;
let latestTransitionId = 0;

export function isCurrentTransition(id: number): boolean {
  return latestTransitionId === id;
}

export function currentTransitionId(): number {
  return latestTransitionId;
}

function createTransitionToken(
  id: number,
  settled: Promise<void>,
): TransitionToken {
  return {
    id,
    isCurrent: () => isCurrentTransition(id),
    settled,
  };
}

function capturedUpdateFailure(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  return new Error("Route update rejected", { cause });
}

function transitionFailureReason(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message.slice(0, 160) : fallback;
}

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

function sharedSourceCandidates(kind: CodaViewTransitionKind) {
  const elements = new Set<HTMLElement>();
  const selectors = resolveDetailTransition(kind)?.sourceSelectors ?? [];
  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      elements.add(element);
    });
  }
  return [...elements];
}

function sharedDestinationCandidates(kind: CodaViewTransitionKind) {
  const elements = new Set<HTMLElement>();
  const selectors = resolveDetailTransition(kind)?.destinationSelectors ?? [];
  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      elements.add(element);
    });
  }
  return [...elements];
}

function suppressSourcesThatSurvive(
  candidates: readonly HTMLElement[],
): () => void {
  const edits: DomStyleEdit[] = candidates
    .filter((element) => element.isConnected)
    .map((element) => ({
      element,
      kind: "style" as const,
      name: "view-transition-name",
      priority: "important",
      value: "none",
    }));
  return applyDomEdits(edits);
}

function clearTransitionClasses() {
  document.documentElement.classList.remove(
    "coda-view-transitioning",
    ...CODA_VIEW_TRANSITION_CLASSES,
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
  return value instanceof Function;
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
  return value instanceof Function;
}

function isAnimationFrameCanceller(
  value: typeof globalThis.cancelAnimationFrame | undefined,
): value is (handle: number) => void {
  return value instanceof Function;
}

function cancelScheduledFrame(handle: number | undefined): void {
  if (handle === undefined) return;
  const cancelFrame = globalThis.cancelAnimationFrame;
  if (isAnimationFrameCanceller(cancelFrame)) {
    cancelFrame.call(globalThis, handle);
  }
}

function isMediaQueryMatcher<Value>(
  value: Value,
): value is Value & ((query: string) => MediaQueryList) {
  return value instanceof Function;
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
): kind is PageViewTransitionKind {
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
      cancelScheduledFrame(frame);
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
  if (!isCurrentTransition(entrance.id)) {
    pendingPageEntrance = undefined;
    entrance.resolve();
    return false;
  }
  if (
    entrance.sourceKey !== undefined &&
    (destinationKey === undefined || destinationKey === entrance.sourceKey)
  ) {
    if (destinationKey === entrance.sourceKey) {
      for (const controls of activePageAnimations) controls.stop();
      activePageAnimations = [];
      releaseActivePageStyles?.();
      releaseActivePageStyles = undefined;
    }
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
    controls = animate(
      destination,
      keyframes,
      entrance.transition,
    );
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
  commitUpdate: () => Promise<void>,
  kind: PageViewTransitionKind,
  motion: ResolvedMotionProfile,
  token: TransitionToken,
) {
  // Snapshotting this scroll surface makes WebKit rasterize the virtualized
  // Collection. Animate the persistent pane on both sides of the atomic React
  // commit instead, with the entrance armed by AppShell before paint.
  stopActivePageAnimations();
  const transitionClass =
    motion.profile.page.mode === "crossfade"
      ? codaViewTransitionClass("page-crossfade")
      : codaViewTransitionClass(kind);
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
        const exit = animate(
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
                sourceFeedbackPaintMs: performance.now() - coordinatorStartedAt,
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
      if (!token.isCurrent()) return;
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
          token.id,
          newTransform,
          motion.viewEnter,
          diagnosticId,
          coordinatorStartedAt,
          crossfadeOpacity,
          sourceKey,
        )
      : Promise.resolve();
    try {
      await commitUpdate();
    } finally {
      updateMotionDiagnostic(diagnosticId, {
        phaseTimings: {
          updateMs: performance.now() - updateStartedAt,
        },
      });
    }
    if (!token.isCurrent()) return;
    const destination = document.querySelector<HTMLElement>(".library-pane");
    if (pendingPageEntrance?.id === token.id) {
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
      transitionFailureReason(cause, "router-error"),
    );
    throw cause;
  } finally {
    if (sourcePaintFrame !== undefined) {
      cancelScheduledFrame(sourcePaintFrame);
    }
    if (token.isCurrent()) {
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

async function transitionImmediateUpdate(
  commitUpdate: () => Promise<void>,
  kind: CodaViewTransitionKind,
  motion: ResolvedMotionProfile,
  prefersReducedMotion: boolean,
  pageTransition: boolean,
) {
  const coordinatorStartedAt = performance.now();
  const diagnosticId = beginMotionDiagnostic({
    kind,
    configuredDurationMs: configuredTransitionDurationMs(kind, motion),
    speed: pageTransition ? motion.profile.speed : 1,
    transitionClass: codaViewTransitionClass(kind),
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
  try {
    await commitUpdate();
  } catch (cause) {
    updateMotionDiagnostic(diagnosticId, {
      phaseTimings: {
        updateMs: performance.now() - updateStartedAt,
      },
    });
    finishMotionDiagnostic(
      diagnosticId,
      "fallback",
      transitionFailureReason(cause, "router-error"),
    );
    throw cause;
  }
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
}

export function transitionCodaView(
  update: CodaViewTransitionUpdate,
  kind: CodaViewTransitionKind,
  userInitiated = false,
): Promise<void> {
  const transitionId = ++latestTransitionId;
  let settleToken = () => {};
  const settled = new Promise<void>((resolve) => {
    settleToken = resolve;
  });
  const token = createTransitionToken(transitionId, settled);
  const motionProfile = snapshotMotionProfile();
  activeTransition?.transition.skipTransition?.();
  activeTransition = undefined;
  releaseActiveSourceSuppression?.();
  releaseActiveSourceSuppression = undefined;
  stopActivePageAnimations();
  clearTransitionClasses();

  let committed = false;
  const commitUpdate = async () => {
    if (committed || !token.isCurrent()) return;
    committed = true;
    await update(token);
  };

  const prefersReducedMotion = reducedMotionRequested();
  const pageTransition = isPageTransition(kind);
  if (pageTransition && !prefersReducedMotion) {
    return transitionRouterOwnedPage(
      commitUpdate,
      kind,
      motionProfile,
      token,
    ).finally(settleToken);
  }
  const startViewTransition = readStartViewTransition(document);
  if (!startViewTransition || prefersReducedMotion) {
    return transitionImmediateUpdate(
      commitUpdate,
      kind,
      motionProfile,
      prefersReducedMotion,
      pageTransition,
    ).finally(settleToken);
  }

  const transitionClass = codaViewTransitionClass(kind);
  const coordinatorStartedAt = performance.now();
  let failed = false;
  let lifecycleActive = true;
  let updateFailure: Error | undefined;
  let recovery: Promise<void> | undefined;
  let bypassReason: string | undefined;
  let releaseSourceSuppression: (() => void) | undefined;
  const sourceCandidates = sharedSourceCandidates(kind);
  let destinationCount = 0;
  const captureNativeDestinations = () => {
    if (!token.isCurrent() || failed || !lifecycleActive) return;
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
    if (token.isCurrent()) {
      releaseActiveSourceSuppression = releaseSourceSuppression;
    }
  };
  const commitNative = (snapshot: boolean): void | Promise<void> => {
    if (committed || !token.isCurrent()) return;
    const updateStartedAt = performance.now();
    updateMotionDiagnostic(diagnosticId, {
      phaseTimings: {
        updateStartMs: updateStartedAt - coordinatorStartedAt,
      },
    });
    let result: void | Promise<void> | undefined;
    try {
      result = commitUpdate();
    } catch (cause) {
      updateMotionDiagnostic(diagnosticId, {
        phaseTimings: {
          updateMs: performance.now() - updateStartedAt,
        },
      });
      updateFailure = capturedUpdateFailure(cause);
      throw updateFailure;
    }
    return Promise.resolve(result).then(
      () => {
        updateMotionDiagnostic(diagnosticId, {
          phaseTimings: {
            updateMs: performance.now() - updateStartedAt,
          },
        });
        if (snapshot) captureNativeDestinations();
      },
      (cause) => {
        updateMotionDiagnostic(diagnosticId, {
          phaseTimings: {
            updateMs: performance.now() - updateStartedAt,
          },
        });
        updateFailure = capturedUpdateFailure(cause);
        throw updateFailure;
      },
    );
  };
  const handleTransitionFailure = (cause?: unknown): Promise<void> => {
    if (!token.isCurrent()) return Promise.resolve();
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
      transitionFailureReason(cause, "native-transition-error"),
    );
    if (!committed) {
      recovery = Promise.resolve(commitNative(false)).then(() => undefined);
    } else if (updateFailure) {
      recovery = Promise.reject(updateFailure);
    } else {
      recovery = Promise.resolve();
    }
    return recovery;
  };
  const source = sourceCandidates[0] ?? null;
  const sourceCount = sourceCandidates.length;
  const transitionNames = [
    ...(resolveDetailTransition(kind)?.transitionNames ?? []),
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
    if (!token.isCurrent()) return;
    lifecycleActive = false;
    activeTransition = undefined;
    releaseSourceSuppression?.();
    if (releaseActiveSourceSuppression === releaseSourceSuppression) {
      releaseActiveSourceSuppression = undefined;
    }
    clearTransitionClasses();
  };
  const startNativeTransition = (): Promise<void> => {
    if (!token.isCurrent()) return Promise.resolve();
    document.documentElement.classList.add(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
      transitionClass,
    );
    try {
      const transition = startViewTransition(() => commitNative(true));
      if (token.isCurrent()) {
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
      if (token.isCurrent()) {
        return handleTransitionFailure(cause).finally(finalize);
      }
      finalize();
      return Promise.resolve();
    }
  };
  const sourceFeedback = userInitiated
    ? beginSharedSourceFeedback(source)
    : undefined;
  if (!sourceFeedback) return startNativeTransition().finally(settleToken);
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
    .finally(sourceFeedback.cancel)
    .finally(settleToken);
}
