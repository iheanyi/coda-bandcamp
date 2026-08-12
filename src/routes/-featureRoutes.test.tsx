import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoverFilters, DiscoverRelease } from "@/types";

type DiscoverScreenStubProps = Readonly<{
  filters: DiscoverFilters;
  onFiltersChange: (filters: DiscoverFilters) => void;
  onOpenRelease: (release: DiscoverRelease) => void;
}>;

type DiscoverReleaseScreenStubProps = Readonly<{
  onBack: () => void;
  release: DiscoverRelease;
}>;

type PlaylistsScreenStubProps = Readonly<{
  onOpenPlaylist: (playlistId: string) => void;
}>;

type PlaylistDetailScreenStubProps = Readonly<{
  onBack: () => void;
  playlistId: string;
}>;

const mocks = vi.hoisted(() => ({
  fetchDiscover: vi.fn(),
  openBandcampUrl: vi.fn(),
}));

vi.mock("@/App", async () => {
  const { Outlet } = await import("@tanstack/react-router");
  return { default: Outlet };
});

vi.mock("@/DiscoverView", () => ({
  DiscoverScreen: ({
    filters,
    onFiltersChange,
    onOpenRelease,
  }: DiscoverScreenStubProps) => (
    <main data-testid="discover-screen-instance">
      <h1>
        Discover {filters.tag || "all"}:{filters.sort}
      </h1>
      <button
        onClick={() => onFiltersChange({ tag: "jazz", sort: "top" })}
        type="button"
      >
        Apply Jazz
      </button>
      <button
        onClick={() =>
          onOpenRelease({
            artist: "Signal Garden",
            id: "discover:release-1",
            itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
            title: "Blue Hours",
          })
        }
        type="button"
      >
        Open Blue Hours
      </button>
    </main>
  ),
}));

vi.mock("@/DiscoverReleaseDetail", () => ({
  DiscoverReleaseScreen: ({
    onBack,
    release,
  }: DiscoverReleaseScreenStubProps) => (
    <main>
      <h1>Release {release.title}</h1>
      <button onClick={onBack} type="button">
        Back
      </button>
    </main>
  ),
}));

vi.mock("@/SavedLibraryView", () => ({
  FavoritesScreen: () => (
    <main>
      <h1>Favorites route</h1>
    </main>
  ),
  PlaylistDetailScreen: ({
    onBack,
    playlistId,
  }: PlaylistDetailScreenStubProps) => (
    <main>
      <h1>Playlist {playlistId}</h1>
      <button onClick={onBack} type="button">
        Back
      </button>
    </main>
  ),
  PlaylistsScreen: ({ onOpenPlaylist }: PlaylistsScreenStubProps) => (
    <main>
      <h1>Playlists route</h1>
      <button onClick={() => onOpenPlaylist("playlist-1")} type="button">
        Open Night Drive
      </button>
    </main>
  ),
}));

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchDiscover: mocks.fetchDiscover,
    openBandcampUrl: mocks.openBandcampUrl,
  };
});

import { type DiscoverRuntimeValue } from "@/features/discover/DiscoverRuntimeContext";
import { DiscoverRuntimeProvider } from "@/features/discover/DiscoverRuntimeProvider";
import {
  SavedLibraryRuntimeProvider,
  type SavedLibraryRuntimeValue,
} from "@/features/saved-library";
import { createCodaMemoryRouter } from "@/router";
import { parseDiscoverReleaseIdParam } from "@/routing/routeContracts";

const discoverPage = {
  hasMore: false,
  resultCount: 1,
  results: [
    {
      artist: "Signal Garden",
      id: "discover:release-1",
      itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
      title: "Blue Hours",
    },
  ],
};

function discoverRuntime(
  router: ReturnType<typeof createCodaMemoryRouter>,
): DiscoverRuntimeValue {
  return {
    onCloseRelease: () => {
      router.history.back();
    },
    onOpenArtist: vi.fn(),
    onOpenRelease: (release) => {
      void router.navigate({
        params: { releaseId: parseDiscoverReleaseIdParam(release.id) },
        search: { sort: "top", tag: "" },
        to: "/discover/releases/$releaseId",
      });
    },
    onPlay: vi.fn(),
    onQueue: vi.fn(),
    onTogglePlayback: vi.fn(),
    playing: false,
  };
}

