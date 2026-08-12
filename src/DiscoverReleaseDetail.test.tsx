import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  DiscoverReleaseDetail,
  DiscoverReleaseScreen,
} from "./DiscoverReleaseDetail";
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
  it("exposes a semantic route screen without changing detail focus", () => {
    render(
      <DiscoverReleaseScreen
        className="route-detail"
        release={release}
        playing={false}
        onBack={vi.fn()}
        onPlay={vi.fn()}
        onQueue={vi.fn()}
        onTogglePlayback={vi.fn()}
        onArtist={vi.fn()}
        onOpenBandcamp={vi.fn()}
      />,
    );

    expect(screen.getByRole("article", { name: "Blue Hours" }))
      .toHaveClass("route-detail");
    expect(screen.getByRole("heading", { name: "Blue Hours" })).toHaveFocus();
  });

  it("routes release actions and switches the active preview to pause", () => {
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
    expect(detail).toHaveAttribute("data-coda-discover-detail-surface");
    expect(
      detail.querySelector("[data-coda-discover-artwork-detail]"),
    ).toHaveAttribute(
      "data-coda-discover-artwork-detail",
      "discover:release-1",
    );
    expect(within(detail).getByRole("heading", {
      name: "Blue Hours",
    }).firstElementChild).toHaveAttribute(
      "data-coda-discover-title-detail",
      "discover:release-1",
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

  it("recovers from a failed artwork URL when release metadata supplies a new one", () => {
    const props = {
      playing: false,
      onBack: vi.fn(),
      onPlay: vi.fn(),
      onQueue: vi.fn(),
      onTogglePlayback: vi.fn(),
      onArtist: vi.fn(),
      onOpenBandcamp: vi.fn(),
    };
    const nextArtworkUrl = "https://f4.bcbits.com/img/blue-hours-fixed.jpg";
    const { container, rerender } = render(
      <DiscoverReleaseScreen {...props} release={release} />,
    );
    const artwork = container.querySelector(
      "[data-coda-discover-artwork-detail]",
    );
    const failedImage = artwork?.querySelector("img");
    if (!failedImage) throw new Error("Expected initial release artwork.");

    fireEvent.error(failedImage);
    expect(artwork?.querySelector("img")).not.toBeInTheDocument();
    expect(
      artwork?.querySelector("[data-discover-detail-artwork-fallback]"),
    ).toHaveTextContent("BH");

    rerender(
      <DiscoverReleaseScreen
        {...props}
        release={{ ...release, artworkUrl: nextArtworkUrl }}
      />,
    );
    const refreshedArtwork = container.querySelector(
      "[data-coda-discover-artwork-detail]",
    );
    const refreshedImage = refreshedArtwork?.querySelector("img");
    expect(refreshedImage).toHaveAttribute("src", nextArtworkUrl);
    expect(refreshedImage).toHaveClass("invisible");
    expect(
      refreshedArtwork?.querySelector(
        "[data-discover-detail-artwork-fallback]",
      ),
    ).toHaveTextContent("BH");

    if (!refreshedImage) throw new Error("Expected refreshed release artwork.");
    fireEvent.load(refreshedImage);
    expect(refreshedImage).not.toHaveClass("invisible");
    expect(
      refreshedArtwork?.querySelector(
        "[data-discover-detail-artwork-fallback]",
      ),
    ).not.toBeInTheDocument();
    expect(refreshedArtwork).toHaveAttribute(
      "data-coda-discover-artwork-detail",
      release.id,
    );
  });
});
