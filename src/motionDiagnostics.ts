import { useSyncExternalStore } from "react";
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

type MutableMotionPseudoLayers = {
  group: string[];
  old: string[];
  new: string[];
};

type MotionPseudoEffect = Readonly<{
  getComputedTiming: () => Readonly<{ endTime?: number | null }>;
  pseudoElement: string | null;
}>;

export type MotionPseudoAnimation = Readonly<{
  effect: AnimationEffect | MotionPseudoEffect | null;
  playState: AnimationPlayState;
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

const EMPTY_LAYERS: MotionPseudoLayers = { group: [], old: [], new: [] };
const MAX_INPUT_AGE_MS = 1_000;
const MAX_HISTORY_ENTRIES = 20;
const listeners = new Set<() => void>();
let nextId = 1;
let current: MotionTransitionDiagnostic | null = null;
let history: MotionTransitionDiagnostic[] = [];
let pendingInput: Readonly<{ at: number; type: MotionInputType }> | undefined;

function publish(value: MotionTransitionDiagnostic | null) {
  current = value;
  listeners.forEach((listener) => listener());
}

export function subscribeMotionDiagnostics(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMotionDiagnostic() {
  return current;
}

export function getMotionDiagnosticHistory() {
  return history;
}

export function useMotionDiagnostic() {
  return useSyncExternalStore(
    subscribeMotionDiagnostics,
    getMotionDiagnostic,
    getMotionDiagnostic,
  );
}

export function beginMotionDiagnostic(
  diagnosticInput: Omit<
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
  >,
) {
  const startedAt = performance.now();
  if (current?.status === "active") {
    const superseded = completeDiagnostic(
      current,
      "superseded",
      startedAt,
      "latest-wins",
    );
    publish(superseded);
    recordCompletedDiagnostic(superseded);
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
    ...diagnosticInput,
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
}

export function updateMotionDiagnostic(
  id: number,
  update: Partial<MotionTransitionDiagnostic>,
) {
  if (!current || current.id !== id || current.status !== "active") return;
  publish({
    ...current,
    ...update,
    phaseTimings: {
      ...current.phaseTimings,
      ...update.phaseTimings,
    },
  });
}

export function recordActiveMotionRender(
  profilerId: string,
  actualDurationMs: number,
  baseDurationMs: number,
) {
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
  updateMotionDiagnostic(current.id, {
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
}

export function finishMotionDiagnostic(
  id: number,
  status: MotionTransitionDiagnostic["status"],
  reason?: string,
) {
  if (!current || current.id !== id) return;
  const finished = completeDiagnostic(
    current,
    status,
    performance.now(),
    reason,
  );
  publish(finished);
  recordCompletedDiagnostic(finished);
}

export function recordMotionInput(
  type: MotionInputType,
  at = performance.now(),
) {
  pendingInput = { at, type };
}

export function installMotionInputDiagnostics(
  eventTarget: Document = document,
) {
  const recordClick = (event: MouseEvent) => {
    const target = event
      .composedPath()
      .find(
        (candidate): candidate is Element =>
          candidate instanceof Element &&
          candidate.matches("a, button, [role='button'], [role='link']"),
      );
    if (!target) return;
    recordMotionInput(event.detail === 0 ? "keyboard" : "pointer");
  };
  const recordKey = (event: KeyboardEvent) => {
    const browserBack =
      event.key === "BrowserBack" ||
      (event.altKey && event.key === "ArrowLeft") ||
      (event.metaKey && event.key === "[");
    if (event.key === "Escape" || browserBack) {
      recordMotionInput("keyboard");
    }
  };
  eventTarget.addEventListener("click", recordClick, true);
  eventTarget.addEventListener("keydown", recordKey, true);
  return () => {
    eventTarget.removeEventListener("click", recordClick, true);
    eventTarget.removeEventListener("keydown", recordKey, true);
  };
}

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

function recordCompletedDiagnostic(diagnostic: MotionTransitionDiagnostic) {
  history = [...history.slice(-(MAX_HISTORY_ENTRIES - 1)), diagnostic];
  if (import.meta.env.MODE !== "development") return;
  console.info("[coda:motion]", {
    id: diagnostic.id,
    kind: diagnostic.kind,
    status: diagnostic.status,
    inputType: diagnostic.inputType ?? "programmatic",
    inputToCoordinatorMs: rounded(diagnostic.inputToCoordinatorMs),
    firstVisualMs: rounded(diagnostic.firstVisualMs),
    phaseTimings: Object.fromEntries(
      Object.entries(diagnostic.phaseTimings).map(([name, duration]) => [
        name,
        rounded(duration),
      ]),
    ),
    configuredDurationMs: rounded(diagnostic.configuredDurationMs),
    actualDurationMs: rounded(diagnostic.actualDurationMs),
    totalFromInputMs: rounded(diagnostic.totalFromInputMs),
    reason: diagnostic.reason,
  });
}

function rounded(value: number | undefined) {
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}

export function rectSnapshot(rect: DOMRect): MotionRect {
  return {
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
  };
}

function pseudoName(value: string) {
  const match = value.match(/::view-transition-(?:group|old|new)\(([^)]+)\)/);
  return match?.[1];
}

function isPrimitiveNumber<Value>(value: Value): value is Value & number {
  return (
    Object.prototype.toString.call(value) === "[object Number]" &&
    value === Number(value)
  );
}

function isPrimitiveString<Value>(value: Value): value is Value & string {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    value === String(value)
  );
}

function isComputedTimingReader<Value>(
  value: Value,
): value is Value & (() => Readonly<{ endTime?: number | null }>) {
  return Object.prototype.toString.call(value) === "[object Function]";
}

function isMotionPseudoEffect(
  effect: AnimationEffect | MotionPseudoEffect | null,
): effect is MotionPseudoEffect {
  if (
    !effect ||
    !("pseudoElement" in effect) ||
    !("getComputedTiming" in effect)
  ) {
    return false;
  }
  const pseudoElement = effect.pseudoElement;
  return (
    (pseudoElement === null || isPrimitiveString(pseudoElement)) &&
    isComputedTimingReader(effect.getComputedTiming)
  );
}

function isAnimationReader<Value>(
  value: Value,
): value is Value & (() => Animation[]) {
  return Object.prototype.toString.call(value) === "[object Function]";
}

export function inspectMotionPseudoLayers(
  expectedTransitionNames: readonly string[] = [],
) {
  const layers: MutableMotionPseudoLayers = {
    group: [],
    old: [],
    new: [],
  };
  const expectedNames = new Set(expectedTransitionNames);
  let actualDurationMs = 0;
  const getAnimations = document.getAnimations;
  if (!isAnimationReader(getAnimations)) {
    return { layers, actualDurationMs };
  }
  for (const animation of getAnimations.call(document)) {
    if (animation.playState === "finished" || animation.playState === "idle") {
      continue;
    }
    const effect = animation.effect;
    if (!isMotionPseudoEffect(effect)) continue;
    const pseudo = effect?.pseudoElement;
    if (!pseudo?.startsWith("::view-transition")) continue;
    const name = pseudoName(pseudo) ?? pseudo;
    if (pseudo.startsWith("::view-transition-group")) layers.group.push(name);
    if (pseudo.startsWith("::view-transition-old")) layers.old.push(name);
    if (pseudo.startsWith("::view-transition-new")) layers.new.push(name);
    const endTime = effect?.getComputedTiming().endTime;
    const tracksConfiguredLayer =
      expectedNames.size === 0 || expectedNames.has(name);
    if (tracksConfiguredLayer && isPrimitiveNumber(endTime)) {
      actualDurationMs = Math.max(actualDurationMs, endTime);
    }
  }
  return {
    layers: {
      group: [...new Set(layers.group)],
      old: [...new Set(layers.old)],
      new: [...new Set(layers.new)],
    },
    actualDurationMs,
  };
}

export function endpointIssues(sourceCount: number, destinationCount: number) {
  return {
    missingEndpoints: [
      ...(sourceCount === 0 ? ["source"] : []),
      ...(destinationCount === 0 ? ["destination"] : []),
    ],
    duplicateEndpoints: [
      ...(sourceCount > 1 ? ["source"] : []),
      ...(destinationCount > 1 ? ["destination"] : []),
    ],
  };
}

export function pseudoLayersPair(
  layers: MotionPseudoLayers,
  expectedTransitionNames: readonly string[] = [],
) {
  const group = new Set(layers.group);
  const old = new Set(layers.old);
  const newest = new Set(layers.new);
  const expectedNames = new Set(expectedTransitionNames);
  return [...group].some(
    (name) =>
      name !== "root" &&
      (expectedNames.size === 0 || expectedNames.has(name)) &&
      old.has(name) &&
      newest.has(name),
  );
}

export function resetMotionDiagnosticsForTests() {
  current = null;
  history = [];
  pendingInput = undefined;
  nextId = 1;
  listeners.forEach((listener) => listener());
}
