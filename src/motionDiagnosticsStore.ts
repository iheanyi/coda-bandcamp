import type { CodaViewTransitionKind } from "./viewTransitions";

export type MotionRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type MotionPseudoLayers = Readonly<{
  group: readonly string[];
  old: readonly string[];
  new: readonly string[];
}>;

export type MotionInputType = "pointer" | "keyboard";

export type MotionPhaseTimings = Readonly<{
  exitMs?: number;
  updateStartMs?: number;
  updateMs?: number;
  routerNavigationMs?: number;
  routerRenderMs?: number;
  routerReleaseMs?: number;
  reactRenderMs?: number;
  reactBaseRenderMs?: number;
  reactChromeRenderMs?: number;
  reactOutletRenderMs?: number;
  sourceFeedbackMs?: number;
  sourceFeedbackPaintMs?: number;
  readyMs?: number;
  compositorMs?: number;
  entranceStartMs?: number;
  entranceMs?: number;
  finishedMs?: number;
}>;

export type MotionTransitionDiagnostic = Readonly<{
  id: number;
  kind: CodaViewTransitionKind;
  status: "active" | "finished" | "bypassed" | "fallback" | "superseded";
  reason?: string;
  startedAt: number;
  configuredDurationMs: number;
  actualDurationMs?: number;
  elapsedMs?: number;
  inputType?: MotionInputType;
  inputToCoordinatorMs?: number;
  firstVisualMs?: number;
  totalFromInputMs?: number;
  phaseTimings: MotionPhaseTimings;
  speed: number;
  transitionClass: string;
  transitionNames: readonly string[];
  transitionClasses: readonly string[];
  sourceRect?: MotionRect;
  destinationRect?: MotionRect;
  sourceCount: number;
  destinationCount: number;
  imageInsertionMs?: number;
  imageDecodeMs?: number;
  pseudoLayers: MotionPseudoLayers;
  sharedExpected: boolean;
  sharedPaired?: boolean;
  missingEndpoints: readonly string[];
  duplicateEndpoints: readonly string[];
}>;

export type MotionDiagnosticInput = Omit<
  MotionTransitionDiagnostic,
  | "id"
  | "status"
  | "startedAt"
  | "inputType"
  | "inputToCoordinatorMs"
  | "firstVisualMs"
  | "totalFromInputMs"
  | "phaseTimings"
  | "pseudoLayers"
  | "missingEndpoints"
  | "duplicateEndpoints"
>;

export type MotionDiagnosticsStore = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getCurrent: () => MotionTransitionDiagnostic | null;
  getHistory: () => readonly MotionTransitionDiagnostic[];
  begin: (input: MotionDiagnosticInput) => number;
  update: (
    id: number,
    update: Partial<MotionTransitionDiagnostic>,
  ) => void;
  recordActiveRender: (
    profilerId: string,
    actualDurationMs: number,
    baseDurationMs: number,
  ) => void;
  finish: (
    id: number,
    status: MotionTransitionDiagnostic["status"],
    reason?: string,
  ) => void;
  recordInput: (type: MotionInputType, at?: number) => void;
  installInputDiagnostics: (eventTarget?: Document) => () => void;
}>;

type MotionDiagnosticsStoreOptions = Readonly<{
  now?: () => number;
  onCompleted?: (diagnostic: MotionTransitionDiagnostic) => void;
}>;

const EMPTY_LAYERS: MotionPseudoLayers = Object.freeze({
  group: Object.freeze([]),
  old: Object.freeze([]),
  new: Object.freeze([]),
});
const MAX_INPUT_AGE_MS = 1_000;
const MAX_HISTORY_ENTRIES = 20;

function completeDiagnostic(
  diagnostic: MotionTransitionDiagnostic,
  status: MotionTransitionDiagnostic["status"],
  finishedAt: number,
  reason?: string,
): MotionTransitionDiagnostic {
  const elapsedMs = finishedAt - diagnostic.startedAt;
  const firstVisualCandidates = [
    diagnostic.phaseTimings.sourceFeedbackPaintMs,
    diagnostic.phaseTimings.readyMs,
    diagnostic.phaseTimings.entranceStartMs,
  ].filter((value): value is number => value !== undefined);
  const firstVisualAfterCoordinatorMs = firstVisualCandidates.length
    ? Math.min(...firstVisualCandidates)
    : 0;
  const completed: MotionTransitionDiagnostic = {
    ...diagnostic,
    status,
    elapsedMs,
    firstVisualMs:
      (diagnostic.inputToCoordinatorMs ?? 0) + firstVisualAfterCoordinatorMs,
    totalFromInputMs: (diagnostic.inputToCoordinatorMs ?? 0) + elapsedMs,
    phaseTimings: {
      ...diagnostic.phaseTimings,
      finishedMs: elapsedMs,
    },
  };
  return reason ? { ...completed, reason } : completed;
}

