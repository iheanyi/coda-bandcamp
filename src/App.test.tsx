import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Album, Track } from "./types";

const mocks = vi.hoisted(() => ({
  connectBandcamp: vi.fn(),
  fetchLibrary: vi.fn(),
  hasConnection: vi.fn(),
  readLibraryCache: vi.fn(),
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    connectBandcamp: mocks.connectBandcamp,
    fetchLibrary: mocks.fetchLibrary,
    hasConnection: mocks.hasConnection,
    isDesktop: () => false,
    readLibraryCache: mocks.readLibraryCache,
    writeLibraryCache: vi.fn(),
  };
});

import App from "./App";

const tracks: Track[] = [
  {
    id: "track-1",
    title: "First Light",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 180,
    track: 1,
    streamUrl: "https://example.test/first.mp3",
    palette: ["#777", "#222"],
  },
  {
    id: "track-2",
    title: "Afterimage",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 210,
    track: 2,
    streamUrl: "https://example.test/after.mp3",
    palette: ["#777", "#222"],
  },
];

const album: Album = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: tracks.length,
  duration: tracks.reduce((total, track) => total + track.duration, 0),
  genre: "Ambient",
  tracks,
  palette: ["#777", "#222"],
};

beforeEach(() => {
  mocks.connectBandcamp.mockReset();
  mocks.fetchLibrary.mockReset();
  mocks.hasConnection.mockReset();
  mocks.readLibraryCache.mockReset().mockReturnValue([]);
  mocks.hasConnection.mockResolvedValue(false);
});

describe("Coda application flows", () => {
  it("connects from the valid empty state and renders the returned library", async () => {
    mocks.connectBandcamp.mockResolvedValue([album]);
    render(<App />);

    expect(await screen.findByText("Your collection starts here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Minimize" })).toHaveAttribute("title", "Minimize");
    expect(screen.getByRole("button", { name: "Maximize window" }))
      .toHaveAttribute("title", "Maximize window");
    fireEvent.click(screen.getByRole("button", { name: "Connect Bandcamp" }));

    const dialog = await screen.findByRole("dialog", { name: "Bring in your collection" });
    expect(dialog).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Subsonic username"), {
      target: { value: "generated-user" },
    });
    fireEvent.change(screen.getByLabelText("Subsonic password"), {
      target: { value: "generated-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Connect Bandcamp" }));

    await waitFor(() =>
      expect(mocks.connectBandcamp).toHaveBeenCalledWith({
        username: "generated-user",
        password: "generated-password",
      }),
    );
    expect(await screen.findByText("Soft Focus")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ambient" })).toBeInTheDocument();
  });

  it("plays an album, exposes native AirPlay, and preserves now playing when clearing", async () => {
    const airPlayPicker = vi.fn();
    Object.defineProperty(HTMLMediaElement.prototype, "webkitShowPlaybackTargetPicker", {
      configurable: true,
      value: airPlayPicker,
    });
    mocks.hasConnection.mockResolvedValue(true);
    mocks.fetchLibrary.mockResolvedValue([album]);
    render(<App />);

    await screen.findByText("Soft Focus");
    fireEvent.click(screen.getByRole("button", { name: "Play Soft Focus" }));

    expect(await screen.findByText("Now playing")).toBeInTheDocument();
    expect(screen.getAllByText("First Light").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Choose AirPlay device" }));
    expect(airPlayPicker).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Clear next" }));
    expect(screen.getByText("End of the queue")).toBeInTheDocument();
    expect(screen.getAllByText("First Light").length).toBeGreaterThan(0);
    expect(screen.queryByText("Afterimage")).not.toBeInTheDocument();
  });
});
