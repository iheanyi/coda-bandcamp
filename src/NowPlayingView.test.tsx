import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openBandcampUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    openBandcampUrl: mocks.openBandcampUrl,
  };
});

import { NowPlayingView } from "./NowPlayingView";
import type { Track } from "./types";

const radioTrack: Track = {
  id: "radio:979",
  title: "The Hip Hop Show",
  artist: "Bandcamp Radio",
  album: "Kinrose",
  albumId: "radio:979",
  duration: 4_937,
  track: 1,
  palette: ["#234", "#112"],
  radioChapters: [
    {
      title: "Mirage",
      artist: "Sweeps",
      album: "Mirage",
      timecode: 30,
      itemUrl: "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
      artistUrl: "https://sweepsbeats.bandcamp.com/",
      albumUrl: "https://sweepsbeats.bandcamp.com/album/mirage",
      artworkUrl: "https://f4.bcbits.com/img/0161226005_10.jpg",
    },
    { title: "Night Drive", artist: "Keylime", timecode: 120 },
  ],
};

describe("NowPlayingView Radio metadata", () => {
  it("announces the currently airing chapter and its successor", () => {
    const noOp = vi.fn();
    const onSeek = vi.fn();
    render(
      <NowPlayingView
        track={radioTrack}
        queue={[radioTrack]}
        currentIndex={0}
        playing
        currentTime={45}
        duration={radioTrack.duration}
        volume={0.7}
        repeat="off"
        artwork={<span>Artwork</span>}
        airPlayAvailable={false}
        queueOpen={false}
        onBack={noOp}
        onToggle={noOp}
        onPrevious={noOp}
        onNext={noOp}
        canPrevious
        canNext
        onSeek={onSeek}
        onVolume={noOp}
        onRepeat={noOp}
        onAirPlay={noOp}
        onToggleQueue={noOp}
        onArtist={noOp}
        onAlbum={noOp}
        onPlayQueueIndex={noOp}
      />,
    );

    const currentlyAiring = screen.getByRole("region", {
      name: "Currently airing on Bandcamp Radio",
    });
    expect(currentlyAiring).toHaveTextContent("Mirage");
    expect(currentlyAiring).toHaveTextContent("Sweeps");
    expect(currentlyAiring).toHaveTextContent("Up next: Night Drive by Keylime");

    const onAirTitle = within(currentlyAiring).getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    });
    fireEvent.click(onAirTitle);
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Open The Hip Hop Show on Bandcamp Radio",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://bandcamp.com/radio?show=979",
    );

    const chapterList = document.querySelector(".now-playing__radio-chapters");
    expect(chapterList).not.toBeNull();
    const currentTitle = within(chapterList as HTMLElement).getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    });
    expect(currentTitle.closest("li")).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("Up next", { selector: ".now-playing__radio-state" }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", {
      name: "Seek to Mirage at 0:30",
    }));
    expect(onSeek).toHaveBeenCalledWith(30);

    fireEvent.click(currentTitle);
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
    );

    fireEvent.click(within(chapterList as HTMLElement).getByRole("button", {
      name: "Open artist Sweeps on Bandcamp",
    }));
    fireEvent.click(within(chapterList as HTMLElement).getByRole("button", {
      name: "Open album Mirage on Bandcamp",
    }));
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/",
    );
    expect(mocks.openBandcampUrl).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/album/mirage",
    );
    expect(document.querySelector(".radio-chapter-artwork img")).toHaveAttribute(
      "src",
      "https://f4.bcbits.com/img/0161226005_10.jpg",
    );
  });
});
