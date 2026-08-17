import { QueryClient } from "@tanstack/react-query";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistDetail, PlaylistSummary } from "@/types";

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

type SavedLibraryBridgeResult = PlaylistDetail | PlaylistSummary[];

const nativeInvoke = vi.fn<
  (command: string, args?: InvokeArgs) => Promise<SavedLibraryBridgeResult>
>();

beforeEach(() => {
  nativeInvoke.mockReset().mockImplementation(async (command) => {
    if (command === "fetch_playlists") return [summary];
    if (command === "fetch_playlist") return detail;
    throw new Error(`Unexpected saved-library command: ${command}`);
  });
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: { invoke: nativeInvoke },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
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
    expect(nativeInvoke).toHaveBeenNthCalledWith(
      1,
      "fetch_playlists",
      {},
      undefined,
    );
    expect(nativeInvoke).toHaveBeenNthCalledWith(
      2,
      "fetch_playlist",
      { playlistId: "playlist-1" },
      undefined,
    );

    expect(queryClient.getQueryData(["bandcamp", "playlists"]))
      .toEqual([summary]);
    expect(
      queryClient.getQueryData(["bandcamp", "playlists", "playlist-1"]),
    ).toEqual(detail);
  });
});
