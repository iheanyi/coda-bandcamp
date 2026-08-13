import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createCodaMemoryRouter } from "@/router";
import type { DailyArticle, Track } from "@/types";

import { DailyArchiveScreen, DailyArticleScreen } from "./DailyScreens";

const article: DailyArticle = {
  articleUrl: "https://daily.bandcamp.com/essential-releases/essential-night",
  author: "Bandcamp Daily Staff",
  category: "essential-releases",
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
  it("makes the complete archive card one music link", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      ["bandcamp-daily", "essential-releases"],
      {
        pageParams: [1],
        pages: [
          {
            hasMore: false,
            page: 1,
            results: [
              {
                articleUrl: article.articleUrl,
                category: article.category,
                id: article.id,
                publishedAt: article.publishedAt,
                slug: article.slug,
                title: article.title,
              },
            ],
          },
        ],
      },
    );
    const router = createCodaMemoryRouter(queryClient, ["/collection"]);

    render(
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <DailyArchiveScreen category="essential-releases" />
        </RouterContextProvider>
      </QueryClientProvider>,
    );

    const card = screen.getByRole("link", {
      name: "Open music from Essential Night Music",
    });
    expect(card).toHaveAttribute(
      "href",
      "/daily/essential-night?category=essential-releases",
    );
    expect(card).toContainElement(screen.getByText("Hear the music"));
    expect(screen.getAllByRole("link")).toHaveLength(7);
  });

  it("plays and queues embedded music in album order", async () => {
    const user = userEvent.setup();
    const onPlayTracks = vi.fn();
    const onQueueTracks = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/collection"]);

    render(
      <RouterContextProvider router={router}>
        <DailyArticleScreen
          article={article}
          playback={{
            onPlayTracks,
            onQueueTracks,
            onTogglePlayback: vi.fn(),
            playing: false,
          }}
        />
      </RouterContextProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Music in this story" }),
    ).toBeVisible();
    expect(
      screen.getByText("Two luminous tracks selected by Bandcamp Daily."),
    ).toBeVisible();

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
  });
});
