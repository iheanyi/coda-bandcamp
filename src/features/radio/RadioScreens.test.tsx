import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { createPlaybackClock } from "@/playbackClock";
import { radioShowsInfiniteQueryOptions } from "@/queries/radioQueries";
import { createCodaMemoryRouter } from "@/router";
import { parseRadioShowIdParam } from "@/routing/routeContracts";
import type { RadioShow, RadioShowSummary } from "@/types";

import { RadioArtwork } from "./RadioPresentation";
import { RadioShowScreen } from "./RadioScreens";

const mocks = vi.hoisted(() => ({
  fetchRadioShow: vi.fn(),
  fetchRadioShows: vi.fn(),
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchRadioShow: mocks.fetchRadioShow,
    fetchRadioShows: mocks.fetchRadioShows,
  };
});

const show: RadioShow = {
  id: 977,
  title: "Bandcamp Weekly",
  subtitle: "Deep Focus",
  description: "An hour of patient, independent music.",
  publishedAt: "24 Jul 2026 00:00:00 GMT",
  duration: 3_600,
  streamUrl: "https://bandcamp.com/radio-stream",
  chapters: [],
};

beforeEach(() => {
  mocks.fetchRadioShow.mockReset();
  mocks.fetchRadioShows.mockReset();
});

it("loads a direct show screen by ID without requesting the archive", async () => {
  let resolveShow!: (value: RadioShow) => void;
  mocks.fetchRadioShow.mockReturnValue(
    new Promise((resolve) => {
      resolveShow = resolve;
    }),
  );
  mocks.fetchRadioShows.mockReturnValue(new Promise(() => {}));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createCodaMemoryRouter(client, ["/radio/shows/977"]);

  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <RadioShowScreen
          showId={parseRadioShowIdParam(show.id)}
          onBack={vi.fn()}
          onBrowseSeries={vi.fn()}
          onPlay={vi.fn()}
          onQueue={vi.fn()}
          onPlayAt={vi.fn()}
          playbackClock={createPlaybackClock(0)}
          playing={false}
          onTogglePlayback={vi.fn()}
          favoriteShowIds={new Set()}
          onToggleFavorite={vi.fn()}
        />
      </RouterContextProvider>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("status", {
      name: "Loading Radio show details",
    }),
  ).toBeInTheDocument();
  expect(mocks.fetchRadioShow).toHaveBeenCalledWith(show.id);
  expect(mocks.fetchRadioShows).not.toHaveBeenCalled();

  resolveShow(show);

  expect(
    await screen.findByRole("heading", { name: show.subtitle }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Songs in this show" }),
  ).toBeInTheDocument();
  const detailSurface = document.querySelector(
    "[data-coda-radio-detail-surface]",
  );
  expect(detailSurface).not.toContainElement(
    screen.getByRole("button", { name: "Back" }),
  );
  expect(
    screen.getByRole("link", { name: "Browse all shows" }),
  ).toHaveAttribute("href", "/radio");
  expect(
    screen.getByRole("button", { name: "Back" }),
  ).toBeInTheDocument();
});

