import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoverReleaseDetail } from "./DiscoverReleaseDetail";
import type { DiscoverRelease } from "./types";

const release: DiscoverRelease = {
  id: "discover:release-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  location: "Chicago, Illinois",
  genre: "Rock",
  itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
  artworkUrl: "https://f4.bcbits.com/img/blue-hours.jpg",
  featuredTrack: {
    id: "discover:preview-1",
    title: "Glass Lines",
    duration: 201,
    streamUrl: "https://t4.bcbits.com/stream/blue-hours",
  },
};

describe("DiscoverReleaseDetail", () => {
  it("shows release metadata and routes every release action explicitly", () => {
    const onPlay = vi.fn();
    const onQueue = vi.fn();
    const onArtist = vi.fn();
    const onOpenBandcamp = vi.fn();
    const onTogglePlayback = vi.fn();
    const { rerender } = render(
      <DiscoverReleaseDetail
        release={release}
        playing={false}
        onBack={vi.fn()}
        onPlay={onPlay}
        onQueue={onQueue}
        onTogglePlayback={onTogglePlayback}
        onArtist={onArtist}
        onOpenBandcamp={onOpenBandcamp}
      />,
    );

    let detail = screen.getByRole("article", {
      name: "Blue Hours",
    });
    expect(within(detail).getByRole("heading", { name: "Blue Hours" }))
      .toBeInTheDocument();
    expect(within(detail).getByText("Chicago, Illinois")).toBeInTheDocument();
    expect(within(detail).getByText("Rock")).toBeInTheDocument();
    expect(detail.querySelector("img")).toHaveAttribute(
      "src",
      release.artworkUrl,
    );

    fireEvent.click(within(detail).getByRole("button", {
      name: "Signal Garden",
    }));
    fireEvent.click(within(detail).getAllByRole("button", {
      name: "Play Glass Lines",
    })[0]);
    fireEvent.click(within(detail).getByRole("button", {
      name: "Add to queue",
    }));
    fireEvent.click(within(detail).getByRole("button", {
      name: "Open on Bandcamp",
    }));

    expect(onArtist).toHaveBeenCalledWith(release);
    expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({
      id: "discover:preview-1",
      discoverRelease: release,
    }));
    expect(onQueue).toHaveBeenCalledWith(expect.objectContaining({
      id: "discover:preview-1",
      discoverRelease: release,
    }));
    expect(onOpenBandcamp).toHaveBeenCalledWith(release.itemUrl);

    rerender(
      <DiscoverReleaseDetail
        release={release}
        currentTrackId="discover:preview-1"
        playing
        onBack={vi.fn()}
        onPlay={onPlay}
        onQueue={onQueue}
        onTogglePlayback={onTogglePlayback}
        onArtist={onArtist}
        onOpenBandcamp={onOpenBandcamp}
      />,
    );
    detail = screen.getByRole("article", {
      name: "Blue Hours",
    });
    fireEvent.click(within(detail).getAllByRole("button", {
      name: "Pause Glass Lines",
    })[0]);

    expect(onTogglePlayback).toHaveBeenCalledTimes(1);
  });
});
