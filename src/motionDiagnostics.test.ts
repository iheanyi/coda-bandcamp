import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginMotionDiagnostic,
  endpointIssues,
  finishMotionDiagnostic,
  getMotionDiagnostic,
  inspectMotionPseudoLayers,
  pseudoLayersPair,
  resetMotionDiagnosticsForTests,
  updateMotionDiagnostic,
} from "./motionDiagnostics";

function pseudoAnimation(pseudoElement: string, endTime: number) {
  return {
    effect: {
      pseudoElement,
      getComputedTiming: () => ({ endTime }),
    },
  } as unknown as Animation;
}

describe("Motion diagnostics", () => {
  beforeEach(() => resetMotionDiagnosticsForTests());

  it("reports actual pseudo-layer presence, names, and duration", () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: vi.fn(() => [
        pseudoAnimation("::view-transition-group(shared-art)", 420),
        pseudoAnimation("::view-transition-old(shared-art)", 400),
        pseudoAnimation("::view-transition-new(shared-art)", 410),
      ]),
    });
    const result = inspectMotionPseudoLayers();
    expect(result).toEqual({
      layers: {
        group: ["shared-art"],
        old: ["shared-art"],
        new: ["shared-art"],
      },
      actualDurationMs: 420,
    });
    expect(pseudoLayersPair(result.layers)).toBe(true);
  });

  it("measures and pairs only the configured shared transition names", () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: vi.fn(() => [
        pseudoAnimation("::view-transition-group(root)", 2_000),
        pseudoAnimation("::view-transition-old(root)", 2_000),
        pseudoAnimation("::view-transition-new(root)", 2_000),
        pseudoAnimation("::view-transition-group(motion-view-8)", 450),
        pseudoAnimation("::view-transition-old(motion-view-8)", 420),
        pseudoAnimation("::view-transition-new(motion-view-8)", 430),
      ]),
    });

    const result = inspectMotionPseudoLayers(["motion-view-8"]);
    expect(result.actualDurationMs).toBe(450);
    expect(pseudoLayersPair(result.layers, ["motion-view-8"])).toBe(true);
    expect(pseudoLayersPair(result.layers, ["missing-name"])).toBe(false);
  });

  it("publishes observable endpoint and fallback state", () => {
    const id = beginMotionDiagnostic({
      kind: "album-detail",
      configuredDurationMs: 300,
      speed: 1,
      transitionClass: "coda-transition--album-detail",
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 1,
      destinationCount: 0,
      sharedExpected: true,
    });
    updateMotionDiagnostic(id, {
      destinationCount: 2,
      ...endpointIssues(1, 2),
    });
    finishMotionDiagnostic(id, "fallback", "native-transition-error");
    expect(getMotionDiagnostic()).toMatchObject({
      status: "fallback",
      reason: "native-transition-error",
      duplicateEndpoints: ["destination"],
    });
  });
});
