import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  beginMotionDiagnostic,
  endpointIssues,
  finishMotionDiagnostic,
  getMotionDiagnostic,
  getMotionDiagnosticHistory,
  inspectMotionPseudoLayers,
  installMotionInputDiagnostics,
  pseudoLayersPair,
  recordActiveMotionRender,
  recordMotionInput,
  resetMotionDiagnosticsForTests,
  updateMotionDiagnostic,
  type MotionPseudoAnimation,
} from "./motionDiagnostics";

function pseudoAnimation(
  pseudoElement: string,
  endTime: number,
  playState: AnimationPlayState = "running",
): MotionPseudoAnimation {
  return {
    playState,
    effect: {
      pseudoElement,
      getComputedTiming: () => ({ endTime }),
    },
  };
}

describe("Motion diagnostics", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetMotionDiagnosticsForTests();
  });

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

  it("ignores finished and cancelled pseudo layers retained by the browser", () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: vi.fn(() => [
        pseudoAnimation("::view-transition-group(stale)", 450, "finished"),
        pseudoAnimation("::view-transition-old(stale)", 450, "idle"),
        pseudoAnimation("::view-transition-group(current)", 180),
        pseudoAnimation("::view-transition-old(current)", 120),
        pseudoAnimation("::view-transition-new(current)", 120),
      ]),
    });

    expect(inspectMotionPseudoLayers()).toEqual({
      layers: {
        group: ["current"],
        old: ["current"],
        new: ["current"],
      },
      actualDurationMs: 180,
    });
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

  it("measures input, phase, first-visual, and total latency", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValueOnce(125).mockReturnValueOnce(225);
    recordMotionInput("pointer", 100);

    const id = beginMotionDiagnostic({
      kind: "album-detail",
      configuredDurationMs: 460,
      speed: 1,
      transitionClass: "coda-transition--album-detail",
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 1,
      destinationCount: 0,
      sharedExpected: true,
    });
    updateMotionDiagnostic(id, {
      phaseTimings: { readyMs: 40, updateStartMs: 10 },
    });
    updateMotionDiagnostic(id, {
      phaseTimings: { updateMs: 15 },
    });
    recordActiveMotionRender("coda-route", 12, 20);
    recordActiveMotionRender("coda-route", 8, 24);
    finishMotionDiagnostic(id, "finished");

    expect(getMotionDiagnostic()).toMatchObject({
      inputType: "pointer",
      inputToCoordinatorMs: 25,
      firstVisualMs: 65,
      totalFromInputMs: 125,
      phaseTimings: {
        finishedMs: 100,
        reactBaseRenderMs: 24,
        reactRenderMs: 12,
        readyMs: 40,
        updateMs: 15,
        updateStartMs: 10,
      },
    });
    expect(getMotionDiagnosticHistory()).toHaveLength(1);
  });

  it("uses the observed page entrance when no source paint was captured", () => {
    const id = beginMotionDiagnostic({
      kind: "page-forward",
      configuredDurationMs: 315,
      speed: 1,
      transitionClass: "coda-transition--page-forward",
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 0,
      destinationCount: 1,
      sharedExpected: false,
    });
    updateMotionDiagnostic(id, {
      phaseTimings: { entranceStartMs: 28 },
    });
    finishMotionDiagnostic(id, "finished");

    expect(getMotionDiagnostic()?.firstVisualMs).toBe(28);
  });

  it("ignores phase updates from a settled or superseded transition", () => {
    const firstId = beginMotionDiagnostic({
      kind: "page-forward",
      configuredDurationMs: 315,
      speed: 1,
      transitionClass: "coda-transition--page-forward",
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 1,
      destinationCount: 1,
      sharedExpected: false,
    });
    finishMotionDiagnostic(firstId, "finished");
    updateMotionDiagnostic(firstId, {
      phaseTimings: { routerNavigationMs: 900 },
    });

    const secondId = beginMotionDiagnostic({
      kind: "page-back",
      configuredDurationMs: 315,
      speed: 1,
      transitionClass: "coda-transition--page-back",
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 1,
      destinationCount: 1,
      sharedExpected: false,
    });
    updateMotionDiagnostic(firstId, {
      phaseTimings: { routerNavigationMs: 900 },
    });

    expect(getMotionDiagnostic()).toMatchObject({
      id: secondId,
      phaseTimings: {},
    });
  });

  it("captures accessible desktop activations before React handles them", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValueOnce(100).mockReturnValueOnce(112);
    const button = document.createElement("button");
    document.body.append(button);
    const uninstall = installMotionInputDiagnostics();

    button.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, detail: 1 }),
    );
    beginMotionDiagnostic({
      kind: "page-forward",
      configuredDurationMs: 300,
      speed: 1,
      transitionClass: "coda-transition--page-forward",
      transitionNames: [],
      transitionClasses: [],
      sourceCount: 1,
      destinationCount: 0,
      sharedExpected: false,
    });

    expect(getMotionDiagnostic()).toMatchObject({
      inputType: "pointer",
      inputToCoordinatorMs: 12,
    });
    uninstall();
    button.remove();
  });
});
