import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { formatDailyDate } from "@/daily";
import { createCodaMemoryRouter } from "@/router";
import type { DailyArticle, Track } from "@/types";

import { DailyArchiveScreen, DailyArticleScreen } from "./DailyScreens";
import { DailyRouteNavigationContext } from "./DailyRouteNavigationState";

const navigation = {
  closeArticle: vi.fn(async () => undefined),
  openArticle: vi.fn(async () => undefined),
};

function DailyNavigationHarness({ children }: { children: ReactNode }) {
  return (
    <DailyRouteNavigationContext.Provider value={navigation}>
      {children}
    </DailyRouteNavigationContext.Provider>
  );
}

const article: DailyArticle = {
  articleUrl: "https://daily.bandcamp.com/essential-releases/essential-night",
  author: "Bandcamp Daily Staff",
  articleSection: "essential-releases",
  description: "Two luminous tracks selected by Bandcamp Daily.",
  embeds: [
    {
      artist: "Signal Garden",
      id: "daily:essential-releases:a42",
      itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
      title: "Blue Hours",
      tracks: [
        {
          album: "Blue Hours",
          albumId: "daily:essential-releases:a42",
          artist: "Signal Garden",
          duration: 181,
          id: "daily:essential-releases:a42:7",
          streamUrl: "https://t4.bcbits.com/stream/one",
          title: "First Light",
          track: 1,
        },
        {
          album: "Blue Hours",
          albumId: "daily:essential-releases:a42",
          artist: "Signal Garden",
          duration: 205,
          id: "daily:essential-releases:a42:8",
          streamUrl: "https://t4.bcbits.com/stream/two",
          title: "Afterimage",
          track: 2,
        },
      ],
    },
  ],
  id: "daily:essential-releases:essential-night",
  publishedAt: "2026-08-07T13:39:10Z",
  slug: "essential-night",
  title: "Essential Night Music",
};