function savedLibraryRuntime(): SavedLibraryRuntimeValue {
  return {
    connected: false,
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
  };
}

function renderFeatureRoute(initialEntries: readonly string[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const router = createCodaMemoryRouter(queryClient, initialEntries);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DiscoverRuntimeProvider value={discoverRuntime(router)}>
        <SavedLibraryRuntimeProvider value={savedLibraryRuntime()}>
          <RouterProvider router={router} />
        </SavedLibraryRuntimeProvider>
      </DiscoverRuntimeProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, router };
}

beforeEach(() => {
  mocks.fetchDiscover.mockReset().mockResolvedValue(discoverPage);
  mocks.openBandcampUrl.mockReset();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

describe("feature file routes", () => {
  it("owns validated Discover search and replaces filter changes", async () => {
    const user = userEvent.setup();
    const { router } = renderFeatureRoute([
      "/discover?tag=ambient&sort=new&unexpected=value",
    ]);

    expect(
      await screen.findByRole("heading", {
        name: "Discover ambient:new",
      }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Apply Jazz" }));

    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        tag: "jazz",
        sort: "top",
      });
    });
    expect(router.history.canGoBack()).toBe(false);
  });

  it("navigates to a branded Discover release and keeps signed data out of loader output", async () => {
    const user = userEvent.setup();
    const { queryClient, router } = renderFeatureRoute(["/discover"]);

    await user.click(
      await screen.findByRole("button", {
        name: "Open Blue Hours",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Release Blue Hours",
      }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toContain(
      "/discover/releases/discover%3Arelease-1",
    );
    const releaseMatch = router.state.matches.find(
      (match) => match.routeId === "/discover/releases/$releaseId",
    );
    expect(releaseMatch?.loaderData).toBeUndefined();
    expect(
      queryClient.getQueryData(["discover", { tag: "", sort: "top" }]),
    ).toEqual(expect.objectContaining({ pages: [discoverPage] }));
  });

  it("keeps the same Discover screen instance mounted across detail navigation", async () => {
    const user = userEvent.setup();
    const { router } = renderFeatureRoute(["/discover"]);
    const discoverScreen = await screen.findByTestId(
      "discover-screen-instance",
    );

    await user.click(
      screen.getByRole("button", {
        name: "Open Blue Hours",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Release Blue Hours",
      }),
    ).toBeInTheDocument();
    expect(discoverScreen).toBeInTheDocument();
    expect(discoverScreen.parentElement).toHaveAttribute("hidden");

    await user.click(
      screen.getByRole("button", {
        name: "Back",
      }),
    );

    expect(await screen.findByTestId("discover-screen-instance")).toBe(
      discoverScreen,
    );
    expect(discoverScreen.parentElement).not.toHaveAttribute("hidden");
    expect(router.state.location.pathname).toBe("/discover");
  });

  it("explains the bounded direct-reload limitation for an uncached Discover release", async () => {
    renderFeatureRoute(["/discover/releases/discover:missing"]);

    expect(
      await screen.findByRole("heading", {
        name: "Release not found",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/currently available Discover pages/u),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to Discover" }),
    ).toHaveAttribute("href", "/discover?tag=&sort=top");
  });

  it("uses typed playlist navigation for list and detail screens", async () => {
    const user = userEvent.setup();
    const { router } = renderFeatureRoute(["/playlists"]);

    await user.click(
      await screen.findByRole("button", {
        name: "Open Night Drive",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Playlist playlist-1",
      }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/playlists/playlist-1");
  });

  it("falls back to the playlist list when direct detail history cannot pop", async () => {
    const user = userEvent.setup();
    const { router } = renderFeatureRoute(["/playlists/playlist-1"]);

    await user.click(
      await screen.findByRole("button", {
        name: "Back",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Playlists route",
      }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/playlists");
  });

  it("renders Favorites from the Saved Library runtime", async () => {
    renderFeatureRoute(["/favorites"]);

    expect(
      await screen.findByRole("heading", { name: "Favorites route" }),
    ).toBeInTheDocument();
  });
});
