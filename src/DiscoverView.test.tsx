import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  mocks.openBandcampUrl.mockReset();
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
    expect(screen.getByRole("button", { name: "All genres" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Best-selling" })).toBeDisabled();

    resolveDiscover({ results: [], resultCount: 0, hasMore: false });
    expect(await screen.findByText("No releases found")).toBeInTheDocument();
  });

  it("loads previews, queues a result, and supports the full genre selector", async () => {
    const user = userEvent.setup();
    const { onQueue } = renderDiscover();

    expect(await screen.findByText("Blue Hours")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add to queue/ }));
    expect(onQueue).toHaveBeenCalledWith(expect.objectContaining({
      id: "preview-1",
      album: "Blue Hours",
    }));

    const genreSelect = screen.getByRole("combobox", {
      name: "More Discover genres",
    });

    await user.click(genreSelect);
    await user.click(await screen.findByRole("option", { name: "Jazz" }));
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "jazz" }),
        "*",
      ),
    );
  });

  it("routes release and artist destinations through their explicit handlers", async () => {
    const onOpenArtist = vi.fn();
    const onOpenRelease = vi.fn();
    renderDiscover(vi.fn(), { onOpenArtist, onOpenRelease });

    const title = await screen.findByRole("button", { name: "Blue Hours" });
    fireEvent.click(title);
    expect(onOpenRelease).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "release-1",
        title: "Blue Hours",
      }),
      title,
    );

    const artwork = screen.getByRole("button", {
      name: "Open Blue Hours Discover details",
    });
    fireEvent.click(artwork);
    expect(onOpenRelease).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "release-1",
        title: "Blue Hours",
      }),
      artwork,
    );
    expect(mocks.openBandcampUrl).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Signal Garden" }));

    expect(onOpenArtist).toHaveBeenCalledWith(expect.objectContaining({
      id: "release-1",
      artist: "Signal Garden",
    }));
    expect(mocks.openBandcampUrl).not.toHaveBeenCalled();
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
