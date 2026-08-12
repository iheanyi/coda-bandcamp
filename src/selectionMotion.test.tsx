import { useState } from "react";
import { MotionConfig } from "motion/react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  selectionPillTransitionForDistance,
  useDistanceAwareSelectionPill,
} from "./selectionMotion";

describe("distance-aware selection motion", () => {
  it("keeps adjacent choices quick while bounding long travel", () => {
    expect(selectionPillTransitionForDistance(1, false)).toMatchObject({
      type: "spring",
      visualDuration: 0.3,
      bounce: 0.04,
    });
    expect(selectionPillTransitionForDistance(3, false)).toMatchObject({
      visualDuration: 0.41,
      bounce: 0.02,
    });
    expect(selectionPillTransitionForDistance(20, false)).toMatchObject({
      visualDuration: 0.46,
      bounce: 0.02,
    });
    expect(selectionPillTransitionForDistance(20, true)).toEqual({
      duration: 0,
    });
  });

  it("measures from the previously committed controlled choice", () => {
    const { result } = renderHook(
      () => {
        const [selectedIndex, setSelectedIndex] = useState(0);
        return {
          motion: useDistanceAwareSelectionPill(selectedIndex),
          setSelectedIndex,
        };
      },
      {
        wrapper: ({ children }) => (
          <MotionConfig reducedMotion="never">{children}</MotionConfig>
        ),
      },
    );

    expect(result.current.motion.travelSteps).toBe(0);
    act(() => result.current.setSelectedIndex(1));
    expect(result.current.motion.travelSteps).toBe(1);
    act(() => result.current.setSelectedIndex(6));
    expect(result.current.motion.travelSteps).toBe(5);
    expect(result.current.motion.transition).toMatchObject({
      visualDuration: 0.46,
    });
  });
});
