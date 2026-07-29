import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchDiscover: vi.fn(),
  openBandcampUrl: vi.fn(),
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    fetchDiscover: mocks.fetchDiscover,
    openBandcampUrl: mocks.openBandcampUrl,
  };
});

import DiscoverView from "./DiscoverView";

function renderDiscover(
  onQueue = vi.fn(),
  playback: {
    currentTrackId?: string;
    playing?: boolean;
    onTogglePlayback?: () => void;
    onOpenRelease?: () => void;
    onOpenArtist?: () => void;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onTogglePlayback = playback.onTogglePlayback ?? vi.fn();
  return {
    client,
    onQueue,
    onTogglePlayback,
    ...render(
      <QueryClientProvider client={client}>
        <DiscoverView
          onPlay={vi.fn()}
          onQueue={onQueue}
          currentTrackId={playback.currentTrackId}
          playing={playback.playing ?? false}
          onTogglePlayback={onTogglePlayback}
          onOpenRelease={playback.onOpenRelease ?? vi.fn()}
          onOpenArtist={playback.onOpenArtist ?? vi.fn()}
        />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mocks.fetchDiscover.mockReset().mockResolvedValue({
    results: [
      {
        id: "release-1",
        title: "Blue Hours",
        artist: "Signal Garden",
        location: "Chicago, Illinois",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
        featuredTrack: {
          id: "preview-1",
          title: "Glass Lines",
          duration: 201,
          streamUrl: "https://t4.bcbits.com/stream/example",
        },
      },
    ],
    resultCount: 1,
    hasMore: false,
  });
});

describe("Discover", () => {
  it("disables Discover controls while the initiating request is pending", async () => {
    let resolveDiscover!: (value: {
      results: [];
      resultCount: number;
      hasMore: boolean;
    }) => void;
    mocks.fetchDiscover.mockReturnValue(new Promise((resolve) => {
      resolveDiscover = resolve;
    }));
    renderDiscover();

    expect(await screen.findByRole("button", { name: "Exploring…" })).toBeDisabled();
    const skeleton = document.querySelector('[data-slot="skeleton"]');
    expect(skeleton).toBeInTheDocument();
    expect(skeleton).toHaveClass("motion-reduce:animate-none");
    expect(screen.getByRole("button", { name: "All genres" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Best-selling" })).toBeDisabled();

    resolveDiscover({ results: [], resultCount: 0, hasMore: false });
    expect(await screen.findByText("No releases found")).toBeInTheDocument();
  });

  it("loads previews, queues a result, and supports the full genre selector", async () => {
    const { onQueue } = renderDiscover();

    expect(await screen.findByText("Blue Hours")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add to queue/ }));
    expect(onQueue).toHaveBeenCalledWith(expect.objectContaining({
      id: "preview-1",
      album: "Blue Hours",
    }));

    fireEvent.change(screen.getByLabelText("More Discover genres"), {
      target: { value: "jazz" },
    });
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "jazz" }),
        "*",
      ),
    );
    expect(await screen.findByText("Jazz · Chicago, Illinois")).toBeInTheDocument();
  });

  it("routes a release name to the internal Discover detail handler", async () => {
    const onOpenRelease = vi.fn();
    renderDiscover(vi.fn(), { onOpenRelease });

    fireEvent.click(await screen.findByRole("button", { name: "Blue Hours" }));

    expect(onOpenRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "release-1",
        title: "Blue Hours",
      }),
      expect.any(HTMLButtonElement),
    );
    expect(mocks.openBandcampUrl).not.toHaveBeenCalled();
  });

  it("routes release artwork to the same internal Discover detail handler", async () => {
    const onOpenRelease = vi.fn();
    renderDiscover(vi.fn(), { onOpenRelease });

    fireEvent.click(await screen.findByRole("button", {
      name: "Open Blue Hours Discover details",
    }));

    expect(onOpenRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "release-1",
        title: "Blue Hours",
      }),
      expect.any(HTMLButtonElement),
    );
    expect(mocks.openBandcampUrl).not.toHaveBeenCalled();
  });

  it("routes an artist name to the external Discover artist handler", async () => {
    const onOpenArtist = vi.fn();
    renderDiscover(vi.fn(), { onOpenArtist });

    fireEvent.click(await screen.findByRole("button", { name: "Signal Garden" }));

    expect(onOpenArtist).toHaveBeenCalledWith(expect.objectContaining({
      id: "release-1",
      artist: "Signal Garden",
    }));
    expect(mocks.openBandcampUrl).not.toHaveBeenCalled();
  });

  it("queries Hip-Hop/Rap with Bandcamp's canonical genre tag", async () => {
    renderDiscover();

    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "Hip-Hop/Rap" }));

    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "hip-hop-rap" }),
        "*",
      ),
    );
  });

  it("exposes the active genre and sort as pressed controls", async () => {
    renderDiscover();

    await screen.findByText("Blue Hours");
    const allGenres = screen.getByRole("button", { name: "All genres" });
    const bestSelling = screen.getByRole("button", { name: "Best-selling" });
    expect(allGenres).toHaveAttribute("aria-pressed", "true");
    expect(bestSelling).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Rock" }));
    expect(screen.getByRole("button", { name: "Rock" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(allGenres).toHaveAttribute("aria-pressed", "false");

    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "rock" }),
        "*",
      ),
    );
    const newArrivals = screen.getByRole("button", { name: "New arrivals" });
    await waitFor(() => expect(newArrivals).not.toBeDisabled());
    fireEvent.click(newArrivals);
    expect(newArrivals).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(bestSelling).toHaveAttribute("aria-pressed", "false");
  });

  it("normalizes a typed genre before controlling the active genre chip", async () => {
    renderDiscover();

    await screen.findByText("Blue Hours");
    fireEvent.change(screen.getByLabelText("Search Discover by tag"), {
      target: { value: "ROCK" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Explore" }));

    expect(screen.getByRole("button", { name: "Rock" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("appends the next page of discoveries using the returned cursor", async () => {
    mocks.fetchDiscover
      .mockResolvedValueOnce({
        results: [{
          id: "release-1",
          title: "Blue Hours",
          artist: "Signal Garden",
          location: "Chicago, Illinois",
          itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
        }],
        resultCount: 2,
        hasMore: true,
        cursor: "next-page",
      })
      .mockResolvedValueOnce({
        results: [{
          id: "release-2",
          title: "Amber Transit",
          artist: "Signal Garden",
          location: "Chicago, Illinois",
          itemUrl: "https://signal-garden.bandcamp.com/album/amber-transit",
        }],
        resultCount: 2,
        hasMore: false,
      });
    renderDiscover();

    await screen.findByText("Blue Hours");
    fireEvent.click(screen.getByRole("button", { name: "View more discoveries" }));

    expect(await screen.findByText("Amber Transit")).toBeInTheDocument();
    expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
      expect.objectContaining({ tag: "", sort: "top" }),
      "next-page",
    );
  });

  it("keeps prior discoveries visible when their revalidation fails", async () => {
    mocks.fetchDiscover.mockResolvedValueOnce({
      results: [{
        id: "release-1",
        title: "Blue Hours",
        artist: "Signal Garden",
        location: "Chicago, Illinois",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
      }],
      resultCount: 1,
      hasMore: false,
    }).mockRejectedValueOnce(new Error("Network unavailable"));
    const { client } = renderDiscover();

    await screen.findByText("Blue Hours");
    await client.invalidateQueries({ queryKey: ["discover"] });

    expect(await screen.findByText("Blue Hours")).toBeInTheDocument();
  });

  it("keeps the active preview control visible and matched to playback", async () => {
    const { onTogglePlayback } = renderDiscover(vi.fn(), {
      currentTrackId: "preview-1",
      playing: true,
    });

    await screen.findByText("Blue Hours");
    const pause = screen.getByRole("button", { name: "Pause Glass Lines" });
    expect(pause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pause);
    expect(onTogglePlayback).toHaveBeenCalledOnce();
  });
});
