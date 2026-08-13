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

export type MotionTransitionDiagnostic = Readonly<{
  id: number;
  kind: CodaViewTransitionKind;
  status: "active" | "finished" | "bypassed" | "fallback" | "superseded";
  reason?: string;
  startedAt: number;
  configuredDurationMs: number;
  actualDurationMs?: number;
  elapsedMs?: number;
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
const listeners = new Set<() => void>();
let nextId = 1;
let current: MotionTransitionDiagnostic | null = null;

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

export function useMotionDiagnostic() {
  return useSyncExternalStore(
    subscribeMotionDiagnostics,
    getMotionDiagnostic,
    getMotionDiagnostic,
  );
}

export function beginMotionDiagnostic(
  input: Omit<
    MotionTransitionDiagnostic,
    | "id"
    | "status"
    | "startedAt"
    | "pseudoLayers"
    | "missingEndpoints"
    | "duplicateEndpoints"
  >,
) {
  if (current?.status === "active") {
    publish({
      ...current,
      status: "superseded",
      reason: "latest-wins",
      elapsedMs: performance.now() - current.startedAt,
    });
  }
  const diagnostic: MotionTransitionDiagnostic = {
    ...input,
    id: nextId++,
    status: "active",
    startedAt: performance.now(),
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
  if (!current || current.id !== id) return;
  publish({ ...current, ...update });
}

export function finishMotionDiagnostic(
  id: number,
  status: MotionTransitionDiagnostic["status"],
  reason?: string,
) {
  if (!current || current.id !== id) return;
  publish({
    ...current,
    status,
    ...(reason ? { reason } : {}),
    elapsedMs: performance.now() - current.startedAt,
  });
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

export function inspectMotionPseudoLayers(
  expectedTransitionNames: readonly string[] = [],
) {
  const layers: { group: string[]; old: string[]; new: string[] } = {
    group: [],
    old: [],
    new: [],
  };
  const expectedNames = new Set(expectedTransitionNames);
  let actualDurationMs = 0;
  if (typeof document.getAnimations !== "function") {
    return { layers, actualDurationMs };
  }
  for (const animation of document.getAnimations()) {
    if (animation.playState === "finished" || animation.playState === "idle") {
      continue;
    }
    const effect = animation.effect as KeyframeEffect | null;
    const pseudo = effect?.pseudoElement;
    if (!pseudo?.startsWith("::view-transition")) continue;
    const name = pseudoName(pseudo) ?? pseudo;
    if (pseudo.startsWith("::view-transition-group")) layers.group.push(name);
    if (pseudo.startsWith("::view-transition-old")) layers.old.push(name);
    if (pseudo.startsWith("::view-transition-new")) layers.new.push(name);
    const endTime = effect?.getComputedTiming().endTime;
    const tracksConfiguredLayer =
      expectedNames.size === 0 || expectedNames.has(name);
    if (tracksConfiguredLayer && typeof endTime === "number") {
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
  nextId = 1;
  listeners.forEach((listener) => listener());
}
