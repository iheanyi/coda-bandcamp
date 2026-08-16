import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MINI_PLAYER_COMMAND_EVENT,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_EVENT,
  parseMiniPlayerCommand,
  type MiniPlayerCommand,
  type MiniPlayerSnapshot,
} from "./miniPlayer";
import MiniPlayerWindow from "./MiniPlayerWindow";
import type { OwnDataValue } from "./ownData";
import {
  createMiniPlayerTauriHarness,
  type MiniPlayerTauriHarness,
  type MiniPlayerTauriTestPayload,
} from "./test/miniPlayerTauriHarness";

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

let activeHarness: MiniPlayerTauriHarness | undefined;

afterEach(() => {
  cleanup();
  activeHarness?.uninstall();
  activeHarness = undefined;
});

function installMiniPlayerHarness(): MiniPlayerTauriHarness {
  const harness = createMiniPlayerTauriHarness("mini-player");
  harness.install();
  activeHarness = harness;
  return harness;
}

async function waitForSnapshotRequest(
  harness: MiniPlayerTauriHarness,
): Promise<void> {
  await waitFor(() => {
    expect(
      harness.emittedPayloads(MINI_PLAYER_REQUEST_STATE_EVENT, "main"),
    ).toHaveLength(1);
    expect(harness.listenerCount(MINI_PLAYER_STATE_EVENT)).toBe(1);
  });
}

function dispatchSnapshot(
  harness: MiniPlayerTauriHarness,
  payload: MiniPlayerTauriTestPayload,
): void {
  act(() => {
    harness.dispatch(MINI_PLAYER_STATE_EVENT, payload);
  });
}

function emittedCommands(
  harness: MiniPlayerTauriHarness,
): MiniPlayerCommand[] {
  return harness
    .emittedPayloads(MINI_PLAYER_COMMAND_EVENT, "main")
    .flatMap((payload) => {
      const command = parseMiniPlayerCommand(payload);
      return command ? [command] : [];
    });
}

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
  it("accepts only parsed snapshots and cleans up native lifecycle listeners", async () => {
    const harness = installMiniPlayerHarness();
    const view = render(
      <StrictMode>
        <MiniPlayerWindow />
      </StrictMode>,
    );
    await waitForSnapshotRequest(harness);

    const jsonPayload: OwnDataValue = JSON.parse(JSON.stringify(snapshot));
    dispatchSnapshot(harness, jsonPayload);
    expect(await screen.findByRole("heading", { name: "First Light" }))
      .toBeInTheDocument();

    const spoofedPayload = Object.assign(new Date(), {
      ...snapshot,
      track: { ...snapshot.track, title: "Forged title" },
      [Symbol.toStringTag]: "Object",
    });
    act(() => {
      harness.dispatch(MINI_PLAYER_STATE_EVENT, null);
      harness.dispatch(MINI_PLAYER_STATE_EVENT, spoofedPayload);
    });

    expect(screen.queryByRole("heading", { name: "Forged title" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "First Light" }))
      .toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      window.dispatchEvent(new Event("blur"));
    });
    await waitFor(() =>
      expect(harness.hiddenWindowLabels).toEqual([
        "mini-player",
        "mini-player",
      ]),
    );

    view.unmount();
    await waitFor(() =>
      expect(harness.listenerCount(MINI_PLAYER_STATE_EVENT)).toBe(0),
    );
    expect(harness.unlistenCount(MINI_PLAYER_STATE_EVENT)).toBe(2);
    const hiddenCount = harness.hiddenWindowLabels.length;
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      window.dispatchEvent(new Event("blur"));
    });
    await Promise.resolve();
    expect(harness.hiddenWindowLabels).toHaveLength(hiddenCount);
  });

  it("renders live state and dispatches controls through Tauri events", async () => {
    const harness = installMiniPlayerHarness();
    const view = render(<MiniPlayerWindow />);
    await waitForSnapshotRequest(harness);
    dispatchSnapshot(harness, snapshot);

    expect(await screen.findByRole("region", { name: "Coda mini player" }))
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

    await waitFor(() =>
      expect(emittedCommands(harness)).toEqual([
        { type: "play-pause" },
        { type: "previous" },
        { type: "seek", positionSeconds: 73 },
        { type: "volume", volume: 0.35 },
        { type: "volume", volume: 0 },
        { type: "show-main" },
      ]),
    );
    await waitFor(() =>
      expect(harness.hiddenWindowLabels).toEqual([
        "mini-player",
        "mini-player",
      ]),
    );
    expect(screen.getByText("0:42")).toBeInTheDocument();
    expect(screen.getByText("3:00")).toBeInTheDocument();

    dispatchSnapshot(harness, {
      ...snapshot,
      playing: false,
      volume: 0,
      canNext: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip track" }));
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));

    await waitFor(() =>
      expect(emittedCommands(harness).slice(-3)).toEqual([
        { type: "play-pause" },
        { type: "next" },
        { type: "volume", volume: 0.72 },
      ]),
    );
    view.unmount();
  });

  it("renders a useful empty state without fake track content", async () => {
    const harness = installMiniPlayerHarness();
    const view = render(<MiniPlayerWindow />);
    await waitForSnapshotRequest(harness);

    expect(screen.getByRole("heading", { name: "Nothing queued" }))
      .toBeInTheDocument();
    expect(screen.getByText("Choose something in Coda to start listening."))
      .toBeInTheDocument();
    expect(querySlider("Track position")).toBeUndefined();
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Skip track" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Open Coda" }));
    await waitFor(() =>
      expect(emittedCommands(harness)).toContainEqual({ type: "show-main" }),
    );
    view.unmount();
  });

  it("uses a palette cover when artwork is unavailable", async () => {
    const harness = installMiniPlayerHarness();
    const view = render(<MiniPlayerWindow />);
    await waitForSnapshotRequest(harness);
    dispatchSnapshot(harness, {
      ...snapshot,
      track: {
        ...snapshot.track!,
        artworkUrl: undefined,
      },
    });

    expect(await screen.findByText("FL")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    view.unmount();
  });
});
