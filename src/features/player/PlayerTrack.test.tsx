import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createPlaybackClock } from "@/playbackClock";
import { createCodaMemoryRouter } from "@/router";
import type { Track } from "@/types";
import { PlayerTrack } from "./PlayerTrack";

const track: Track = {
  album: "Soft Focus",
  albumId: "album-22",
  artist: "Night Archive",
  duration: 180,
  id: "track-22",
  palette: ["#777", "#222"],
  title: "Static Bloom",
  track: 1,
};

describe("PlayerTrack semantic navigation", () => {
  it("marks the compact track identity and keeps artwork navigation semantic", async () => {
    const onNowPlaying = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);
    await router.load();
    const { container } = render(
      <RouterContextProvider router={router}>
        <PlayerTrack
          albumLoading={false}
          favorite={false}
          getRadioChapterLocalLinks={() => ({})}
          onAlbum={vi.fn()}
          onArtist={vi.fn()}
          onNowPlaying={onNowPlaying}
          onOpenRadioItem={vi.fn()}
          onToggleFavorite={vi.fn()}
          playbackClock={createPlaybackClock(track.duration)}
          radioTimeline={[]}
          track={track}
        />
      </RouterContextProvider>,
    );

    const artworkLink = screen.getByRole("link", {
      name: "Open Now Playing",
    });
    expect(artworkLink).toHaveAttribute("href", "/now-playing");
    expect(artworkLink).toHaveAttribute("data-coda-track-id", track.id);
    expect(screen.getByText(track.title)).toHaveAttribute(
      "data-coda-now-playing-title-compact",
      track.id,
    );

    fireEvent.click(artworkLink);
    expect(onNowPlaying).toHaveBeenCalledOnce();
    expect(
      container.querySelector("a button, button a"),
    ).not.toBeInTheDocument();
  });
});
