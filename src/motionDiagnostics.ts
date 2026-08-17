import { useSyncExternalStore } from "react";
import { isNumberValue } from "./ownData";
import {
  createMotionDiagnosticsStore,
  type MotionDiagnosticsStore,
  type MotionPseudoLayers,
  type MotionRect,
  type MotionTransitionDiagnostic,
} from "./motionDiagnosticsStore";

export type {
  MotionInputType,
  MotionPhaseTimings,
  MotionPseudoLayers,
  MotionRect,
  MotionTransitionDiagnostic,
} from "./motionDiagnosticsStore";

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

type MotionDiagnosticsHotData = {
  motionDiagnosticsStore?: MotionDiagnosticsStore;
};

type MotionDiagnosticsImportMeta = ImportMeta & {
  hot?: { data: MotionDiagnosticsHotData };
};

function rounded(value: number | undefined) {
  return value === undefined ? undefined : Math.round(value * 10) / 10;
}

function logCompletedDiagnostic(diagnostic: MotionTransitionDiagnostic) {
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

// SAFETY: Vite adds this optional shape in development; production omits it.
const hotData = (import.meta as MotionDiagnosticsImportMeta).hot?.data;
const productionMotionDiagnosticsStore =
  hotData?.motionDiagnosticsStore ??
  createMotionDiagnosticsStore({ onCompleted: logCompletedDiagnostic });
if (hotData) {
  hotData.motionDiagnosticsStore = productionMotionDiagnosticsStore;
}

export const subscribeMotionDiagnostics =
  productionMotionDiagnosticsStore.subscribe;
export const getMotionDiagnostic =
  productionMotionDiagnosticsStore.getCurrent;
export const getMotionDiagnosticHistory =
  productionMotionDiagnosticsStore.getHistory;
export const beginMotionDiagnostic = productionMotionDiagnosticsStore.begin;
export const updateMotionDiagnostic = productionMotionDiagnosticsStore.update;
export const recordActiveMotionRender =
  productionMotionDiagnosticsStore.recordActiveRender;
export const finishMotionDiagnostic = productionMotionDiagnosticsStore.finish;
export const recordMotionInput = productionMotionDiagnosticsStore.recordInput;
export const installMotionInputDiagnostics =
  productionMotionDiagnosticsStore.installInputDiagnostics;

export function useMotionDiagnostic() {
  return useSyncExternalStore(
    subscribeMotionDiagnostics,
    getMotionDiagnostic,
    getMotionDiagnostic,
  );
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

function isComputedTimingReader<Value>(
  value: Value,
): value is Value & (() => Readonly<{ endTime?: number | null }>) {
  return typeof value === "function";
}

function isDocumentAnimationsReader<Value>(
  value: Value,
): value is Value & (() => Animation[]) {
  return typeof value === "function";
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
    (pseudoElement === null || typeof pseudoElement === "string") &&
    isComputedTimingReader(effect.getComputedTiming)
  );
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
  if (!isDocumentAnimationsReader(getAnimations)) {
    return { layers, actualDurationMs };
  }
  for (const animation of getAnimations.call(document)) {
    if (animation.playState === "finished" || animation.playState === "idle") {
      continue;
    }
    const effect = animation.effect;
    if (!isMotionPseudoEffect(effect)) continue;
    const pseudo = effect.pseudoElement;
    if (!pseudo?.startsWith("::view-transition")) continue;
    const name = pseudoName(pseudo) ?? pseudo;
    if (pseudo.startsWith("::view-transition-group")) layers.group.push(name);
    if (pseudo.startsWith("::view-transition-old")) layers.old.push(name);
    if (pseudo.startsWith("::view-transition-new")) layers.new.push(name);
    const endTime = effect.getComputedTiming().endTime;
    const tracksConfiguredLayer =
      expectedNames.size === 0 || expectedNames.has(name);
    if (
      tracksConfiguredLayer &&
      isNumberValue(endTime) &&
      !Number.isNaN(endTime)
    ) {
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
