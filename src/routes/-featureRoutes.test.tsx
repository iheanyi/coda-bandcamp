import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  useRouter,
} from "@tanstack/react-router";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  DiscoverFilters,
  DiscoverPage,
} from "@/types";
import type { DiscoverReleaseScreenProps } from "@/DiscoverReleaseDetail";
import type { DiscoverScreenProps } from "@/DiscoverView";
import type {
  PlaylistDetailScreenProps,
  PlaylistsScreenProps,
} from "@/SavedLibraryView";
import { type DiscoverRuntimeValue } from "@/features/discover/DiscoverRuntimeContext";
import { DiscoverRuntimeProvider } from "@/features/discover/DiscoverRuntimeProvider";
import {
  SavedLibraryRuntimeProvider,
  type SavedLibraryRuntimeValue,
} from "@/features/saved-library";
import { createCodaMemoryRouter } from "@/router";
import { Route as RootRoute } from "@/routes/__root";
import { DiscoverRouteLayout } from "@/routes/discover/-discover-route-layout";
import { Route as DiscoverLayoutRoute } from "@/routes/discover/route";
import { DiscoverReleaseRoute } from "@/routes/discover/releases/-discover-release-route";
import { Route as DiscoverReleaseFileRoute } from "@/routes/discover/releases/$releaseId";
import { PlaylistDetailRoute } from "@/routes/playlists/-playlist-detail-route";
import { PlaylistsIndexRoute } from "@/routes/playlists/-playlists-index-route";
import { Route as PlaylistDetailFileRoute } from "@/routes/playlists/$playlistId";
import { Route as PlaylistsIndexFileRoute } from "@/routes/playlists/index";
import {
  parseDiscoverReleaseIdParam,
  parsePlaylistIdParam,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import {
  readDiscoverInvokeInput,
  tauriString,
} from "@/test/tauriInvoke";

const mocks = {
  fetchDiscover:
    vi.fn<
      (filters: DiscoverFilters, cursor: string) => Promise<DiscoverPage>
    >(),
};

function DiscoverScreenStub({
  filters,
  onFiltersChange,
  onOpenRelease,
}: DiscoverScreenProps) {
  return (
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
        onClick={(event) =>
          onOpenRelease({
            artist: "Signal Garden",
            id: "discover:release-1",
            itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
            title: "Blue Hours",
          }, event.currentTarget)
        }
        type="button"
      >
        Open Blue Hours
      </button>
    </main>
  );
}

function DiscoverReleaseScreenStub({
  onBack,
  release,
}: DiscoverReleaseScreenProps) {
  return (
    <main>
      <h1>Release {release.title}</h1>
      <button onClick={onBack} type="button">
        Back
      </button>
    </main>
  );
}

function PlaylistDetailScreenStub({
  onBack,
  playlistId,
}: PlaylistDetailScreenProps) {
  return (
    <main>
      <h1>Playlist {playlistId}</h1>
      <button onClick={onBack} type="button">
        Back
      </button>
    </main>
  );
}

function PlaylistsScreenStub({ onOpenPlaylist }: PlaylistsScreenProps) {
  return (
    <main>
      <h1>Playlists route</h1>
      <button
        onClick={() => onOpenPlaylist(parsePlaylistIdParam("playlist-1"))}
        type="button"
      >
        Open Night Drive
      </button>
    </main>
  );
}

function installDiscoverBridge(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: async (command: string, args?: InvokeArgs) => {
        if (command !== "discover") {
          throw new Error(`Unexpected Discover command: ${command}`);
        }
        const input = readDiscoverInvokeInput(args);
        return mocks.fetchDiscover(
          validateDiscoverSearch({ sort: input.sort, tag: input.tag }),
          tauriString(input.cursor, "cursor"),
        );
      },
    },
  });
}

function FeatureTestRoot() {
  const router = useRouter();
  const LibrarySessionBoundary = router.options.context.librarySessionBoundary;
  return (
    <LibrarySessionBoundary>
      <Outlet />
    </LibrarySessionBoundary>
  );
}

const originalRootComponent = RootRoute.options.component;
const originalDiscoverLayoutComponent = DiscoverLayoutRoute.options.component;
const originalDiscoverReleaseComponent =
  DiscoverReleaseFileRoute.options.component;
const originalPlaylistsIndexComponent =
  PlaylistsIndexFileRoute.options.component;
const originalPlaylistDetailComponent =
  PlaylistDetailFileRoute.options.component;

function DiscoverLayoutTestRoute() {
  return <DiscoverRouteLayout Screen={DiscoverScreenStub} />;
}

function DiscoverReleaseTestRoute() {
  return <DiscoverReleaseRoute Screen={DiscoverReleaseScreenStub} />;
}

function PlaylistsIndexTestRoute() {
  return <PlaylistsIndexRoute Screen={PlaylistsScreenStub} />;
}

function PlaylistDetailTestRoute() {
  return <PlaylistDetailRoute Screen={PlaylistDetailScreenStub} />;
}

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

beforeAll(() => {
  RootRoute.update({ component: FeatureTestRoot });
  DiscoverLayoutRoute.update({ component: DiscoverLayoutTestRoute });
  DiscoverReleaseFileRoute.update({ component: DiscoverReleaseTestRoute });
  PlaylistsIndexFileRoute.update({ component: PlaylistsIndexTestRoute });
  PlaylistDetailFileRoute.update({ component: PlaylistDetailTestRoute });
});

beforeEach(() => {
  installDiscoverBridge();
  mocks.fetchDiscover.mockReset().mockResolvedValue(discoverPage);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterAll(() => {
  RootRoute.update({ component: originalRootComponent });
  DiscoverLayoutRoute.update({ component: originalDiscoverLayoutComponent });
  DiscoverReleaseFileRoute.update({
    component: originalDiscoverReleaseComponent,
  });
  PlaylistsIndexFileRoute.update({
    component: originalPlaylistsIndexComponent,
  });
  PlaylistDetailFileRoute.update({
    component: originalPlaylistDetailComponent,
  });
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
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
      await screen.findByRole("heading", { name: "Favorites" }),
    ).toBeInTheDocument();
  });
});
