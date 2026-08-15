import { describe, expect, it, vi } from "vitest";

import {
  collectViewTransitionAnimationKeys,
  flattenLayoutKeyframesToTransform,
  isCompositorOnlyKeyframeKeys,
  keyframePropertyNames,
  rewriteDocumentViewTransitionGroupsToTransform,
  rewriteRunningViewTransitionGroupsToTransform,
} from "./compositorViewTransition";

describe("flattenLayoutKeyframesToTransform", () => {
  it("bakes width and height into scale and drops layout keys", () => {
    const rewritten = flattenLayoutKeyframesToTransform([
      {
        offset: 0,
        width: "146px",
        height: "146px",
        transform: "matrix(1, 0, 0, 1, 80, 120)",
        backdropFilter: "none",
      },
      {
        offset: 1,
        width: "320px",
        height: "320px",
        transform: "none",
        backdropFilter: "none",
      },
    ]);

    expect(keyframePropertyNames(rewritten)).toEqual(["transform"]);
    expect(rewritten[0]).toMatchObject({
      offset: 0,
      transform: "matrix(1, 0, 0, 1, -7, 33) scale(0.45625, 0.45625)",
    });
    expect(rewritten[1]).toMatchObject({
      offset: 1,
      transform: "matrix(1, 0, 0, 1, 0, 0) scale(1, 1)",
    });
  });

  it("shifts the matrix to the center delta so reverse morphs stay a straight diagonal", () => {
    const rewritten = flattenLayoutKeyframesToTransform([
      {
        offset: 0,
        width: "320px",
        height: "320px",
        transform: "matrix(1, 0, 0, 1, 200, -400)",
      },
      {
        offset: 1,
        width: "48px",
        height: "48px",
        transform: "none",
      },
    ]);

    expect(rewritten[0]?.transform).toBe(
      "matrix(1, 0, 0, 1, 336, -264) scale(6.666666666666667, 6.666666666666667)",
    );
    expect(rewritten[1]?.transform).toBe(
      "matrix(1, 0, 0, 1, 0, 0) scale(1, 1)",
    );
  });

  it("drops backdropFilter when no layout keys are present", () => {
    const rewritten = flattenLayoutKeyframesToTransform([
      { offset: 0, backdropFilter: "blur(12px)", opacity: 1 },
      { offset: 1, backdropFilter: "none", opacity: 1 },
    ]);

    expect(keyframePropertyNames(rewritten)).toEqual(["opacity"]);
    expect(isCompositorOnlyKeyframeKeys(keyframePropertyNames(rewritten))).toBe(
      true,
    );
  });

  it("keeps opacity when the group also fades", () => {
    const rewritten = flattenLayoutKeyframesToTransform([
      { offset: 0, width: "100px", height: "50px", opacity: 0.4 },
      { offset: 1, width: "200px", height: "100px", opacity: 1 },
    ]);

    expect(keyframePropertyNames(rewritten)).toEqual(["opacity", "transform"]);
    expect(rewritten[0]?.transform).toBe(
      "matrix(1, 0, 0, 1, -50, -25) scale(0.5, 0.5)",
    );
    expect(rewritten[0]?.opacity).toBe(0.4);
  });
});

