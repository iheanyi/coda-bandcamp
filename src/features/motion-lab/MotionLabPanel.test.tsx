import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  getMotionProfileState,
  resetMotionProfileStoreForTests,
} from "@/motionProfileStore";
import { MotionLabPanel } from "./MotionLabPanel";

describe("MotionLabPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetMotionProfileStoreForTests();
  });

  it("renders as a fixed non-modal overlay without wrapping app content", () => {
    const appContent = document.createElement("audio");
    document.body.append(appContent);
    const { rerender } = render(
      <MotionLabPanel open={false} onOpenChange={() => undefined} />,
    );
    const originalAudio = document.querySelector("audio");
    rerender(<MotionLabPanel open onOpenChange={() => undefined} />);

    const panel = screen.getByRole("dialog", { name: "Motion Lab" });
    expect(panel).toHaveAttribute("aria-modal", "false");
    expect(panel).toHaveClass("fixed");
    expect(document.querySelector("audio")).toBe(originalAudio);
  });

  it("applies presets and live speed changes to persisted profile state", () => {
    render(<MotionLabPanel open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Motion preset"), {
      target: { value: "elastic" },
    });
    expect(getMotionProfileState().activePresetId).toBe("elastic");

    fireEvent.change(screen.getByLabelText("Inspection speed"), {
      target: { value: "0.4" },
    });
    expect(getMotionProfileState().profile.speed).toBe(0.4);
    expect(getMotionProfileState().activePresetId).toBeNull();
    expect(window.localStorage.getItem("coda.motion-lab.v1")).toContain(
      '"speed":0.4',
    );
  });
});