export function createMotionDiagnosticsStore(
  options: MotionDiagnosticsStoreOptions = {},
): MotionDiagnosticsStore {
  const listeners = new Set<() => void>();
  const now = options.now ?? (() => performance.now());
  let nextId = 1;
  let current: MotionTransitionDiagnostic | null = null;
  let history: MotionTransitionDiagnostic[] = [];
  let pendingInput:
    | Readonly<{ at: number; type: MotionInputType }>
    | undefined;

  const publish = (value: MotionTransitionDiagnostic | null) => {
    current = value;
    listeners.forEach((listener) => listener());
  };

  const recordCompleted = (diagnostic: MotionTransitionDiagnostic) => {
    history = [...history.slice(-(MAX_HISTORY_ENTRIES - 1)), diagnostic];
    options.onCompleted?.(diagnostic);
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const getCurrent = () => current;
  const getHistory = () => history;

  const update = (
    id: number,
    diagnosticUpdate: Partial<MotionTransitionDiagnostic>,
  ) => {
    if (!current || current.id !== id || current.status !== "active") return;
    publish({
      ...current,
      ...diagnosticUpdate,
      phaseTimings: {
        ...current.phaseTimings,
        ...diagnosticUpdate.phaseTimings,
      },
    });
  };

  const begin = (input: MotionDiagnosticInput) => {
    const startedAt = now();
    if (current?.status === "active") {
      const superseded = completeDiagnostic(
        current,
        "superseded",
        startedAt,
        "latest-wins",
      );
      publish(superseded);
      recordCompleted(superseded);
    }
    const inputAgeMs =
      pendingInput === undefined ? undefined : startedAt - pendingInput.at;
    const activationInput =
      inputAgeMs !== undefined &&
      inputAgeMs >= 0 &&
      inputAgeMs <= MAX_INPUT_AGE_MS
        ? pendingInput
        : undefined;
    pendingInput = undefined;
    const diagnostic: MotionTransitionDiagnostic = {
      ...input,
      id: nextId++,
      status: "active",
      startedAt,
      inputType: activationInput?.type,
      inputToCoordinatorMs: activationInput
        ? startedAt - activationInput.at
        : undefined,
      phaseTimings: {},
      pseudoLayers: EMPTY_LAYERS,
      missingEndpoints: [],
      duplicateEndpoints: [],
    };
    publish(diagnostic);
    return diagnostic.id;
  };

  const recordActiveRender = (
    profilerId: string,
    actualDurationMs: number,
    baseDurationMs: number,
  ) => {
    if (!current || current.status !== "active") return;
    if (current.phaseTimings.routerReleaseMs !== undefined) return;
    const scopedTiming =
      profilerId === "coda-route-chrome"
        ? {
            reactChromeRenderMs: Math.max(
              current.phaseTimings.reactChromeRenderMs ?? 0,
              actualDurationMs,
            ),
          }
        : profilerId === "coda-route-outlet"
          ? {
              reactOutletRenderMs: Math.max(
                current.phaseTimings.reactOutletRenderMs ?? 0,
                actualDurationMs,
              ),
            }
          : {};
    update(current.id, {
      phaseTimings: {
        ...scopedTiming,
        reactBaseRenderMs: Math.max(
          current.phaseTimings.reactBaseRenderMs ?? 0,
          baseDurationMs,
        ),
        reactRenderMs: Math.max(
          current.phaseTimings.reactRenderMs ?? 0,
          actualDurationMs,
        ),
      },
    });
  };

  const finish = (
    id: number,
    status: MotionTransitionDiagnostic["status"],
    reason?: string,
  ) => {
    if (!current || current.id !== id) return;
    const finished = completeDiagnostic(current, status, now(), reason);
    publish(finished);
    recordCompleted(finished);
  };

  const recordInput = (type: MotionInputType, at = now()) => {
    pendingInput = { at, type };
  };

  const installInputDiagnostics = (eventTarget: Document = document) => {
    const recordClick = (event: MouseEvent) => {
      const target = event
        .composedPath()
        .find(
          (candidate): candidate is Element =>
            candidate instanceof Element &&
            candidate.matches("a, button, [role='button'], [role='link']"),
        );
      if (!target) return;
      recordInput(event.detail === 0 ? "keyboard" : "pointer");
    };
    const recordKey = (event: KeyboardEvent) => {
      const browserBack =
        event.key === "BrowserBack" ||
        (event.altKey && event.key === "ArrowLeft") ||
        (event.metaKey && event.key === "[");
      if (event.key === "Escape" || browserBack) {
        recordInput("keyboard");
      }
    };
    eventTarget.addEventListener("click", recordClick, true);
    eventTarget.addEventListener("keydown", recordKey, true);
    return () => {
      eventTarget.removeEventListener("click", recordClick, true);
      eventTarget.removeEventListener("keydown", recordKey, true);
    };
  };

  return Object.freeze({
    subscribe,
    getCurrent,
    getHistory,
    begin,
    update,
    recordActiveRender,
    finish,
    recordInput,
    installInputDiagnostics,
  });
}
