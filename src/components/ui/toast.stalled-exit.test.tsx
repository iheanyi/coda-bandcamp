import { act, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";

import { Toaster } from "./toast";
import { createToastManager } from "./toastManager";

vi.mock("motion/react-m", () => ({
  div: React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
      animate?: unknown;
      exit?: unknown;
      initial?: unknown;
      onAnimationComplete?: () => void;
    }
  >(function StalledMotionDiv(
    {
      animate: _animate,
      exit: _exit,
      initial: _initial,
      onAnimationComplete: _onAnimationComplete,
      ...props
    },
    ref,
  ) {
    return <div ref={ref} {...props} />;
  }),
}));

afterEach(() => {
  vi.useRealTimers();
});

describe("Toaster stalled exits", () => {
  it("makes an exiting toast inert and removes it through the bounded watchdog", async () => {
    vi.useFakeTimers();
    const toastManager = createToastManager();
    render(
      <CodaMotionProvider>
        <Toaster toastManager={toastManager} timeout={2_800} />
      </CodaMotionProvider>,
    );

    let toastId = "";
    act(() => {
      toastId = toastManager.add({
        title: "Temporary notice",
        actionProps: { children: "Retry" },
      });
    });
    expect(screen.getByText("Temporary notice")).toBeInTheDocument();

    act(() => toastManager.close(toastId));
    const exiting = document.querySelector<HTMLElement>(
      '[data-slot="toast-motion"]',
    );
    expect(exiting).toHaveAttribute("inert");
    expect(exiting).toHaveAttribute("aria-hidden", "true");
    expect(exiting).toHaveStyle({ pointerEvents: "none" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(
      document.querySelector('[data-slot="toast-motion"]'),
    ).not.toBeInTheDocument();
  });
});
