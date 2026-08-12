import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DiscoverRuntimeValue } from "@/features/discover/DiscoverRuntimeContext";
import { DiscoverRuntimeProvider } from "@/features/discover/DiscoverRuntimeProvider";
import { createCodaMemoryRouter } from "@/router";
import { parseDiscoverReleaseIdParam } from "@/routing/routeContracts";

const mocks = vi.hoisted(() => ({
  fetchDiscover: vi.fn(),
}));

vi.mock("@/App", async () => {
  const { Outlet } = await import("@tanstack/react-router");
  return { default: Outlet };
});

vi.mock("@/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib")>();
  return {
    ...actual,
    fetchDiscover: mocks.fetchDiscover,
  };
});

function renderDiscoverRoute() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  const router = createCodaMemoryRouter(queryClient, ["/discover"]);
  const onPlay = vi.fn();
  const runtime: DiscoverRuntimeValue = {
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
    onPlay,
    onQueue: vi.fn(),
    onTogglePlayback: vi.fn(),
    playing: false,
  };

  render(
    <QueryClientProvider client={queryClient}>
      <DiscoverRuntimeProvider value={runtime}>
        <RouterProvider router={router} />
      </DiscoverRuntimeProvider>
    </QueryClientProvider>,
  );

  return { onPlay, queryClient, router };
}

beforeEach(() => {
  mocks.fetchDiscover
    .mockReset()
    .mockResolvedValue({
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
    })
    .mockResolvedValueOnce({
      cursor: "next-page",
      hasMore: true,
      resultCount: 2,
      results: [
        {
          artist: "Signal Garden",
          id: "discover:release-1",
          itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
          title: "Blue Hours",
        },
      ],
    })
    .mockResolvedValueOnce({
      hasMore: false,
      resultCount: 2,
      results: [
        {
          artist: "Signal Garden",
          id: "discover:release-2",
          itemUrl: "https://signal-garden.bandcamp.com/album/amber-transit",
          title: "Amber Transit",
        },
      ],
    });
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

describe("Discover route layout", () => {
  it("preloads a release on keyboard focus and reuses the anonymous query on Enter", async () => {
    const user = userEvent.setup();
    const { onPlay, router } = renderDiscoverRoute();
    const preloadRoute = vi.spyOn(router, "preloadRoute");
    const title = await screen.findByRole("link", { name: "Blue Hours" });

    expect(title).toHaveAttribute(
      "href",
      "/discover/releases/discover%3Arelease-1?tag=&sort=top",
    );
    expect(mocks.fetchDiscover).toHaveBeenCalledOnce();

    title.focus();
    expect(title).toHaveFocus();
    await waitFor(() => expect(preloadRoute).toHaveBeenCalledOnce());
    expect(mocks.fetchDiscover).toHaveBeenCalledOnce();

    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("article", { name: "Blue Hours" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(
      "/discover/releases/discover%3Arelease-1",
    );
    expect(onPlay).not.toHaveBeenCalled();
    expect(mocks.fetchDiscover).toHaveBeenCalledOnce();
  });

  it("retains loaded pages and the same screen node across release detail", async () => {
    const { queryClient, router } = renderDiscoverRoute();

    await screen.findByText("Blue Hours");
    const discoverScreen = document.querySelector(
      'section[aria-live="polite"]',
    );
    expect(discoverScreen).toBeInstanceOf(HTMLElement);

    fireEvent.click(
      screen.getByRole("button", { name: "View more discoveries" }),
    );
    expect(await screen.findByText("Amber Transit")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("link", {
        name: "Open Blue Hours Discover details",
      }),
    );
    expect(
      await screen.findByRole("article", { name: "Blue Hours" }),
    ).toBeInTheDocument();
    expect(discoverScreen).toBeInTheDocument();
    expect(discoverScreen?.parentElement).toHaveAttribute("hidden");
    expect(
      queryClient.getQueryData(["discover", { tag: "", sort: "top" }]),
    ).toEqual(
      expect.objectContaining({
        pages: [
          expect.objectContaining({
            results: [expect.objectContaining({ title: "Blue Hours" })],
          }),
          expect.objectContaining({
            results: [expect.objectContaining({ title: "Amber Transit" })],
          }),
        ],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/discover");
    });

    expect(document.querySelector('section[aria-live="polite"]')).toBe(
      discoverScreen,
    );
    expect(screen.getByText("Amber Transit")).toBeInTheDocument();
    expect(mocks.fetchDiscover).toHaveBeenCalledTimes(2);
  });
});
