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

function getSlider(label: string): HTMLInputElement {
  const slider = screen
    .getAllByLabelText(label)
    .find((element): element is HTMLInputElement =>
      element instanceof HTMLInputElement);
  if (!slider) throw new Error(`Missing ${label} slider`);
  return slider;
}

function querySlider(label: string): HTMLInputElement | undefined {
  return screen
    .queryAllByLabelText(label)
    .find((element): element is HTMLInputElement =>
      element instanceof HTMLInputElement);
}

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
    fireEvent.change(getSlider("Track position"), {
      target: { value: "73" },
    });
    fireEvent.change(getSlider("Volume"), {
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

  it("reports continuous keyboard seek and volume changes", () => {
    const onCommand = vi.fn();
    render(
      <MiniPlayerView
        snapshot={snapshot}
        onCommand={onCommand}
        onDismiss={vi.fn()}
      />,
    );

    const seek = getSlider("Track position");
    seek.focus();
    fireEvent.keyDown(seek, { key: "ArrowRight" });

    const volume = getSlider("Volume");
    volume.focus();
    fireEvent.keyDown(volume, { key: "ArrowLeft" });

    expect(onCommand.mock.calls.map(([command]) => command)).toEqual([
      { type: "seek", positionSeconds: 43 },
      { type: "volume", volume: 0.71 },
    ]);
  });

  it("keeps seek and volume keyboard changes within their bounds", () => {
    const onCommand = vi.fn();
    const view = render(
      <MiniPlayerView
        snapshot={snapshot}
        onCommand={onCommand}
        onDismiss={vi.fn()}
      />,
    );

    const seek = getSlider("Track position");
    seek.focus();
    fireEvent.keyDown(seek, { key: "End" });

    const volume = getSlider("Volume");
    volume.focus();
    fireEvent.keyDown(volume, { key: "Home" });

    expect(onCommand.mock.calls.map(([command]) => command)).toEqual([
      { type: "seek", positionSeconds: 180 },
      { type: "volume", volume: 0 },
    ]);

    onCommand.mockClear();
    view.rerender(
      <MiniPlayerView
        snapshot={{
          ...snapshot,
          positionSeconds: snapshot.durationSeconds,
          volume: 1,
        }}
        onCommand={onCommand}
        onDismiss={vi.fn()}
      />,
    );
    const boundedSeek = getSlider("Track position");
    boundedSeek.focus();
    fireEvent.keyDown(boundedSeek, { key: "ArrowRight" });
    const boundedVolume = getSlider("Volume");
    boundedVolume.focus();
    fireEvent.keyDown(boundedVolume, { key: "ArrowRight" });

    expect(onCommand).not.toHaveBeenCalled();
  });

  it("reports continuous volume changes while pointer-dragging the compact slider", () => {
    const onCommand = vi.fn();
    render(
      <MiniPlayerView
        snapshot={snapshot}
        onCommand={onCommand}
        onDismiss={vi.fn()}
      />,
    );

    const volume = screen.getByRole("group", { name: "Volume" });
    const control = volume.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    if (!control) throw new Error("Missing volume slider control");
    const thumb = volume.querySelector<HTMLElement>("[data-slot=slider-thumb]");
    if (!thumb) throw new Error("Missing volume slider thumb");
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    vi.spyOn(thumb, "getBoundingClientRect").mockReturnValue(
      new DOMRect(65, 5, 10, 10),
    );

    fireEvent.pointerDown(control, {
      button: 0,
      buttons: 1,
      clientX: 70,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(onCommand).toHaveBeenCalledWith({ type: "volume", volume: 0.35 });
  });

  it("reports continuous bounded seek changes while pointer-dragging the compact slider", () => {
    const onCommand = vi.fn();
    render(
      <MiniPlayerView
        snapshot={snapshot}
        onCommand={onCommand}
        onDismiss={vi.fn()}
      />,
    );

    const position = screen.getByRole("group", { name: "Track position" });
    const control = position.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    if (!control) throw new Error("Missing position slider control");
    const thumb = position.querySelector<HTMLElement>(
      "[data-slot=slider-thumb]",
    );
    if (!thumb) throw new Error("Missing position slider thumb");
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    vi.spyOn(thumb, "getBoundingClientRect").mockReturnValue(
      new DOMRect(21, 5, 10, 10),
    );

    fireEvent.pointerDown(control, {
      button: 0,
      buttons: 1,
      clientX: 35,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 72.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 120,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(onCommand.mock.calls.map(([command]) => command)).toEqual([
      { type: "seek", positionSeconds: 60 },
      { type: "seek", positionSeconds: 135 },
      { type: "seek", positionSeconds: 180 },
    ]);
  });

  it("sets compact seek and volume from track presses without pointer movement", () => {
    const onCommand = vi.fn();
    render(
      <MiniPlayerView
        snapshot={snapshot}
        onCommand={onCommand}
        onDismiss={vi.fn()}
      />,
    );

    const position = screen.getByRole("group", { name: "Track position" });
    const positionControl = position.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    if (!positionControl) throw new Error("Missing position slider control");
    const positionThumb = position.querySelector<HTMLElement>(
      "[data-slot=slider-thumb]",
    );
    if (!positionThumb) throw new Error("Missing position slider thumb");
    vi.spyOn(positionControl, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    vi.spyOn(positionThumb, "getBoundingClientRect").mockReturnValue(
      new DOMRect(21, 5, 10, 10),
    );

    fireEvent.pointerDown(positionControl, {
      button: 0,
      buttons: 1,
      clientX: 35,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
    expect(onCommand).toHaveBeenCalledWith({
      type: "seek",
      positionSeconds: 60,
    });
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 35,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });

    const volume = screen.getByRole("group", { name: "Volume" });
    const control = volume.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    );
    if (!control) throw new Error("Missing volume slider control");
    const thumb = volume.querySelector<HTMLElement>("[data-slot=slider-thumb]");
    if (!thumb) throw new Error("Missing volume slider thumb");
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 100, 20),
    );
    vi.spyOn(thumb, "getBoundingClientRect").mockReturnValue(
      new DOMRect(64.8, 5, 10, 10),
    );

    fireEvent.pointerDown(control, {
      button: 0,
      buttons: 1,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });

    expect(onCommand).toHaveBeenCalledWith({ type: "volume", volume: 0.35 });

    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    });
  });

  it("dispatches play, next, and default unmute actions from their named controls", () => {
    const onCommand = vi.fn();
    render(
      <MiniPlayerView
        snapshot={{
          ...snapshot,
          playing: false,
          volume: 0,
          canNext: true,
        }}
        onCommand={onCommand}
        onDismiss={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip track" }));
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));

    expect(onCommand.mock.calls.map(([command]) => command)).toEqual([
      { type: "play-pause" },
      { type: "next" },
      { type: "volume", volume: 0.72 },
    ]);
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
    expect(querySlider("Track position")).toBeUndefined();
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
