import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
    expect(screen.getByRole("combobox", {
      name: "Sort Discover results",
    })).toBeDisabled();

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

    const genreNavigation = screen.getByRole("navigation", {
      name: "Filter Discover by genre",
    });

    await user.click(within(genreNavigation).getByRole("button", {
      name: "Jazz",
    }));
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "jazz" }),
        "*",
      ),
    );
  });

  it("uses the Collection-style genre rail and sort menu", async () => {
    renderDiscover();

    await screen.findByText("Blue Hours");
    const genres = screen.getByRole("navigation", {
      name: "Filter Discover by genre",
    });
    expect(genres).toHaveClass("overflow-x-auto");
    expect(screen.queryByRole("combobox", {
      name: "More Discover genres",
    })).not.toBeInTheDocument();

    Object.defineProperties(genres, {
      clientWidth: { configurable: true, value: 240 },
      scrollWidth: { configurable: true, value: 720 },
    });
    fireEvent(window, new Event("resize"));
    expect(screen.getByRole("button", {
      name: "Show more genres",
    })).toBeInTheDocument();

    Object.defineProperty(genres, "scrollLeft", {
      configurable: true,
      value: 480,
      writable: true,
    });
    fireEvent.scroll(genres);
    expect(screen.getByRole("button", {
      name: "Show previous genres",
    })).toBeInTheDocument();
    expect(screen.queryByRole("button", {
      name: "Show more genres",
    })).not.toBeInTheDocument();

    expect(screen.getByRole("combobox", {
      name: "Sort Discover results",
    })).toHaveTextContent("Best-selling");
  });

  it("routes release and artist destinations through their explicit handlers", async () => {
    const onOpenArtist = vi.fn();
    const onOpenRelease = vi.fn();
    renderDiscover(vi.fn(), { onOpenArtist, onOpenRelease });

    const title = await screen.findByRole("button", { name: "Blue Hours" });
    const card = title.closest("article");
    expect(card).toHaveAttribute(
      "data-discover-release-card",
      "release-1",
    );
    expect(card?.querySelector("[data-coda-discover-artwork]")).toHaveAttribute(
      "data-coda-discover-artwork",
      "release-1",
    );
    expect(within(title).getByText("Blue Hours")).toHaveAttribute(
      "data-coda-discover-title",
      "release-1",
    );
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
    const user = userEvent.setup();
    renderDiscover();

    await screen.findByText("Blue Hours");
    const allGenres = screen.getByRole("button", { name: "All genres" });
    expect(allGenres).toHaveAttribute("aria-pressed", "true");

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
    const sort = screen.getByRole("combobox", {
      name: "Sort Discover results",
    });
    await waitFor(() => expect(sort).not.toBeDisabled());
    await user.click(sort);
    await user.click(await screen.findByRole("option", {
      name: "New arrivals",
    }));
    expect(sort).toHaveTextContent("New arrivals");
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "new" }),
        "*",
      ),
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
