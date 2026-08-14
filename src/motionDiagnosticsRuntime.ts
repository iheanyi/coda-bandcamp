import type {
  MotionDiagnosticInput,
  MotionPseudoLayers,
  MotionRect,
  MotionTransitionDiagnostic,
} from "./motionDiagnostics";

type MotionDiagnosticsRuntime = Readonly<{
  active: () => boolean;
  begin: (input: MotionDiagnosticInput) => number;
  endpointIssues: (
    sourceCount: number,
    destinationCount: number,
  ) => Readonly<{
    missingEndpoints: readonly string[];
    duplicateEndpoints: readonly string[];
  }>;
  finish: (
    id: number,
    status: MotionTransitionDiagnostic["status"],
    reason?: string,
  ) => void;
  inspectPseudoLayers: (
    expectedTransitionNames?: readonly string[],
  ) => Readonly<{
    layers: MotionPseudoLayers;
    actualDurationMs: number;
  }>;
  pseudoLayersPair: (
    layers: MotionPseudoLayers,
    expectedTransitionNames?: readonly string[],
  ) => boolean;
  rectSnapshot: (rect: DOMRect) => MotionRect;
  update: (id: number, update: Partial<MotionTransitionDiagnostic>) => void;
}>;

const EMPTY_LAYERS: MotionPseudoLayers = { group: [], old: [], new: [] };
const NOOP_RUNTIME: MotionDiagnosticsRuntime = {
  active: () => false,
  begin: () => 0,
  endpointIssues: () => ({ missingEndpoints: [], duplicateEndpoints: [] }),
  finish: () => undefined,
  inspectPseudoLayers: () => ({ layers: EMPTY_LAYERS, actualDurationMs: 0 }),
  pseudoLayersPair: () => false,
  rectSnapshot: () => ({ x: 0, y: 0, width: 0, height: 0 }),
  update: () => undefined,
};

let runtime = NOOP_RUNTIME;

export function installMotionDiagnosticsRuntime(
  implementation: MotionDiagnosticsRuntime,
) {
  runtime = implementation;
  return () => {
    if (runtime === implementation) runtime = NOOP_RUNTIME;
  };
}

export function motionDiagnosticsActive() {
  return import.meta.env.MODE !== "production" && runtime.active();
}

export const motionDiagnosticsRuntime = {
  begin: (input: MotionDiagnosticInput) => runtime.begin(input),
  endpointIssues: (sourceCount: number, destinationCount: number) =>
    runtime.endpointIssues(sourceCount, destinationCount),
  finish: (
    id: number,
    status: MotionTransitionDiagnostic["status"],
    reason?: string,
  ) => runtime.finish(id, status, reason),
  inspectPseudoLayers: (expectedTransitionNames?: readonly string[]) =>
    runtime.inspectPseudoLayers(expectedTransitionNames),
  pseudoLayersPair: (
    layers: MotionPseudoLayers,
    expectedTransitionNames?: readonly string[],
  ) => runtime.pseudoLayersPair(layers, expectedTransitionNames),
  rectSnapshot: (rect: DOMRect) => runtime.rectSnapshot(rect),
  update: (id: number, update: Partial<MotionTransitionDiagnostic>) =>
    runtime.update(id, update),
} as const;
