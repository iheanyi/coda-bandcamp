import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistDetail, PlaylistSummary } from "@/types";

const mocks = vi.hoisted(() => ({
  fetchPlaylist: vi.fn(),
  fetchPlaylists: vi.fn(),
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchPlaylist: mocks.fetchPlaylist,
    fetchPlaylists: mocks.fetchPlaylists,
  };
});

import {
  PLAYLIST_STALE_TIME_MS,
  playlistQueryOptions,
  playlistsQueryOptions,
} from "./savedLibraryQueries";

const summary: PlaylistSummary = {
  id: "playlist-1",
  name: "Night drive",
  songCount: 0,
  duration: 0,
};
const detail: PlaylistDetail = { ...summary, tracks: [] };

beforeEach(() => {
  mocks.fetchPlaylists.mockReset().mockResolvedValue([summary]);
  mocks.fetchPlaylist.mockReset().mockResolvedValue(detail);
});

describe("saved-library query options", () => {
  it("preserves list/detail keys with bounded freshness and no GC override", () => {
    const listOptions = playlistsQueryOptions();
    const detailOptions = playlistQueryOptions("playlist-1");

    expect(listOptions.queryKey).toEqual(["bandcamp", "playlists"]);
    expect(detailOptions.queryKey).toEqual([
      "bandcamp",
      "playlists",
      "playlist-1",
    ]);
    expect(listOptions.enabled).toBeUndefined();
    expect(detailOptions.enabled).toBeUndefined();
    expect(listOptions.staleTime).toBe(PLAYLIST_STALE_TIME_MS);
    expect(detailOptions.staleTime).toBe(PLAYLIST_STALE_TIME_MS);
    expect(listOptions.gcTime).toBeUndefined();
    expect(detailOptions.gcTime).toBeUndefined();
  });

  it("forwards loader fetches and remains compatible with mutation keys", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const listOptions = playlistsQueryOptions();
    const detailOptions = playlistQueryOptions("playlist-1");

    expect(await queryClient.fetchQuery(listOptions)).toEqual([summary]);
    expect(await queryClient.fetchQuery(detailOptions)).toEqual(detail);
    expect(mocks.fetchPlaylists).toHaveBeenCalledOnce();
    expect(mocks.fetchPlaylist).toHaveBeenCalledWith("playlist-1");

    expect(queryClient.getQueryData(["bandcamp", "playlists"]))
      .toEqual([summary]);
    expect(
      queryClient.getQueryData(["bandcamp", "playlists", "playlist-1"]),
    ).toEqual(detail);
  });
});
