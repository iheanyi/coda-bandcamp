import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Track } from "@/types";

import { usePersistentOverlaysController } from "./usePersistentOverlaysController";

const track: Track = {
  album: "Soft Focus",
  albumId: "album-1",
  artist: "Night Archive",
  duration: 180,
  id: "track-1",
  palette: ["#111", "#222"],
  title: "Static Bloom",
  track: 1,
};

describe("usePersistentOverlaysController", () => {
  it("owns connection and playlist visibility through focused commands", () => {
    const { result } = renderHook(usePersistentOverlaysController);

    act(() => result.current.commands.openConnection());
    expect(result.current.state.connectionOpen).toBe(true);
    act(() => result.current.commands.closeConnection());
    expect(result.current.state.connectionOpen).toBe(false);

    act(() => result.current.commands.openAddToPlaylist([]));
    expect(result.current.state.playlist).toBeUndefined();
    act(() => result.current.commands.openAddToPlaylist([track]));
    expect(result.current.state.playlist).toMatchObject({
      generation: 1,
      open: true,
      tracks: [track],
    });
    act(() => result.current.commands.closePlaylist());
    expect(result.current.state.playlist?.open).toBe(false);
    act(() => result.current.commands.completePlaylistExit(1));
    expect(result.current.state.playlist).toBeUndefined();
  });

  it("does not let a stale exit completion erase a newly opened dialog", () => {
    const { result } = renderHook(usePersistentOverlaysController);
    act(() => result.current.commands.openAddToPlaylist([track]));
    act(() => result.current.commands.closePlaylist());
    act(() =>
      result.current.commands.openAddToPlaylist([
        { ...track, id: "track-2", title: "Afterimage" },
      ]),
    );
    act(() => result.current.commands.completePlaylistExit(1));

    expect(result.current.state.playlist).toMatchObject({
      generation: 2,
      open: true,
      tracks: [{ id: "track-2" }],
    });
  });

  it("hydrates optional Last.fm status without coupling it to a route", async () => {
    const loadLastFmStatus = vi.fn().mockResolvedValue({
      configured: true,
      connected: true,
      username: "listener",
    });
    const { result } = renderHook(() =>
      usePersistentOverlaysController({ loadLastFmStatus }),
    );

    expect(result.current.state.lastFmStatus).toEqual({
      configured: false,
      connected: false,
    });
    await waitFor(() => {
      expect(result.current.state.lastFmStatus).toMatchObject({
        connected: true,
        username: "listener",
      });
    });
    expect(loadLastFmStatus).toHaveBeenCalledOnce();
  });
});