describe("Bandcamp Daily article music", () => {
  it("makes the complete archive card one music link", async () => {
    const user = userEvent.setup();
    navigation.openArticle.mockClear();
    const queryClient = new QueryClient();
    queryClient.setQueryData(["bandcamp-daily", "essential-releases"], {
      pageParams: [1],
      pages: [
        {
          hasMore: false,
          page: 1,
          results: [
            {
              articleUrl: article.articleUrl,
              articleSection: article.articleSection,
              id: article.id,
              publishedAt: article.publishedAt,
              slug: article.slug,
              title: article.title,
            },
          ],
        },
      ],
    });
    const router = createCodaMemoryRouter(queryClient, ["/collection"]);

    render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <DailyNavigationHarness>
            <DailyArchiveScreen category="essential-releases" />
          </DailyNavigationHarness>
        </RouterContextProvider>
      </QueryClientProvider>,
    );

    const card = screen.getByRole("link", {
      name: "Open Essential Night Music",
    });
    expect(card).toHaveAttribute(
      "href",
      "/daily/essential-night?articleSection=essential-releases&category=essential-releases",
    );
    expect(within(card).queryByText("Hear the music")).not.toBeInTheDocument();
    expect(
      within(card).getByText(formatDailyDate(article.publishedAt) ?? ""),
    ).toBeVisible();
    expect(
      within(card).queryByText("Essential Releases"),
    ).not.toBeInTheDocument();
    expect(within(card).queryByText("Bandcamp Daily")).not.toBeInTheDocument();
    const groups = screen.getByRole("navigation", {
      name: "Bandcamp Daily archive groups",
    });
    expect(within(groups).getAllByRole("link")).toHaveLength(3);
    expect(
      within(groups).getByRole("link", { name: "Franchises" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("navigation", {
        name: "Bandcamp Daily franchises",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("navigation", { name: "Bandcamp Daily genres" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(21);
    expect(card).toHaveAttribute("data-daily-article-open", article.slug);
    expect(card.querySelector("[data-daily-article-title]")).toHaveAttribute(
      "data-daily-article-title",
      article.slug,
    );
    expect(card.querySelector("[data-daily-article-artwork]")).toHaveAttribute(
      "data-daily-article-artwork",
      article.slug,
    );
    await user.click(card);
    expect(navigation.openArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        articleSection: article.articleSection,
        category: "essential-releases",
        slug: article.slug,
        sourceTitle: card.querySelector("[data-daily-article-title]"),
        sourceTrigger: card,
      }),
    );
  });

  it("plays and queues embedded music in album order", async () => {
    const user = userEvent.setup();
    const onPlayTracks = vi.fn();
    const onQueueTracks = vi.fn();
    navigation.closeArticle.mockClear();
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);

    render(
      <RouterContextProvider router={router}>
        <DailyNavigationHarness>
          <DailyArticleScreen
            article={{
              ...article,
              artworkUrl: "https://f4.bcbits.com/img/a42.jpg",
            }}
            section="essential-releases"
            playback={{
              onPlayTracks,
              onQueueTracks,
              onTogglePlayback: vi.fn(),
              playing: false,
            }}
          />
        </DailyNavigationHarness>
      </RouterContextProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Music in this story" }),
    ).toBeVisible();
    expect(
      screen.getByText("Two luminous tracks selected by Bandcamp Daily."),
    ).toBeVisible();
    expect(
      document.querySelector("[data-coda-daily-artwork-detail]"),
    ).toHaveAttribute("data-coda-daily-artwork-detail", article.slug);
    expect(
      screen
        .getByRole("heading", { name: article.title })
        .closest("[data-coda-daily-detail-surface]"),
    ).toHaveAttribute("data-coda-daily-detail-surface");
    expect(screen.getByRole("heading", { name: article.title })).toHaveFocus();
    expect(screen.getByText("2 playable tracks")).toHaveClass("text-left");
    expect(
      screen.queryByRole("button", { name: "Queue all releases" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Play release" }));
    expect(onPlayTracks.mock.calls[0]?.[0].map(({ id }: Track) => id)).toEqual([
      "daily:essential-releases:a42:7",
      "daily:essential-releases:a42:8",
    ]);

    await user.click(screen.getByRole("button", { name: "Add to queue" }));
    expect(
      onQueueTracks.mock.calls[0]?.[0].map(({ track }: Track) => track),
    ).toEqual([1, 2]);

    await user.click(screen.getByRole("button", { name: "Play Afterimage" }));
    expect(onPlayTracks.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ id: "daily:essential-releases:a42:8" }),
    ]);
    await user.click(
      screen.getByRole("link", { name: "Back to Essential Releases" }),
    );
    expect(navigation.closeArticle).toHaveBeenCalledWith(
      article.slug,
      "essential-releases",
    );
  });

  it("queues every playable track in story and release order", async () => {
    const user = userEvent.setup();
    const onQueueTracks = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);
    const multiReleaseArticle: DailyArticle = {
      ...article,
      embeds: [
        ...article.embeds,
        {
          artist: "Night Signal",
          id: "daily:essential-releases:a99",
          itemUrl: "https://night-signal.bandcamp.com/album/second-light",
          title: "Second Light",
          tracks: [
            {
              album: "Second Light",
              albumId: "daily:essential-releases:a99",
              artist: "Night Signal",
              duration: 144,
              id: "daily:essential-releases:a99:3",
              streamUrl: "https://t4.bcbits.com/stream/three",
              title: "Third Light",
              track: 1,
            },
          ],
        },
      ],
    };

    render(
      <RouterContextProvider router={router}>
        <DailyNavigationHarness>
          <DailyArticleScreen
            article={multiReleaseArticle}
            section="essential-releases"
            playback={{
              onPlayTracks: vi.fn(),
              onQueueTracks,
              onTogglePlayback: vi.fn(),
              playing: false,
            }}
          />
        </DailyNavigationHarness>
      </RouterContextProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: "Queue all releases" }),
    );

    expect(onQueueTracks).toHaveBeenCalledTimes(1);
    expect(onQueueTracks.mock.calls[0]?.[0].map(({ id }: Track) => id)).toEqual(
      [
        "daily:essential-releases:a42:7",
        "daily:essential-releases:a42:8",
        "daily:essential-releases:a99:3",
      ],
    );
  });
});
