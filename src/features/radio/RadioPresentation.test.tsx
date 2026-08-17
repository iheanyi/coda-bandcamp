import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";

import { createPlaybackClock } from "@/playbackClock";
import { createCodaMemoryRouter } from "@/router";
import type { RadioShow, RadioShowSummary } from "@/types";

import { RadioCard } from "./RadioCard";
import { RadioDetail } from "./RadioDetail";

const show: RadioShowSummary = {
  id: 977,
  subtitle: "Deep Focus",
  description: "New music from the edges of electronic sound.",
  publishedAt: "2026-08-14T12:00:00Z",
  artworkUrl: "https://f4.bcbits.com/img/deep-focus.jpg",
  series: {
    id: 1,
    title: "Bandcamp Electronic",
    slug: "bandcamp-electronic",
  },
};

function renderWithRouter(ui: ReactNode) {
  const router = createCodaMemoryRouter(new QueryClient(), ["/radio"]);
  return render(ui, {
    wrapper: ({ children }) => (
      <RouterContextProvider router={router}>{children}</RouterContextProvider>
    ),
  });
}

it("keeps Radio card actions and detail navigation accessible", () => {
  const onPlay = vi.fn();
  const onQueue = vi.fn();
  const onDetails = vi.fn();
  const onToggleFavorite = vi.fn();
  const onOpenItem = vi.fn();

  renderWithRouter(
    <RadioCard
      show={show}
      active={false}
      playing={false}
      onPlay={onPlay}
      onTogglePlayback={vi.fn()}
      onQueue={onQueue}
      onDetails={onDetails}
      favorite={false}
      onToggleFavorite={onToggleFavorite}
      onOpenItem={onOpenItem}
      onBrowseSeries={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Play Deep Focus" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Add Deep Focus to favorites" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add Deep Focus to queue" }),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Open Deep Focus on Bandcamp",
    }),
  );
  const detailsLink = screen.getByRole("link", { name: "Open Deep Focus" });
  fireEvent.click(detailsLink);

  expect(onPlay).toHaveBeenCalledWith(show);
  expect(onToggleFavorite).toHaveBeenCalledWith(show);
  expect(onQueue).toHaveBeenCalledWith(show);
  expect(onOpenItem).toHaveBeenCalledWith(
    "https://bandcamp.com/radio?show=977",
  );
  expect(onDetails).toHaveBeenCalledWith(show, detailsLink);
});

it("preserves the summary shell while Radio details hydrate", () => {
  const onPlayAt = vi.fn();
  const baseProps = {
    show,
    loading: true,
    retrying: false,
    actionError: "",
    onBack: vi.fn(),
    onRetry: vi.fn(),
    onPlay: vi.fn(),
    onQueue: vi.fn(),
    onPlayAt,
    playbackClock: createPlaybackClock(0),
    playing: false,
    onTogglePlayback: vi.fn(),
    onOpenItem: vi.fn(),
    favorite: false,
    onToggleFavorite: vi.fn(),
    onBrowseSeries: vi.fn(),
  };
  const { rerender } = renderWithRouter(<RadioDetail {...baseProps} />);

  expect(
    screen.getByRole("heading", { name: "Deep Focus", level: 1 }),
  ).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Loading Radio show tracklist" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Loading show audio" }),
  ).toBeDisabled();

  const details: RadioShow = {
    ...show,
    title: "Bandcamp Weekly",
    duration: 3_600,
    streamUrl: "https://t4.bcbits.com/stream/radio.mp3",
    chapters: [
      {
        title: "Mirage",
        artist: "Sweeps",
        timecode: 30,
      },
    ],
  };
  rerender(<RadioDetail {...baseProps} details={details} loading={false} />);

  const chapterControl = screen.getByRole("button", {
    name: "Play Mirage from 0:30",
  });
  fireEvent.click(chapterControl);
  expect(onPlayAt).toHaveBeenCalledWith(
    expect.objectContaining({ id: "radio:977" }),
    30,
  );
});
