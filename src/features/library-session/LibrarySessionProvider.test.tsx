import { StrictMode, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Album, Track } from "@/types";
import {
  LibrarySessionProvider,
  useLibrarySession,
} from "./LibrarySessionProvider";
import { createLibrarySessionController } from "./librarySessionController";

const release: Album = {
  id: "album-1",
  title: "Blue Hours",
  artist: "Signal Garden",
  artworkUrl: "https://signed.example/album",
  songCount: 1,
  duration: 201,
  palette: ["#777", "#222"],
};

const releaseTrack: Track = {
  id: "track-1",
  title: "Glass Lines",
  artist: "Signal Garden",
  album: "Blue Hours",
  albumId: "album-1",
  artworkUrl: "https://signed.example/art",
  streamUrl: "https://signed.example/audio",
  duration: 201,
  track: 1,
  palette: ["#777", "#222"],
};

function client() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("LibrarySessionProvider", () => {
  it("activates startup once under Strict Mode and exposes a frozen session surface", async () => {
    const queryClient = client();
    const checkConnection = vi.fn(async () => false);
    const controller = createLibrarySessionController({
      dependencies: {
        checkConnection,
        clearRuntimeData: vi.fn(),
      },
      queryClient,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <LibrarySessionProvider controller={controller}>
            {children}
          </LibrarySessionProvider>
        </QueryClientProvider>
      </StrictMode>
    );

    const { result } = renderHook(useLibrarySession, { wrapper });

    await waitFor(() => {
      expect(result.current.state.connection).toBe("disconnected");
    });
    expect(checkConnection).toHaveBeenCalledOnce();
    expect(result.current.albums).toEqual([]);
    expect(Object.isFrozen(result.current)).toBe(true);
    expect(Object.isFrozen(result.current.albums)).toBe(true);
    expect(Object.isFrozen(result.current.state)).toBe(true);
    expect(Object.isFrozen(result.current.commands)).toBe(true);
  });

  it("derives albums from Query without placing signed URLs or tracks in context", async () => {
    const queryClient = client();
    const controller = createLibrarySessionController({
      dependencies: { checkConnection: vi.fn(async () => false) },
      queryClient,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <LibrarySessionProvider controller={controller}>
          {children}
        </LibrarySessionProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(useLibrarySession, { wrapper });

    act(() => {
      controller.commands.acceptConnectedLibrary(
        [{ ...release, tracks: [releaseTrack] }],
        { announce: false },
      );
    });

    await waitFor(() => expect(result.current.albums).toHaveLength(1));
    expect(result.current.albums[0]).toEqual(
      expect.not.objectContaining({
        artworkUrl: expect.anything(),
        tracks: expect.anything(),
      }),
    );
    expect(result.current.state.connection).toBe("connected");
    expect(result.current.commands).toBe(controller.commands);
    expect(result.current.route).toBe(controller.route);
  });

  it("requires consumers to render below the provider", () => {
    expect(() => renderHook(useLibrarySession)).toThrow(
      "Library session consumers require LibrarySessionProvider",
    );
  });
});
