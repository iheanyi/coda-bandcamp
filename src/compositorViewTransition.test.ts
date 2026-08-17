import { describe, expect, it, vi } from "vitest";

import {
  enforceDocumentViewTransitionCompositing,
  enforceCompositorOnlyViewTransitions,
  flattenLayoutKeyframesToTransform,
  isCompositorOnlyKeyframeKeys,
  keyframePropertyNames,
  type CompositorAnimation,
} from "./compositorViewTransition";

describe("flattenLayoutKeyframesToTransform", () => {
  it("bakes size changes into a centered scale", () => {
    const rewritten = flattenLayoutKeyframesToTransform([
      {
        offset: 0,
        width: "146px",
        height: "146px",
        transform: "matrix(1, 0, 0, 1, 80, 120)",
      },
      {
        offset: 1,
        width: "320px",
        height: "320px",
        transform: "none",
      },
    ]);

    expect(keyframePropertyNames(rewritten)).toEqual(["transform"]);
    expect(rewritten[0]?.transform).toBe(
      "matrix(1, 0, 0, 1, -7, 33) scale(0.45625, 0.45625)",
    );
    expect(rewritten[1]?.transform).toBe(
      "matrix(1, 0, 0, 1, 0, 0) scale(1, 1)",
    );
  });

  it("drops only constant non-compositor properties", () => {
    const rewritten = flattenLayoutKeyframesToTransform([
      {
        offset: 0,
        width: "80px",
        height: "80px",
        backdropFilter: "none",
        opacity: 0.7,
      },
      {
        offset: 1,
        width: "160px",
        height: "160px",
        backdropFilter: "none",
        opacity: 1,
      },
    ]);

    expect(isCompositorOnlyKeyframeKeys(keyframePropertyNames(rewritten))).toBe(
      true,
    );
    expect(keyframePropertyNames(rewritten)).toEqual(["opacity", "transform"]);
  });
});

describe("enforceCompositorOnlyViewTransitions", () => {
  it("rewrites only the transition groups owned by the current detail", () => {
    const setArtwork = vi.fn();
    const setUnrelated = vi.fn();
    const animations = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-album-artwork)",
          getKeyframes: () => [
            { width: "80px", height: "80px", transform: "none" },
            { width: "160px", height: "160px", transform: "none" },
          ],
          setKeyframes: setArtwork,
        },
      },
      {
        effect: {
          pseudoElement: "::view-transition-new(coda-detail-surface)",
          getKeyframes: () => [{ opacity: 0 }, { opacity: 1 }],
        },
      },
      {
        effect: {
          pseudoElement: "::view-transition-group(unrelated-widget)",
          getKeyframes: () => [
            { width: "10px", height: "10px" },
            { width: "20px", height: "20px" },
          ],
          setKeyframes: setUnrelated,
        },
      },
    ] satisfies readonly CompositorAnimation[];

    expect(
      enforceCompositorOnlyViewTransitions(animations, [
        "coda-album-artwork",
        "coda-detail-surface",
      ]),
    ).toEqual({ inspected: 2, rewritten: 1, safe: true });
    expect(setArtwork).toHaveBeenCalledOnce();
    expect(setUnrelated).not.toHaveBeenCalled();
  });

  it("fails closed instead of dropping changing position or filter values", () => {
    const setKeyframes = vi.fn();
    const animations = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-album-artwork)",
          getKeyframes: () => [
            {
              backdropFilter: "blur(8px)",
              height: "80px",
              left: "0px",
              width: "80px",
            },
            {
              backdropFilter: "none",
              height: "160px",
              left: "100px",
              width: "160px",
            },
          ],
          setKeyframes,
        },
      },
    ] satisfies readonly CompositorAnimation[];

    expect(
      enforceCompositorOnlyViewTransitions(animations, [
        "coda-album-artwork",
      ]),
    ).toEqual({ inspected: 1, rewritten: 0, safe: false });
    expect(setKeyframes).not.toHaveBeenCalled();
  });

  it("fails closed when a non-compositor property is missing from one endpoint", () => {
    const setKeyframes = vi.fn();
    const animations = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-album-artwork)",
          getKeyframes: () => [
            {
              filter: "blur(8px)",
              height: "80px",
              width: "80px",
            },
            { height: "160px", width: "160px" },
          ],
          setKeyframes,
        },
      },
    ] satisfies readonly CompositorAnimation[];

    expect(
      enforceCompositorOnlyViewTransitions(animations, [
        "coda-album-artwork",
      ]),
    ).toEqual({ inspected: 1, rewritten: 0, safe: false });
    expect(setKeyframes).not.toHaveBeenCalled();
  });

  it("fails closed when an expected transition group is absent", () => {
    const animations = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-album-artwork)",
          getKeyframes: () => [{ opacity: 1 }, { opacity: 1 }],
        },
      },
    ] satisfies readonly CompositorAnimation[];

    expect(
      enforceCompositorOnlyViewTransitions(animations, [
        "coda-album-artwork",
        "coda-detail-surface",
      ]),
    ).toEqual({ inspected: 1, rewritten: 0, safe: false });
  });

  it("reports an unsafe owned animation when the host cannot rewrite it", () => {
    const animations = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-now-playing-artwork)",
          getKeyframes: () => [
            { width: "48px", height: "48px" },
            { width: "320px", height: "320px" },
          ],
        },
      },
    ] satisfies readonly CompositorAnimation[];

    expect(
      enforceCompositorOnlyViewTransitions(animations, [
        "coda-now-playing-artwork",
      ]),
    ).toEqual({ inspected: 1, rewritten: 0, safe: false });
  });

  it("fails closed when animation inspection or rewriting throws", () => {
    const inspectionFailure = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-album-artwork)",
          getKeyframes: () => {
            throw new Error("inspection unavailable");
          },
        },
      },
    ] satisfies readonly CompositorAnimation[];
    const rewriteFailure = [
      {
        effect: {
          pseudoElement: "::view-transition-group(coda-album-artwork)",
          getKeyframes: () => [
            { width: "80px", height: "80px" },
            { width: "160px", height: "160px" },
          ],
          setKeyframes: () => {
            throw new Error("rewrite unavailable");
          },
        },
      },
    ] satisfies readonly CompositorAnimation[];

    expect(
      enforceCompositorOnlyViewTransitions(inspectionFailure, [
        "coda-album-artwork",
      ]).safe,
    ).toBe(false);
    expect(
      enforceCompositorOnlyViewTransitions(rewriteFailure, [
        "coda-album-artwork",
      ]).safe,
    ).toBe(false);
  });

  it("fails closed when document animation introspection is unavailable", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      document,
      "getAnimations",
    );
    Reflect.deleteProperty(document, "getAnimations");

    try {
      expect(
        enforceDocumentViewTransitionCompositing(["coda-album-artwork"]),
      ).toEqual({ inspected: 0, rewritten: 0, safe: false });
    } finally {
      if (descriptor) {
        Object.defineProperty(document, "getAnimations", descriptor);
      }
    }
  });
});
