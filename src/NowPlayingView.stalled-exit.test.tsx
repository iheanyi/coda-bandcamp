import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import React, { type ComponentProps, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Drawer } from "@/components/ui/drawer";
import { createPlaybackClock } from "@/playbackClock";
import { createCodaMemoryRouter } from "@/router";
import type { Track } from "@/types";

import { NowPlayingView } from "./NowPlayingView";

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
  span: React.forwardRef<
    HTMLSpanElement,
    React.HTMLAttributes<HTMLSpanElement> & {
      animate?: unknown;
      exit?: unknown;
      initial?: unknown;
      onAnimationComplete?: () => void;
    }
  >(function StalledMotionSpan(
    {
      animate: _animate,
      exit: _exit,
      initial: _initial,
      onAnimationComplete: _onAnimationComplete,
      ...props
    },
    ref,
  ) {
    return <span ref={ref} {...props} />;
  }),
}));

const currentTrack: Track = {
  id: "track-current",
  title: "Static Bloom",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-current",
  duration: 240,
  track: 1,
  palette: ["#6f6d86", "#1a1b25"],
};

const upcomingTrack: Track = {
  ...currentTrack,
  id: "track-upcoming",
  title: "Afterimage",
  albumId: "album-upcoming",
  track: 2,
};

const noOp = vi.fn();

function nowPlayingProps(
  queue: readonly Track[],
): ComponentProps<typeof NowPlayingView> {
  return {
    track: currentTrack,
    radioTimeline: [],
    queue: [...queue],
    currentIndex: 0,
    playing: false,
    playbackClock: createPlaybackClock(0),
    duration: currentTrack.duration,
    volume: 0.7,
    repeat: "off",
    artwork: <span>Artwork</span>,
    airPlayAvailable: false,
    queueOpen: false,
    onBack: noOp,
    onToggle: noOp,
    onPrevious: noOp,
    onNext: noOp,
    canPrevious: false,
    canNext: false,
    onSeek: noOp,
    onVolume: noOp,
    onRepeat: noOp,
    onAirPlay: noOp,
    onArtist: noOp,
    onAlbum: noOp,
    onPlayQueueIndex: noOp,
    onRadioSeries: noOp,
    recommendationLoading: false,
    onPlayRecommendation: noOp,
    onAnotherRecommendation: noOp,
  };
}

function renderNowPlaying(ui: ReactNode) {
  const router = createCodaMemoryRouter(new QueryClient(), ["/now-playing"]);
  return render(ui, {
    wrapper: ({ children }) => (
      <RouterContextProvider router={router}>
        <Drawer>{children}</Drawer>
      </RouterContextProvider>
    ),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("NowPlayingView stalled panel exits", () => {
  it("removes the old Up Next panel after the bounded exit watchdog", async () => {
    vi.useFakeTimers();
    const { rerender } = renderNowPlaying(
      <NowPlayingView
        {...nowPlayingProps([currentTrack, upcomingTrack])}
      />,
    );

    const oldPanel = screen
      .getByRole("button", { name: "Play Afterimage" })
      .closest<HTMLElement>(".grid-cols-2");
    expect(oldPanel).not.toBeNull();
    rerender(<NowPlayingView {...nowPlayingProps([currentTrack])} />);

    const newPanel = screen.getByText("You reached the end.").parentElement;
    expect(newPanel).not.toBeNull();
    const panelStack = newPanel?.parentElement;
    expect(panelStack).not.toBeNull();
    expect(oldPanel).toBeInTheDocument();
    expect(oldPanel).toHaveAttribute("inert");
    expect(oldPanel).toHaveAttribute("aria-hidden", "true");
    expect(panelStack?.children).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(oldPanel).toBeInTheDocument();
    expect(panelStack?.children).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(oldPanel).not.toBeInTheDocument();
    expect(panelStack?.children).toHaveLength(1);
    expect(screen.getByText("You reached the end.")).toBeInTheDocument();
  });
});
