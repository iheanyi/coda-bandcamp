import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { createRef, useState } from "react";
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
import { moveItem } from "@/queue";
import { createCodaMemoryRouter } from "@/router";
import type { Album, Track } from "@/types";
import { QueuePanel } from "./QueuePanel";
import { QueueCurrentPresence } from "./QueueCurrentPresence";

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

const laterQueuedTrack: Track = {
  ...currentTrack,
  id: "later-queued-track",
  title: "Night Bus",
  album: "Late Routes",
  albumId: "late-routes",
};

const finalQueuedTrack: Track = {
  ...currentTrack,
  id: "final-queued-track",
  title: "Last Train",
  album: "Terminal",
  albumId: "terminal",
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
  it("completes the normal old Now Playing exit before the watchdog", async () => {
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
      await vi.advanceTimersByTimeAsync(499);
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

  it("shows a drop slot on the destination queue row while dragging", async () => {
    const noOp = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);
    await router.load();

    render(
      <RouterContextProvider router={router}>
        <CodaMotionProvider>
          <Drawer modal={false} open swipeDirection="right">
            <QueuePanel
              open
              panelRef={createRef<HTMLDivElement>()}
              finalFocus={createRef<HTMLButtonElement>()}
              queue={[currentTrack, queuedTrack, laterQueuedTrack]}
              currentIndex={0}
              currentTrack={currentTrack}
              hasDeferredTracks={false}
              radioTimeline={[]}
              playbackClock={createPlaybackClock(currentTrack.duration)}
              playing
              onPlay={noOp}
              onRemove={noOp}
              onClear={noOp}
              onShuffle={noOp}
              onMove={noOp}
              onArtist={noOp}
              onAlbum={noOp}
              onNowPlaying={noOp}
              onOpenRadioItem={noOp}
              getRadioChapterLocalLinks={() => ({})}
              onSeek={noOp}
              recommendationLoading={false}
              recommendationQueueLoading={false}
              onQueueRecommendation={noOp}
              onPlayRecommendation={noOp}
              onAnotherRecommendation={noOp}
              playerVisible
            />
          </Drawer>
        </CodaMotionProvider>
      </RouterContextProvider>,
    );

    const queueDialog = await screen.findByRole("dialog", { name: "Queue" });
    await within(queueDialog).findByText("Streetlight");
    const from = within(queueDialog)
      .getByRole("button", { name: "Streetlight" })
      .closest<HTMLElement>('[role="listitem"]');
    const to = within(queueDialog)
      .getByRole("button", { name: "Night Bus" })
      .closest<HTMLElement>('[role="listitem"]');
    if (!from || !to) throw new Error("Expected draggable queue rows");

    fireEvent.dragStart(from, {
      dataTransfer: { dropEffect: "none", effectAllowed: "none" },
    });
    fireEvent.dragOver(to, {
      dataTransfer: { dropEffect: "none", effectAllowed: "move" },
    });

    const dropSlot = to.querySelector("[data-queue-drop-slot]");
    expect(dropSlot).toHaveAttribute("data-drop-target", "true");
    expect(
      dropSlot?.querySelector('[data-queue-drop-marker][data-visible="true"]'),
    ).not.toBeNull();

    fireEvent.dragEnd(from);

    expect(dropSlot).not.toHaveAttribute("data-drop-target");
    expect(
      queueDialog.querySelector('[data-queue-drop-marker][data-visible="true"]'),
    ).toBeNull();
  });

  it("inserts a downward row drop before the visible queue target", async () => {
    const noOp = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);
    await router.load();

    function StatefulQueuePanel() {
      const [queue, setQueue] = useState([
        currentTrack,
        queuedTrack,
        laterQueuedTrack,
        finalQueuedTrack,
      ]);

      return (
        <RouterContextProvider router={router}>
          <CodaMotionProvider>
            <Drawer modal={false} open swipeDirection="right">
              <QueuePanel
                open
                panelRef={createRef<HTMLDivElement>()}
                finalFocus={createRef<HTMLButtonElement>()}
                queue={queue}
                currentIndex={0}
                currentTrack={currentTrack}
                hasDeferredTracks={false}
                radioTimeline={[]}
                playbackClock={createPlaybackClock(currentTrack.duration)}
                playing
                onPlay={noOp}
                onRemove={noOp}
                onClear={noOp}
                onShuffle={noOp}
                onMove={(from, to) =>
                  setQueue((currentQueue) => moveItem(currentQueue, from, to))
                }
                onArtist={noOp}
                onAlbum={noOp}
                onNowPlaying={noOp}
                onOpenRadioItem={noOp}
                getRadioChapterLocalLinks={() => ({})}
                onSeek={noOp}
                recommendationLoading={false}
                recommendationQueueLoading={false}
                onQueueRecommendation={noOp}
                onPlayRecommendation={noOp}
                onAnotherRecommendation={noOp}
                playerVisible
              />
            </Drawer>
          </CodaMotionProvider>
        </RouterContextProvider>
      );
    }

    render(<StatefulQueuePanel />);

    const queueDialog = await screen.findByRole("dialog", { name: "Queue" });
    const upcomingRegion = within(queueDialog).getByRole("region", {
      name: "Upcoming tracks",
    });
    await within(upcomingRegion).findByText("Last Train");
    const from = within(upcomingRegion)
      .getByRole("button", { name: "Streetlight" })
      .closest<HTMLElement>('[role="listitem"]');
    const to = within(upcomingRegion)
      .getByRole("button", { name: "Last Train" })
      .closest<HTMLElement>('[role="listitem"]');
    if (!from || !to) throw new Error("Expected draggable queue rows");
    vi.spyOn(to, "getBoundingClientRect").mockReturnValue({
      bottom: 60,
      height: 60,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    });

    fireEvent.dragStart(from, {
      dataTransfer: { dropEffect: "none", effectAllowed: "none" },
    });
    fireEvent.dragOver(to, {
      dataTransfer: { dropEffect: "none", effectAllowed: "move" },
    });
    fireEvent.drop(to);

    await waitFor(() => {
      const rows = within(upcomingRegion).getAllByRole("listitem");
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("Night Bus"),
        expect.stringContaining("Streetlight"),
        expect.stringContaining("Last Train"),
      ]);
    });
  });

  it("moves a row to the last queue position from the final row after slot", async () => {
    const noOp = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);
    await router.load();

    function StatefulQueuePanel() {
      const [queue, setQueue] = useState([
        currentTrack,
        queuedTrack,
        laterQueuedTrack,
        finalQueuedTrack,
      ]);

      return (
        <RouterContextProvider router={router}>
          <CodaMotionProvider>
            <Drawer modal={false} open swipeDirection="right">
              <QueuePanel
                open
                panelRef={createRef<HTMLDivElement>()}
                finalFocus={createRef<HTMLButtonElement>()}
                queue={queue}
                currentIndex={0}
                currentTrack={currentTrack}
                hasDeferredTracks={false}
                radioTimeline={[]}
                playbackClock={createPlaybackClock(currentTrack.duration)}
                playing
                onPlay={noOp}
                onRemove={noOp}
                onClear={noOp}
                onShuffle={noOp}
                onMove={(from, to) =>
                  setQueue((currentQueue) => moveItem(currentQueue, from, to))
                }
                onArtist={noOp}
                onAlbum={noOp}
                onNowPlaying={noOp}
                onOpenRadioItem={noOp}
                getRadioChapterLocalLinks={() => ({})}
                onSeek={noOp}
                recommendationLoading={false}
                recommendationQueueLoading={false}
                onQueueRecommendation={noOp}
                onPlayRecommendation={noOp}
                onAnotherRecommendation={noOp}
                playerVisible
              />
            </Drawer>
          </CodaMotionProvider>
        </RouterContextProvider>
      );
    }

    render(<StatefulQueuePanel />);

    const queueDialog = await screen.findByRole("dialog", { name: "Queue" });
    const upcomingRegion = within(queueDialog).getByRole("region", {
      name: "Upcoming tracks",
    });
    await within(upcomingRegion).findByText("Last Train");
    const from = within(upcomingRegion)
      .getByRole("button", { name: "Streetlight" })
      .closest<HTMLElement>('[role="listitem"]');
    const to = within(upcomingRegion)
      .getByRole("button", { name: "Last Train" })
      .closest<HTMLElement>('[role="listitem"]');
    if (!from || !to) throw new Error("Expected draggable queue rows");
    vi.spyOn(to, "getBoundingClientRect").mockReturnValue({
      bottom: 60,
      height: 60,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    });

    fireEvent.dragStart(from, {
      dataTransfer: { dropEffect: "none", effectAllowed: "none" },
    });
    fireEvent.dragOver(to, {
      clientY: 59,
      dataTransfer: { dropEffect: "none", effectAllowed: "move" },
    });

    const dropSlot = to.querySelector("[data-queue-drop-slot]");
    expect(dropSlot).toHaveAttribute("data-insert", "after");
    expect(
      dropSlot?.querySelector(
        '[data-queue-drop-marker][data-visible="true"][data-insert="after"]',
      ),
    ).not.toBeNull();

    fireEvent.drop(to);

    await waitFor(() => {
      const rows = within(upcomingRegion).getAllByRole("listitem");
      expect(rows.map((row) => row.textContent)).toEqual([
        expect.stringContaining("Night Bus"),
        expect.stringContaining("Last Train"),
        expect.stringContaining("Streetlight"),
      ]);
    });
  });
});
