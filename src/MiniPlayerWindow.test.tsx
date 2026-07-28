import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MiniPlayerSnapshot } from "./miniPlayer";
import { MiniPlayerView } from "./MiniPlayerWindow";

const snapshot: MiniPlayerSnapshot = {
  track: {
    id: "track-1",
    title: "First Light",
    artist: "Night Archive",
    album: "Soft Focus",
    artworkUrl: "https://t4.bcbits.com/img/cover.jpg",
    palette: ["#dd6549", "#202326"],
  },
  playing: true,
  positionSeconds: 42,
  durationSeconds: 180,
  volume: 0.72,
  canPrevious: true,
  canNext: false,
};

describe("Coda mini player", () => {
  it("renders the live song and dispatches real playback controls", () => {
    const onCommand = vi.fn();
    const onDismiss = vi.fn();
    render(
      <MiniPlayerView
        snapshot={snapshot}
        onCommand={onCommand}
        onDismiss={onDismiss}
      />,
    );

    expect(screen.getByRole("region", { name: "Coda mini player" }))
      .toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "First Light" }))
      .toBeInTheDocument();
    expect(screen.getByText("Night Archive · Soft Focus"))
      .toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Soft Focus cover" }))
      .toHaveAttribute("src", snapshot.track?.artworkUrl);

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByRole("button", { name: "Skip track" })).toBeDisabled();
    fireEvent.change(screen.getByRole("slider", { name: "Track position" }), {
      target: { value: "73" },
    });
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
      target: { value: "0.35" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Coda" }));
    fireEvent.click(screen.getByRole("button", { name: "Close mini player" }));

    expect(onCommand.mock.calls.map(([command]) => command)).toEqual([
      { type: "play-pause" },
      { type: "previous" },
      { type: "seek", positionSeconds: 73 },
      { type: "volume", volume: 0.35 },
      { type: "volume", volume: 0 },
      { type: "show-main" },
    ]);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.getByText("0:42")).toBeInTheDocument();
    expect(screen.getByText("3:00")).toBeInTheDocument();
  });

  it("renders a useful empty state without fake track content", () => {
    const onCommand = vi.fn();
    render(
      <MiniPlayerView
        snapshot={{
          playing: false,
          positionSeconds: 0,
          durationSeconds: 0,
          volume: 0.72,
          canPrevious: false,
          canNext: false,
        }}
        onCommand={onCommand}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Nothing queued" }))
      .toBeInTheDocument();
    expect(screen.getByText("Choose something in Coda to start listening."))
      .toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "Track position" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip track" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Open Coda" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "show-main" });
  });

  it("uses a palette cover when artwork is unavailable", () => {
    render(
      <MiniPlayerView
        snapshot={{
          ...snapshot,
          track: {
            ...snapshot.track!,
            artworkUrl: undefined,
          },
        }}
        onCommand={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("FL")).toBeInTheDocument();
  });
});
