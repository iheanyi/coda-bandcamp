import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";
import {
  PLAYLISTS_QUERY_KEY,
  playlistQueryKey,
} from "@/queries/savedLibraryQueries";
import { createCodaMemoryRouter } from "@/router";
import type { PlaylistDetail, PlaylistSummary, Track } from "@/types";

type PendingTransition = Readonly<{
  kind: string;
  promise: Promise<void>;
  resolve: () => void;
}>;

const mocks = vi.hoisted(() => ({
  fetchPlaylist: vi.fn(),
  fetchPlaylists: vi.fn(),
  pendingTransitions: [] as PendingTransition[],
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchPlaylist: mocks.fetchPlaylist,
    fetchPlaylists: mocks.fetchPlaylists,
  };
});

vi.mock("@/viewTransitions", () => ({
  transitionCodaView: vi.fn(
    (update: () => void | Promise<void>, kind: string) => {
      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => {
        resolveCompletion = resolve;
      });
      const promise = Promise.resolve(update()).then(() => completion);
      mocks.pendingTransitions.push({
        kind,
        promise,
        resolve: resolveCompletion,
      });
      return promise;
    },
  ),
}));

import SavedLibraryView from "@/SavedLibraryView";

const track: Track = {
  album: "Mirage",
  albumId: "album-1",
  artist: "Sweeps",
  duration: 188,
  id: "song-1",
  palette: ["#a66", "#222"],
  title: "Mirage",
  track: 1,
};

const summary: PlaylistSummary = {
  duration: 188,
  id: "playlist-1",
  name: "Night drive",
  songCount: 1,
};

const detail: PlaylistDetail = {
  ...summary,
  tracks: [track],
};

const secondSummary: PlaylistSummary = {
  duration: 188,
  id: "playlist-2",
  name: "Morning focus",
  songCount: 1,
};

const secondDetail: PlaylistDetail = {
  ...secondSummary,
  tracks: [track],
};

const props = {
  connected: true,
  favoritesLoading: false,
  onAddToPlaylist: vi.fn(),
  onNotify: vi.fn(),
  onOpenAlbum: vi.fn(),
  onOpenArtist: vi.fn(),
  onOpenRadioSeries: vi.fn(),
  onOpenRadioShow: vi.fn(),
  onOpenTrackAlbum: vi.fn(),
  onPlayTrack: vi.fn(),
  onPlayTracks: vi.fn(),
  onQueueTrack: vi.fn(),
  onQueueTracks: vi.fn(),
  onRefreshFavorites: vi.fn(),
  onToggleFavorite: vi.fn(),
  onTogglePlayback: vi.fn(),
  onToggleRadioFavorite: vi.fn(),
  playing: false,
} as const;

function renderSavedLibrary(includeSecondPlaylist = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  queryClient.setQueryData(
    PLAYLISTS_QUERY_KEY,
    includeSecondPlaylist ? [summary, secondSummary] : [summary],
  );
  queryClient.setQueryData(playlistQueryKey(summary.id), detail);
  if (includeSecondPlaylist) {
    queryClient.setQueryData(playlistQueryKey(secondSummary.id), secondDetail);
  }
  const router = createCodaMemoryRouter(queryClient, ["/playlists"]);
  render(
    <CodaMotionProvider>
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <div data-coda-library-scroll>
            <SavedLibraryView mode="playlists" {...props} />
          </div>
        </RouterContextProvider>
      </QueryClientProvider>
    </CodaMotionProvider>,
  );
}

async function settleTransition(index: number) {
  const transition = mocks.pendingTransitions[index];
  expect(transition).toBeDefined();
  await act(async () => {
    transition!.resolve();
    await transition!.promise;
  });
}

function expectReturnMarkers() {
  expect(
    document.querySelector("[data-coda-playlist-identity-return]"),
  ).toHaveAttribute("data-coda-playlist-identity-return", summary.id);
  expect(
    document.querySelector("[data-coda-playlist-title-return]"),
  ).toHaveAttribute("data-coda-playlist-title-return", summary.id);
}

beforeEach(() => {
  mocks.pendingTransitions.length = 0;
  mocks.fetchPlaylist.mockReset().mockResolvedValue(detail);
  mocks.fetchPlaylists.mockReset().mockResolvedValue([summary]);
});

describe("Saved Library playlist transition race cleanup", () => {
  it("keeps exactly the latest source marker across rapid different-playlist activations", async () => {
    renderSavedLibrary(true);

    const first = await screen.findByRole("link", { name: /Night drive/u });
    const second = screen.getByRole("link", { name: /Morning focus/u });
    const firstIdentity = first.querySelector<HTMLElement>(
      "[data-playlist-identity]",
    );
    const firstTitle = first.querySelector<HTMLElement>(
      '[data-slot="overflow-marquee-text"]',
    );
    const secondIdentity = second.querySelector<HTMLElement>(
      "[data-playlist-identity]",
    );
    const secondTitle = second.querySelector<HTMLElement>(
      '[data-slot="overflow-marquee-text"]',
    );

    act(() => {
      first.click();
      second.click();
    });

    expect(mocks.pendingTransitions).toHaveLength(2);
    expect(firstIdentity).not.toHaveAttribute(
      "data-coda-playlist-identity-source",
    );
    expect(firstTitle).not.toHaveAttribute("data-coda-playlist-title-source");
    expect(secondIdentity).toHaveAttribute(
      "data-coda-playlist-identity-source",
      secondSummary.id,
    );
    expect(secondTitle).toHaveAttribute(
      "data-coda-playlist-title-source",
      secondSummary.id,
    );

    await settleTransition(0);
    expect(secondIdentity).toHaveAttribute(
      "data-coda-playlist-identity-source",
      secondSummary.id,
    );
    expect(secondTitle).toHaveAttribute(
      "data-coda-playlist-title-source",
      secondSummary.id,
    );

    await settleTransition(1);
    expect(secondIdentity).not.toHaveAttribute(
      "data-coda-playlist-identity-source",
    );
    expect(secondTitle).not.toHaveAttribute("data-coda-playlist-title-source");
  });

  it("does not let an older close clear a newer same-playlist return", async () => {
    renderSavedLibrary();

    fireEvent.click(await screen.findByRole("link", { name: /Night drive/u }));
    await screen.findByRole("heading", { name: summary.name });
    expect(mocks.pendingTransitions[0]?.kind).toBe("playlist-detail");
    await settleTransition(0);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("link", { name: /Night drive/u });
    expect(mocks.pendingTransitions[1]?.kind).toBe("playlist-detail-close");
    expectReturnMarkers();

    fireEvent.click(screen.getByRole("link", { name: /Night drive/u }));
    await screen.findByRole("heading", { name: summary.name });
    await settleTransition(2);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("link", { name: /Night drive/u });
    expect(mocks.pendingTransitions[3]?.kind).toBe("playlist-detail-close");
    expectReturnMarkers();

    await settleTransition(1);
    expectReturnMarkers();

    await settleTransition(3);
    expect(
      document.querySelector("[data-coda-playlist-identity-return]"),
    ).not.toBeInTheDocument();
    expect(
      document.querySelector("[data-coda-playlist-title-return]"),
    ).not.toBeInTheDocument();
  });
});
