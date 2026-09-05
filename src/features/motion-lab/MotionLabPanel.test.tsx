import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { getMotionProfileState } from "@/motionProfileStore";
import {
  beginMotionDiagnostic,
  finishMotionDiagnostic,
  updateMotionDiagnostic,
} from "@/motionDiagnostics";
import { MotionLabPanel } from "./MotionLabPanel";

describe("MotionLabPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("applies presets and live speed changes to persisted profile state", () => {
    render(<MotionLabPanel open onOpenChange={() => undefined} />);
    expect(screen.getByRole("dialog", { name: "Motion Lab" })).toHaveAttribute(
      "aria-modal",
      "false",
    );
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

  it("does not expose controls that cannot change native detail motion", () => {
    render(<MotionLabPanel open onOpenChange={() => undefined} />);

    expect(
      screen.getByText(
        "Shared artwork and detail surfaces use fixed native, compositor-safe choreography.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "shared" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "detail" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Scale from")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Opacity from")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "component" }));
    expect(screen.getByLabelText("Scale from")).toBeVisible();
    expect(screen.getByLabelText("Opacity from")).toBeVisible();
  });

  it("shows where click-to-transition time was spent", () => {
    const id = beginMotionDiagnostic({
      kind: "album-detail",
      configuredDurationMs: 460,
      speed: 1,
      transitionClass: "coda-transition--album-detail",
      transitionNames: ["coda-album-artwork"],
      transitionClasses: ["coda-transition--album-detail"],
      sourceCount: 1,
      destinationCount: 1,
      sharedExpected: true,
    });
    updateMotionDiagnostic(id, {
      phaseTimings: {
        compositorMs: 2,
        readyMs: 172,
        updateMs: 36,
        updateStartMs: 18,
      },
    });
    finishMotionDiagnostic(id, "finished");

    render(<MotionLabPanel open onOpenChange={() => undefined} />);

    expect(screen.getByText("Coordinator → update")).toBeVisible();
    expect(screen.getByText("Source feedback queued / paint")).toBeVisible();
    expect(screen.getByText("Route update")).toBeVisible();
    expect(screen.getByText("Router nav / render / release")).toBeVisible();
    expect(screen.getByText("React actual / base")).toBeVisible();
    expect(screen.getByText("Native ready")).toBeVisible();
    expect(screen.getByText("Entrance starts")).toBeVisible();
    expect(screen.getByText("18ms")).toBeVisible();
    expect(screen.getByText("36ms")).toBeVisible();
    expect(screen.getAllByText("172ms")).toHaveLength(2);
    expect(screen.getByText("2ms")).toBeVisible();
  });
});
