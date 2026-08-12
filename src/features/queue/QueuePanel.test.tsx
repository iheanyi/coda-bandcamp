import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { createRef } from "react";
import React from "react";
import { AnimatePresence } from "motion/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CodaMotionProvider } from "@/MotionProvider";
import { Drawer } from "@/components/ui/drawer";
import { createPlaybackClock } from "@/playbackClock";
import { createCodaMemoryRouter } from "@/router";
import type { Album, Track } from "@/types";
import { QueuePanel } from "./QueuePanel";
import { QueueCurrentPresence } from "./QueueCurrentPresence";

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
  id: "current-track",
  title: "First Light",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "soft-focus",
  duration: 180,
  track: 1,
  palette: ["#777", "#222"],
};

const queuedTrack: Track = {
  ...currentTrack,
  id: "queued-track",
  title: "Streetlight",
  album: "City Limits",
  albumId: "city-limits",
};

const recommendation: Album = {
  id: "next-album",
  title: "After Hours",
  artist: "Glass Taxi",
  songCount: 7,
  duration: 1_260,
  palette: ["#968", "#221"],
};

function linkLocation(link: HTMLElement) {
  const href = link.getAttribute("href");
  if (!href) throw new Error("Expected a semantic link href.");
  return new URL(href, "https://coda.local");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("QueuePanel recommendations", () => {
  it("forcibly removes a stalled old Now Playing card after 500 ms", async () => {
    vi.useFakeTimers();
    const renderCurrent = (trackId: string) => (
      <CodaMotionProvider>
        <AnimatePresence initial={false}>
          <QueueCurrentPresence key={trackId}>
            <span>{trackId}</span>
          </QueueCurrentPresence>
        </AnimatePresence>
      </CodaMotionProvider>
    );
    const { rerender } = render(renderCurrent("old-current"));

    rerender(renderCurrent("new-current"));
    const exiting = screen.getByText("old-current").parentElement;
    expect(exiting).toHaveAttribute("inert");
    expect(exiting).toHaveAttribute("aria-hidden", "true");
    expect(exiting).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByText("new-current")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(screen.queryByText("old-current")).not.toBeInTheDocument();
    expect(screen.getByText("new-current")).toBeInTheDocument();
  });

  it("keeps the next recommendation actionable while tracks are queued", async () => {
    const noOp = vi.fn();
    const onQueueRecommendation = vi.fn();
    const onPlay = vi.fn();
    const onAlbum = vi.fn();
    const onArtist = vi.fn();
    const onNowPlaying = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);
    await router.load();
    const preloadRoute = vi.spyOn(router, "preloadRoute");

    render(
      <RouterContextProvider router={router}>
        <CodaMotionProvider>
          <Drawer modal={false} open swipeDirection="right">
            <QueuePanel
              open
              panelRef={createRef<HTMLDivElement>()}
              finalFocus={createRef<HTMLButtonElement>()}
              queue={[currentTrack, queuedTrack]}
              currentIndex={0}
              currentTrack={currentTrack}
              hasDeferredTracks={false}
              radioTimeline={[]}
              playbackClock={createPlaybackClock(currentTrack.duration)}
              playing
              onPlay={onPlay}
              onRemove={noOp}
              onClear={noOp}
              onShuffle={noOp}
              onMove={noOp}
              onArtist={onArtist}
              onAlbum={onAlbum}
              onNowPlaying={onNowPlaying}
              onOpenRadioItem={noOp}
              getRadioChapterLocalLinks={() => ({})}
              onSeek={noOp}
              recommendation={{
                album: recommendation,
                reason: "A fresh turn from your collection",
              }}
              recommendationLoading={false}
              recommendationQueueLoading={false}
              onQueueRecommendation={onQueueRecommendation}
              onPlayRecommendation={noOp}
              onAnotherRecommendation={noOp}
              playerVisible
            />
          </Drawer>
        </CodaMotionProvider>
      </RouterContextProvider>,
    );

    const queueDialog = await screen.findByRole("dialog", { name: "Queue" });
    expect(
      await within(queueDialog).findByText("Streetlight"),
    ).toBeInTheDocument();
    expect(within(queueDialog).getByText("Try this next")).toBeInTheDocument();
    const currentTitle = within(queueDialog).getByRole("link", {
      name: "First Light",
    });
    const queuedArtwork = within(queueDialog).getByRole("link", {
      name: "Open City Limits",
    });
    const recommendationTitle = within(queueDialog).getByRole("link", {
      name: "After Hours",
    });
    expect(currentTitle).toHaveAttribute("href", "/now-playing");
    expect(linkLocation(queuedArtwork).pathname).toBe(
      "/collection/albums/city-limits",
    );
    expect(linkLocation(recommendationTitle).pathname).toBe(
      "/collection/albums/next-album",
    );

    fireEvent.focus(recommendationTitle);
    await waitFor(() => expect(preloadRoute).toHaveBeenCalledOnce());
    fireEvent.click(currentTitle);
    fireEvent.click(queuedArtwork);
    expect(onNowPlaying).toHaveBeenCalledOnce();
    expect(onAlbum).toHaveBeenCalledWith(queuedTrack, queuedArtwork);
    expect(onPlay).not.toHaveBeenCalled();

    fireEvent.click(
      within(queueDialog).getByRole("button", {
        name: "Add After Hours to queue",
      }),
    );

    expect(onQueueRecommendation).toHaveBeenCalledOnce();
    expect(
      queueDialog.querySelector("a button, button a"),
    ).not.toBeInTheDocument();
  });
});