it("reacts to the newest matching archive summary while details fail", async () => {
  let rejectShow!: (reason?: unknown) => void;
  mocks.fetchRadioShow.mockReturnValue(
    new Promise((_, reject) => {
      rejectShow = reject;
    }),
  );
  const staleAll: RadioShowSummary = {
    id: show.id,
    subtitle: "Stale all-shows title",
    description: "Older all-shows metadata",
    publishedAt: "23 Jul 2026 00:00:00 GMT",
    artworkUrl: "https://f4.bcbits.com/img/stale-radio.jpg",
  };
  const currentSeries: RadioShowSummary = {
    id: show.id,
    subtitle: "Current series title",
    description: "Newer series metadata",
    publishedAt: show.publishedAt,
    artworkUrl: "https://f4.bcbits.com/img/current-radio.jpg",
    series: {
      id: 5,
      title: "The Hip Hop Show",
      slug: "the-hip-hop-show",
    },
  };
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(
    radioShowsInfiniteQueryOptions().queryKey,
    {
      pages: [{ results: [staleAll], hasMore: false }],
      pageParams: [null],
    },
    { updatedAt: 1_000 },
  );
  client.setQueryData(
    radioShowsInfiniteQueryOptions(5).queryKey,
    {
      pages: [{ results: [currentSeries], hasMore: false }],
      pageParams: [null],
    },
    { updatedAt: 2_000 },
  );
  const router = createCodaMemoryRouter(client, ["/radio/shows/977"]);

  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <RadioShowScreen
          showId={parseRadioShowIdParam(show.id)}
          onBack={vi.fn()}
          onBrowseSeries={vi.fn()}
          onPlay={vi.fn()}
          onQueue={vi.fn()}
          onPlayAt={vi.fn()}
          playbackClock={createPlaybackClock(0)}
          playing={false}
          onTogglePlayback={vi.fn()}
          favoriteShowIds={new Set()}
          onToggleFavorite={vi.fn()}
        />
      </RouterContextProvider>
    </QueryClientProvider>,
  );

  expect(
    await screen.findByRole("heading", {
      name: currentSeries.subtitle,
      level: 1,
    }),
  ).toBeVisible();
  expect(
    document.querySelector('[data-coda-radio-artwork-detail="977"] img'),
  ).toHaveAttribute("src", currentSeries.artworkUrl);

  const refreshedAll: RadioShowSummary = {
    ...staleAll,
    subtitle: "Refreshed all-shows title",
    artworkUrl: "https://f4.bcbits.com/img/refreshed-radio.jpg",
  };
  act(() => {
    client.setQueryData(
      radioShowsInfiniteQueryOptions().queryKey,
      {
        pages: [{ results: [refreshedAll], hasMore: false }],
        pageParams: [null],
      },
      { updatedAt: 3_000 },
    );
  });

  expect(
    await screen.findByRole("heading", {
      name: refreshedAll.subtitle,
      level: 1,
    }),
  ).toBeVisible();
  await waitFor(() => {
    expect(
      document.querySelector('[data-coda-radio-artwork-detail="977"] img'),
    ).toHaveAttribute("src", refreshedAll.artworkUrl);
  });

  await act(async () => {
    rejectShow(new Error("The signed Radio stream expired"));
  });

  expect(
    screen.getByRole("heading", {
      name: refreshedAll.subtitle,
      level: 1,
    }),
  ).toBeVisible();
  expect(await screen.findByText("Tracklist unavailable")).toBeVisible();
});

it("recovers Radio artwork by URL while preserving transition identity", () => {
  const firstArtworkUrl = "https://f4.bcbits.com/img/deep-focus-broken.jpg";
  const nextArtworkUrl = "https://f4.bcbits.com/img/deep-focus-fixed.jpg";
  const { container, rerender } = render(
    <RadioArtwork
      detail
      returning
      show={{ ...show, artworkUrl: firstArtworkUrl }}
    />,
  );
  let artwork = container.querySelector("[data-radio-show-artwork]");
  const failedImage = artwork?.querySelector("img");
  expect(failedImage).toHaveAttribute("src", firstArtworkUrl);
  if (!failedImage) throw new Error("Expected initial Radio artwork.");

  fireEvent.error(failedImage);
  expect(artwork?.querySelector("img")).not.toBeInTheDocument();
  expect(
    artwork?.querySelector("[data-radio-show-artwork-fallback]"),
  ).toHaveTextContent("DF");

  rerender(
    <RadioArtwork
      detail
      returning
      show={{ ...show, artworkUrl: nextArtworkUrl }}
    />,
  );
  artwork = container.querySelector("[data-radio-show-artwork]");
  const refreshedImage = artwork?.querySelector("img");
  expect(refreshedImage).toHaveAttribute("src", nextArtworkUrl);
  expect(refreshedImage).toHaveClass("invisible");
  expect(
    artwork?.querySelector("[data-radio-show-artwork-fallback]"),
  ).toHaveTextContent("DF");
  if (!refreshedImage) throw new Error("Expected replacement Radio artwork.");

  fireEvent.load(refreshedImage);
  expect(refreshedImage).not.toHaveClass("invisible");
  expect(
    artwork?.querySelector("[data-radio-show-artwork-fallback]"),
  ).not.toBeInTheDocument();
  expect(artwork).toHaveAttribute(
    "data-coda-radio-artwork-detail",
    String(show.id),
  );
  expect(artwork).toHaveAttribute(
    "data-coda-radio-artwork-return",
    String(show.id),
  );
});
