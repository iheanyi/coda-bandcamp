import { act, render, screen } from "@testing-library/react";
import { AnimatePresence } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MotionExitPresence,
  type MotionExitElementProps,
} from "./MotionExitPresence";

function StalledMotionElement({
  "aria-hidden": ariaHidden,
  children,
  className,
  "data-slot": dataSlot,
  inert,
  style,
}: MotionExitElementProps) {
  return (
    <div
      aria-hidden={ariaHidden}
      className={className}
      data-slot={dataSlot}
      inert={inert}
      style={style}
    >
      {children}
    </div>
  );
}

function PresenceState({ state }: Readonly<{ state: string }>) {
  return (
    <AnimatePresence initial={false}>
      <MotionExitPresence
        key={state}
        data-slot="presence"
        motionComponent={StalledMotionElement}
        style={{ pointerEvents: "auto" }}
      >
        <span>{state}</span>
      </MotionExitPresence>
    </AnimatePresence>
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("MotionExitPresence", () => {
  it("makes stalled exits inert and removes them after the watchdog bound", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<PresenceState state="Old content" />);

    rerender(<PresenceState state="New content" />);
    const exiting = screen.getByText("Old content").parentElement;
    expect(exiting).toHaveAttribute("inert");
    expect(exiting).toHaveAttribute("aria-hidden", "true");
    expect(exiting).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByText("New content").parentElement).toHaveStyle({
      pointerEvents: "auto",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(screen.getByText("Old content")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByText("Old content")).not.toBeInTheDocument();
    expect(screen.getByText("New content")).toBeInTheDocument();
  });
});
