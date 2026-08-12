import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

import { fetchFavorites, reconcileFavoriteTracks, setFavorite } from "./lib";

describe("Favorites bridge", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it("hydrates server-starred albums and tracks", async () => {
    mocks.invoke.mockResolvedValue({
      albumIds: ["album-1"],
      songIds: ["song-1"],
      albums: [{
        id: "album-1",
        title: "Soft Focus",
        artist: "Night Archive",
        songCount: 1,
        duration: 245,
      }],
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

    await expect(fetchFavorites()).resolves.toMatchObject({
      albumIds: ["album-1"],
      songIds: ["song-1"],
      albums: [expect.objectContaining({
        id: "album-1",
        palette: expect.any(Array),
      })],
      tracks: [expect.objectContaining({
        id: "song-1",
        palette: expect.any(Array),
      })],
    });
    expect(mocks.invoke).toHaveBeenCalledWith("fetch_favorites");
  });

  it("passes a bounded favorite mutation to the native boundary", async () => {
    mocks.invoke.mockResolvedValue({
      accepted: true,
      verification: "notRequired",
      favorite: false,
    });

    await setFavorite({ id: "album-1", kind: "album", favorite: false });

    expect(mocks.invoke).toHaveBeenCalledWith("set_favorite", {
      input: { id: "album-1", kind: "album", favorite: false },
    });
  });

  it("hydrates bounded track reconciliation results", async () => {
    mocks.invoke.mockResolvedValue({
      tracks: [{
        id: "song-1",
        title: "Afterimage",
        artist: "Night Archive",
        album: "Soft Focus",
        albumId: "album-1",
        duration: 245,
        track: 1,
        starredAt: "2026-08-12T18:01:00Z",
      }],
      unstarredIds: ["song-2"],
      unavailableTrackCount: 1,
    });

    await expect(reconcileFavoriteTracks([
      { id: "song-1", albumId: "album-1" },
    ])).resolves.toMatchObject({
      tracks: [expect.objectContaining({
        id: "song-1",
        palette: expect.any(Array),
      })],
      unstarredIds: ["song-2"],
      unavailableTrackCount: 1,
    });
    expect(mocks.invoke).toHaveBeenCalledWith("reconcile_favorite_tracks", {
      tracks: [{ id: "song-1", albumId: "album-1" }],
    });
  });
});
