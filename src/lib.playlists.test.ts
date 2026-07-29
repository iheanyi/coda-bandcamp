import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import { updatePlaylist } from "./lib";

describe("playlist mutation bridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("returns no detail when Bandcamp committed an empty playlist update", async () => {
    mocks.invoke.mockResolvedValue(null);

    await expect(updatePlaylist({
      playlistId: "playlist-1",
      songIndexesToRemove: [0],
    })).resolves.toBeUndefined();
  });

  it("hydrates playlist detail returned with a committed update", async () => {
    mocks.invoke.mockResolvedValue({
      id: "playlist-1",
      name: "Night drives",
      songCount: 1,
      duration: 245,
      tracks: [{
        id: "song-1",
        title: "Afterimage",
        artist: "Night Archive",
        album: "Soft Focus",
        albumId: "album-1",
        duration: 245,
        track: 1,
      }],
    });

    await expect(updatePlaylist({
      playlistId: "playlist-1",
      name: "Night drives",
    })).resolves.toMatchObject({
      id: "playlist-1",
      tracks: [expect.objectContaining({
        id: "song-1",
        palette: expect.any(Array),
      })],
    });
  });

  it("still rejects when the native playlist mutation fails", async () => {
    mocks.invoke.mockRejectedValue(new Error("Playlist update failed"));

    await expect(updatePlaylist({
      playlistId: "playlist-1",
      name: "Night drives",
    })).rejects.toThrow("Playlist update failed");
  });
});
