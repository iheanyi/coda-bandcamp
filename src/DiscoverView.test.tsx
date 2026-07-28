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
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onTogglePlayback = playback.onTogglePlayback ?? vi.fn();
  return {
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
