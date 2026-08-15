import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { Drawer } from "@/components/ui/drawer";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  PlaybackQueueTrack,
  PlaybackRuntimeController,
} from "@/features/playback-runtime/types";
import { createPlaybackClock } from "@/playbackClock";
import { createCodaMemoryRouter } from "@/router";

import { PersistentPlayerDock } from "./PersistentPlayerDock";

const track: PlaybackQueueTrack = {
  album: "Soft Focus",
  albumId: "album-22",
  artist: "Night Archive",
  duration: 180,
  id: "track-22",
  palette: ["#777", "#222"],
  title: "Static Bloom",
  track: 1,
};

function playbackController(
  currentTrack: PlaybackQueueTrack,
): PlaybackRuntimeController {
  return {
    queue: {
      queue: [currentTrack],
      currentIndex: 0,
      currentTrack,
      currentRadioTimeline: [],
      open: false,
      ready: true,
      hasDeferredTracks: false,
    },
    transport: {
      playing: true,
      volume: 0.75,
      repeat: "all",
      canPrevious: true,
      canNext: false,
      airPlayAvailable: false,
    },
    queueCommands: {
      playTrack: vi.fn(),
      playTrackAt: vi.fn(),
      playTracks: vi.fn(),
      queueTrack: vi.fn(),
      queueTracks: vi.fn(),
      playQueueIndex: vi.fn(),
      removeQueueItem: vi.fn(),
      clearQueue: vi.fn(),
      shuffleQueue: vi.fn(),
      moveQueueItem: vi.fn(),
      setOpen: vi.fn(),
    },
    transportCommands: {
      toggle: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      previous: vi.fn(),
      next: vi.fn(),
      seek: vi.fn(),
      setVolume: vi.fn(),
      cycleRepeat: vi.fn(),
      openAirPlay: vi.fn(),
    },
    sessionCommands: {
      checkpoint: vi.fn(async () => true),
      clear: vi.fn(async () => undefined),
      reset: vi.fn(),
      setReady: vi.fn(),
    },
    shuffle: {
      activeArtistScopeKey: undefined,
      progress: undefined,
      hasMore: false,
      cancel: vi.fn(),
      shuffle: vi.fn(),
    },
    playbackClock: createPlaybackClock(currentTrack.duration),
    audioElement: null,
  };
}

describe("PersistentPlayerDock", () => {
  it("keeps compact artwork mounted and out of AX while Now Playing is open", async () => {
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);
    await router.load();
    const playback = playbackController(track);
    const queueControlRef = createRef<HTMLButtonElement>();

    const { container, rerender } = render(
      <RouterContextProvider router={router}>
        <TooltipProvider>
          <Drawer>
            <PersistentPlayerDock
              favorites={{
                onAddToPlaylist: vi.fn(),
                onToggleCurrent: vi.fn(),
                radioShowIds: new Set(),
                trackIds: new Set(),
              }}
              getRadioChapterLocalLinks={() => ({})}
              navigation={{
                onAlbum: vi.fn(),
                onArtist: vi.fn(),
                onNowPlaying: vi.fn(),
                onOpenRadioItem: vi.fn(),
              }}
              nowPlayingOpen
              playback={playback}
              queueControlRef={queueControlRef}
              visible={false}
            />
          </Drawer>
        </TooltipProvider>
      </RouterContextProvider>,
    );

    const hiddenArtwork = container.querySelector(".player__art-link");
    expect(hiddenArtwork).not.toBeNull();
    expect(
      hiddenArtwork?.closest("[data-slot='player-dock-hidden']"),
    ).not.toHaveAttribute("hidden");
    expect(
      hiddenArtwork?.closest("[data-slot='player-dock-hidden']"),
    ).toHaveClass("invisible");
    expect(
      screen.queryByRole("link", { name: "Open Now Playing" }),
    ).not.toBeInTheDocument();

    rerender(
      <RouterContextProvider router={router}>
        <TooltipProvider>
          <Drawer>
            <PersistentPlayerDock
              favorites={{
                onAddToPlaylist: vi.fn(),
                onToggleCurrent: vi.fn(),
                radioShowIds: new Set(),
                trackIds: new Set(),
              }}
              getRadioChapterLocalLinks={() => ({})}
              navigation={{
                onAlbum: vi.fn(),
                onArtist: vi.fn(),
                onNowPlaying: vi.fn(),
                onOpenRadioItem: vi.fn(),
              }}
              nowPlayingOpen={false}
              playback={playback}
              queueControlRef={queueControlRef}
              visible
            />
          </Drawer>
        </TooltipProvider>
      </RouterContextProvider>,
    );

    const restoredArtwork = screen.getByRole("link", {
      name: "Open Now Playing",
    });
    expect(restoredArtwork).toBe(hiddenArtwork);
  });
});
