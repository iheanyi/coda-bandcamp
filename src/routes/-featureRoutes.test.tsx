import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  mocks,
  renderApp,
} from "@/test/appTestHarness";
import type {
  DiscoverPage,
  PlaylistDetail,
  PlaylistSummary,
} from "@/types";

const discoverPage: DiscoverPage = {
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

const playlistSummary: PlaylistSummary = {
  duration: 188,
  id: "playlist-1",
  name: "Night Drive",
  songCount: 1,
};

const playlistDetail: PlaylistDetail = {
  ...playlistSummary,
  tracks: [
    {
      album: "Mirage",
      albumId: "album-1",
      artist: "Sweeps",
      duration: 188,
      id: "song-1",
      palette: ["#a66", "#222"],
      title: "Mirage",
      track: 1,
    },
  ],
};

beforeEach(() => {
  mocks.fetchDiscover.mockResolvedValue(discoverPage);
  mocks.fetchPlaylist.mockResolvedValue(playlistDetail);
  mocks.fetchPlaylists.mockResolvedValue([playlistSummary]);
});

describe("feature file routes", () => {
  it("owns validated Discover search and replaces filter changes", async () => {
    const user = userEvent.setup();
    const { router } = renderApp({
      initialEntries: [
        "/discover?tag=ambient&sort=new&unexpected=value",
      ],
    });

    expect(
      await screen.findByRole("heading", { name: "Discover" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Search Discover by tag")).toHaveValue(
      "ambient",
    );
    expect(
      screen.getByRole("combobox", { name: "Sort Discover results" }),
    ).toHaveTextContent("New arrivals");

    await user.click(
      within(
        screen.getByRole("navigation", {
          name: "Filter Discover by genre",
        }),
      ).getByRole("button", { name: "Jazz" }),
    );
    const sort = screen.getByRole("combobox", {
      name: "Sort Discover results",
    });
    await user.click(sort);
    await user.click(
      await screen.findByRole("option", { name: "Best-selling" }),
    );

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
    const { queryClient, router } = renderApp({
      initialEntries: ["/discover"],
    });

    await user.click(
      await screen.findByRole("link", {
        name: "Open Blue Hours Discover details",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Blue Hours" }),
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
    const { router } = renderApp({ initialEntries: ["/discover"] });
    const discoverHeading = await screen.findByRole("heading", {
      name: "Discover",
    });
    const discoverScreen = discoverHeading.closest("section");
    expect(discoverScreen).not.toBeNull();

    await user.click(
      await screen.findByRole("link", {
        name: "Open Blue Hours Discover details",
      }),
    );

    expect(
      await screen.findByRole("heading", { name: "Blue Hours" }),
    ).toBeInTheDocument();
    expect(discoverScreen).toBeInTheDocument();
    expect(discoverScreen?.parentElement).toHaveAttribute("hidden");

    await user.click(screen.getByRole("button", { name: "Back" }));

    const restoredHeading = await screen.findByRole("heading", {
      name: "Discover",
    });
    expect(restoredHeading.closest("section")).toBe(discoverScreen);
    expect(discoverScreen?.parentElement).not.toHaveAttribute("hidden");
    expect(router.state.location.pathname).toBe("/discover");
  });

  it("explains the bounded direct-reload limitation for an uncached Discover release", async () => {
    renderApp({
      initialEntries: ["/discover/releases/discover:missing"],
    });

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

  it("uses typed playlist navigation for the production list and detail screens", async () => {
    const user = userEvent.setup();
    const { router } = renderApp({
      connectedLibrary: [],
      initialEntries: ["/playlists"],
    });

    await user.click(
      await screen.findByRole("link", { name: /Night Drive/u }),
    );

    expect(
      await screen.findByRole("heading", { name: "Night Drive" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/playlists/playlist-1");
  });

  it("falls back to the playlist list when direct detail history cannot pop", async () => {
    const user = userEvent.setup();
    const { router } = renderApp({
      connectedLibrary: [],
      initialEntries: ["/playlists/playlist-1"],
    });

    await user.click(
      await screen.findByRole("button", { name: "Back" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Playlists" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/playlists");
  });

  it("renders Favorites through the production Saved Library runtime", async () => {
    renderApp({
      connectedLibrary: [],
      initialEntries: ["/favorites"],
    });

    expect(
      await screen.findByRole("heading", { name: "Favorites" }),
    ).toBeInTheDocument();
  });
});
