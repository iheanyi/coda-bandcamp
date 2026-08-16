import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { createPlaybackClock } from "@/playbackClock";
import type { RadioChapter } from "@/types";

import {
  NowPlayingRadioSummary,
  NowPlayingRadioTimeline,
} from "./NowPlayingRadioTimeline";

const timeline: RadioChapter[] = [
  { title: "Mirage", artist: "Sweeps", timecode: 30 },
  { title: "Night Drive", artist: "Keylime", timecode: 120 },
  { title: "Sun Room", artist: "New Forms", timecode: 240 },
];

it("announces the current chapter and keeps timeline seeking explicit", () => {
  const playbackClock = createPlaybackClock(45);
  const onSeek = vi.fn();

  render(
    <>
      <NowPlayingRadioSummary
        playbackClock={playbackClock}
        timeline={timeline}
        onOpen={vi.fn()}
      />
      <NowPlayingRadioTimeline
        playbackClock={playbackClock}
        timeline={timeline}
        playing
        radioLinkError=""
        onSeek={onSeek}
        onOpen={vi.fn()}
      />
    </>,
  );

  expect(
    screen.getByRole("region", {
      name: "Currently airing on Bandcamp Radio",
    }),
  ).toHaveTextContent("Up next: Night Drive by Keylime");
  const chapterList = screen.getByRole("list", {
    name: "Radio chapter timeline",
  });
  expect(within(chapterList).getByText("Mirage").closest("li")).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(within(chapterList).getByText("Up next")).toBeVisible();

  fireEvent.click(
    within(chapterList).getByRole("button", {
      name: "Seek to Night Drive at 2:00",
    }),
  );
  expect(onSeek).toHaveBeenCalledWith(120);

  act(() => playbackClock.updateFromMedia(121));
  expect(
    screen.getByRole("region", {
      name: "Currently airing on Bandcamp Radio",
    }),
  ).toHaveTextContent("Night Drive");
});

it("progressively renders long Radio timelines in bounded batches", () => {
  vi.useFakeTimers();
  const longTimeline: RadioChapter[] = Array.from(
    { length: 20 },
    (_, index) => ({
      artist: `Artist ${index + 1}`,
      timecode: index * 60,
      title: `Chapter ${index + 1}`,
    }),
  );
  const rendered = render(
    <NowPlayingRadioTimeline
      playbackClock={createPlaybackClock(0)}
      timeline={longTimeline}
      playing={false}
      radioLinkError=""
      onSeek={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  const chapterList = screen.getByRole("list", {
    name: "Radio chapter timeline",
  });

  expect(chapterList).toHaveAttribute("aria-busy", "true");
  expect(within(chapterList).getAllByRole("listitem")).toHaveLength(6);

  act(() => vi.advanceTimersByTime(16));
  expect(within(chapterList).getAllByRole("listitem")).toHaveLength(18);

  rendered.unmount();
  vi.useRealTimers();
});