describe("rewriteRunningViewTransitionGroupsToTransform", () => {
  it.each([
    "coda-album-artwork",
    "coda-artist-artwork",
    "coda-playlist-identity",
    "coda-radio-artwork",
    "coda-discover-artwork",
    "coda-daily-artwork",
    "coda-now-playing-artwork",
  ] as const)("rewrites layout keys on %s groups", (name) => {
    const setGroup = vi.fn();
    const animations = [
      {
        effect: {
          pseudoElement: `::view-transition-group(${name})`,
          getKeyframes: () => [
            {
              offset: 0,
              width: "80px",
              height: "80px",
              backdropFilter: "blur(8px)",
              transform: "none",
            },
            {
              offset: 1,
              width: "160px",
              height: "160px",
              backdropFilter: "none",
              transform: "none",
            },
          ],
          setKeyframes: setGroup,
        },
      },
    ] as unknown as Animation[];

    expect(rewriteRunningViewTransitionGroupsToTransform(animations)).toBe(1);
    expect(keyframePropertyNames(setGroup.mock.calls[0]?.[0] ?? [])).toEqual([
      "transform",
    ]);
  });

  it("rewrites groups that only animate backdropFilter", () => {
    const setGroup = vi.fn();
    const animations = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-artist-artwork)",
          getKeyframes: () => [
            { offset: 0, backdropFilter: "blur(12px)", opacity: 1 },
            { offset: 1, backdropFilter: "none", opacity: 1 },
          ],
          setKeyframes: setGroup,
        },
      },
    ] as unknown as Animation[];

    expect(rewriteRunningViewTransitionGroupsToTransform(animations)).toBe(1);
    expect(keyframePropertyNames(setGroup.mock.calls[0]?.[0] ?? [])).toEqual([
      "opacity",
    ]);
  });

  it("rewrites only running view-transition groups that animate layout", () => {
    const setGroup = vi.fn();
    const setTitle = vi.fn();
    const animations = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-album-artwork)",
          getKeyframes: () => [
            { offset: 0, width: "146px", height: "146px", transform: "none" },
            { offset: 1, width: "320px", height: "320px", transform: "none" },
          ],
          setKeyframes: setGroup,
        },
      },
      {
        effect: {
          pseudoElement: "::view-transition-new(coda-album-title)",
          getKeyframes: () => [
            { offset: 0, opacity: 0 },
            { offset: 1, opacity: 1 },
          ],
          setKeyframes: setTitle,
        },
      },
    ] as unknown as Animation[];

    expect(rewriteRunningViewTransitionGroupsToTransform(animations)).toBe(1);
    expect(setGroup).toHaveBeenCalledOnce();
    expect(keyframePropertyNames(setGroup.mock.calls[0]?.[0] ?? [])).toEqual([
      "transform",
    ]);
    expect(setTitle).not.toHaveBeenCalled();
  });

  it("rewrites old/new layers that still animate backdropFilter", () => {
    const setOld = vi.fn();
    const animations = [
      {
        playState: "running",
        effect: {
          pseudoElement: "::view-transition-old(coda-playlist-identity)",
          getKeyframes: () => [
            { offset: 0, backdropFilter: "blur(8px)", opacity: 1 },
            { offset: 1, backdropFilter: "none", opacity: 0 },
          ],
          setKeyframes: setOld,
        },
      },
    ] as unknown as Animation[];

    expect(rewriteRunningViewTransitionGroupsToTransform(animations)).toBe(1);
    expect(keyframePropertyNames(setOld.mock.calls[0]?.[0] ?? [])).toEqual([
      "opacity",
    ]);
  });

  it("collects compositor-safe keys after rewrite", () => {
    const rewritten = flattenLayoutKeyframesToTransform([
      {
        offset: 0,
        width: "80px",
        height: "80px",
        backdropFilter: "blur(8px)",
        transform: "none",
      },
      {
        offset: 1,
        width: "160px",
        height: "160px",
        backdropFilter: "none",
        transform: "none",
      },
    ]);
    expect(isCompositorOnlyKeyframeKeys(keyframePropertyNames(rewritten))).toBe(
      true,
    );
    expect(
      collectViewTransitionAnimationKeys([
        {
          playState: "running",
          effect: {
            pseudoElement: "::view-transition-group(coda-radio-artwork)",
            getKeyframes: () => rewritten,
          },
        },
      ] as unknown as Animation[]),
    ).toEqual([
      {
        playState: "running",
        pseudo: "::view-transition-group(coda-radio-artwork)",
        keys: ["transform"],
      },
    ]);
  });

  it("no-ops when document.getAnimations is missing", () => {
    const original = Object.getOwnPropertyDescriptor(document, "getAnimations");
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: undefined,
    });
    expect(rewriteDocumentViewTransitionGroupsToTransform()).toBe(0);
    if (original) Object.defineProperty(document, "getAnimations", original);
    else delete (document as { getAnimations?: unknown }).getAnimations;
  });
});
