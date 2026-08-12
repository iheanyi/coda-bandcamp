import { act, render, screen } from "@testing-library/react";
import { AnimatePresence } from "motion/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";

import { AlbumTracklistPresence } from "./AlbumDetailPage";

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

function TracklistState({ state }: Readonly<{ state: string }>) {
  return (
    <CodaMotionProvider>
      <AnimatePresence initial={false}>
        <AlbumTracklistPresence key={state}>
          <span>{state}</span>
        </AlbumTracklistPresence>
      </AnimatePresence>
    </CodaMotionProvider>
  );
}

describe("AlbumTracklistPresence stalled exits", () => {
  it("forcibly removes the old tracklist after 500 ms without leaving layout space", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<TracklistState state="Old tracklist" />);

    rerender(<TracklistState state="New tracklist" />);
    const exiting = screen.getByText("Old tracklist").parentElement;
    expect(exiting).toHaveAttribute("inert");
    expect(exiting).toHaveAttribute("aria-hidden", "true");
    expect(exiting).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByText("New tracklist")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(screen.getByText("Old tracklist")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByText("Old tracklist")).not.toBeInTheDocument();
    expect(screen.getByText("New tracklist")).toBeInTheDocument();
  });
});
