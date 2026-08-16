import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetDetailNavigation } from "@/detailNavigation";
import {
  createRouteNavigationAdapter,
  PLAYLIST_ROUTE_SPEC,
} from "@/features/navigation/routeNavigationAdapters";
import { createCodaMemoryRouter } from "@/router";
import { parsePlaylistIdParam } from "@/routing/routeContracts";
import { installDocumentViewTransitionHarness } from "@/test/documentViewTransitionHarness";

import { PlaylistRouteNavigationProvider } from "./PlaylistRouteNavigationContext";
import {
  usePlaylistRouteNavigation,
  type PlaylistRouteNavigationAdapter,
} from "./playlistRouteNavigation";

let transitionHarness: ReturnType<
  typeof installDocumentViewTransitionHarness
>;

const playlistId = parsePlaylistIdParam("playlist-1");
const RENDERED_PLAYLIST_COMMIT = {
  locationKey: "playlist-rendered",
  outcome: "rendered" as const,
};

function PlaylistHarness() {
  const navigation = usePlaylistRouteNavigation();
  return (
    <>
      <button
        aria-label="Open playlist"
        data-playlist-open={playlistId}
        onClick={(event) =>
          void navigation.openPlaylist({
            playlistId,
            sharedIdentityAvailable: true,
            sourceTrigger: event.currentTarget,
          })
        }
        type="button"
      >
        <span
          data-playlist-identity={playlistId}
        >
          Playlist identity
        </span>
        <span data-playlist-title={playlistId}>
          <span data-slot="overflow-marquee-text">Open playlist</span>
        </span>
      </button>
      <button
        onClick={() => void navigation.closePlaylist(playlistId)}
        type="button"
      >
        Close playlist
      </button>
      <button onClick={navigation.restoreListContext} type="button">
        Restore playlist list
      </button>
    </>
  );
}

function createAdapter(): PlaylistRouteNavigationAdapter {
  return {
    goBack: vi.fn().mockResolvedValue(RENDERED_PLAYLIST_COMMIT),
    goToIndex: vi.fn().mockResolvedValue(RENDERED_PLAYLIST_COMMIT),
    goToPlaylist: vi.fn().mockResolvedValue(RENDERED_PLAYLIST_COMMIT),
  };
}

async function settleTransition(index: number) {
  const pendingTransition = transitionHarness.transitions[index];
  if (!pendingTransition) {
    throw new Error(`Expected pending playlist transition ${index}`);
  }
  await act(async () => {
    pendingTransition.resolve();
    await pendingTransition.finished;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transitionHarness = installDocumentViewTransitionHarness();
});

afterEach(() => {
  resetDetailNavigation();
  transitionHarness.restore();
});

describe("Playlist route transition race cleanup", () => {
  it("waits for a virtualized playlist card and restores its painted markers, scroll, and focus", async () => {
    const scrollTop = 6_200;
    let replacement: HTMLButtonElement | undefined;
    let replacementIdentity: HTMLSpanElement | undefined;
    let replacementTitle: HTMLSpanElement | undefined;
    const adapter = createAdapter();
    vi.mocked(adapter.goBack).mockImplementation(async () => {
      window.requestAnimationFrame(() => {
        const scrollRoot = document.querySelector<HTMLElement>(
          "[data-coda-library-scroll]",
        );
        const trigger = document.createElement("button");
        trigger.dataset.playlistOpen = playlistId;
        trigger.style.setProperty("content-visibility", "auto");
        trigger.textContent = "Deferred playlist";
        const identity = document.createElement("span");
        identity.dataset.playlistIdentity = playlistId;
        identity.textContent = "Deferred identity";
        const titleRoot = document.createElement("span");
        titleRoot.dataset.playlistTitle = playlistId;
        const title = document.createElement("span");
        title.dataset.slot = "overflow-marquee-text";
        title.textContent = "Deferred title";
        titleRoot.append(title);
        trigger.append(identity, titleRoot);
        scrollRoot?.append(trigger);
        replacement = trigger;
        replacementIdentity = identity;
        replacementTitle = title;
      });
      return RENDERED_PLAYLIST_COMMIT;
    });

    render(
      <div data-coda-library-scroll>
        <PlaylistRouteNavigationProvider
          adapter={adapter}
        >
          <PlaylistHarness />
        </PlaylistRouteNavigationProvider>
      </div>,
    );

    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    if (scrollRoot) scrollRoot.scrollTop = scrollTop;
    const source = screen.getByRole("button", { name: "Open playlist" });
    fireEvent.click(source);
    await settleTransition(0);
    source.remove();
    if (scrollRoot) scrollRoot.scrollTop = 0;

    fireEvent.click(screen.getByRole("button", { name: "Close playlist" }));

    await vi.waitFor(() => {
      expect(replacementIdentity).toHaveAttribute(
        "data-coda-playlist-identity-return",
        playlistId,
      );
      expect(replacementTitle).toHaveAttribute(
        "data-coda-playlist-title-return",
        playlistId,
      );
    });
    expect(scrollRoot?.scrollTop).toBe(scrollTop);
    expect(replacement?.style.getPropertyValue("content-visibility")).toBe(
      "visible",
    );

    await settleTransition(1);

    expect(replacement).toHaveFocus();
    expect(replacementIdentity).not.toHaveAttribute(
      "data-coda-playlist-identity-return",
    );
    expect(replacementTitle).not.toHaveAttribute(
      "data-coda-playlist-title-return",
    );
    expect(replacement?.style.getPropertyValue("content-visibility")).toBe(
      "auto",
    );
  });

  it("does not let an older close clear newer same-playlist return markers", async () => {
    render(
      <div data-coda-library-scroll>
        <PlaylistRouteNavigationProvider
          adapter={createAdapter()}
        >
          <PlaylistHarness />
        </PlaylistRouteNavigationProvider>
      </div>,
    );

    const open = screen.getByRole("button", { name: "Open playlist" });
    const close = screen.getByRole("button", { name: "Close playlist" });
    const restore = screen.getByRole("button", {
      name: "Restore playlist list",
    });

    fireEvent.click(open);
    await settleTransition(0);
    fireEvent.click(close);
    await act(async () => Promise.resolve());
    fireEvent.click(restore);
    expect(screen.getByText("Playlist identity")).toHaveAttribute(
      "data-coda-playlist-identity-return",
      playlistId,
    );
    expect(screen.getByText("Open playlist")).toHaveAttribute(
      "data-coda-playlist-title-return",
      playlistId,
    );

    fireEvent.click(open);
    expect(screen.getByText("Playlist identity")).not.toHaveAttribute(
      "data-coda-playlist-identity-return",
    );
    await settleTransition(2);
    fireEvent.click(close);
    await act(async () => Promise.resolve());
    fireEvent.click(restore);
    await vi.waitFor(() => {
      expect(screen.getByText("Playlist identity")).toHaveAttribute(
        "data-coda-playlist-identity-return",
        playlistId,
      );
    });
    expect(screen.getByText("Open playlist")).toHaveAttribute(
      "data-coda-playlist-title-return",
      playlistId,
    );

    await settleTransition(1);
    expect(screen.getByText("Playlist identity")).toHaveAttribute(
      "data-coda-playlist-identity-return",
      playlistId,
    );
    expect(screen.getByText("Open playlist")).toHaveAttribute(
      "data-coda-playlist-title-return",
      playlistId,
    );

    await settleTransition(3);
    expect(screen.getByText("Playlist identity")).not.toHaveAttribute(
      "data-coda-playlist-identity-return",
    );
    expect(screen.getByText("Open playlist")).not.toHaveAttribute(
      "data-coda-playlist-title-return",
    );
  });

  it("coalesces rapid Back requests into one close transaction", async () => {
    const adapter = createAdapter();
    render(
      <div data-coda-library-scroll>
        <PlaylistRouteNavigationProvider
          adapter={adapter}
        >
          <PlaylistHarness />
        </PlaylistRouteNavigationProvider>
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open playlist" }));
    await settleTransition(0);

    const close = screen.getByRole("button", { name: "Close playlist" });
    fireEvent.click(close);
    fireEvent.click(close);
    await act(async () => Promise.resolve());

    expect(transitionHarness.transitions.map(({ kind }) => kind)).toEqual([
      "playlist-detail",
      "playlist-detail-close",
    ]);
    expect(adapter.goBack).toHaveBeenCalledOnce();

    await settleTransition(1);
  });

  it("keeps a failed playlist leave on the deleted URL until index replace", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createCodaMemoryRouter(queryClient, [
      "/playlists",
      `/playlists/${playlistId}`,
    ]);
    await router.load();
    expect(router.state.location.pathname).toBe(`/playlists/${playlistId}`);

    const adapter = createRouteNavigationAdapter(
      {
        navigate: (options) => router.navigate(options),
        router,
      },
      PLAYLIST_ROUTE_SPEC,
    );
    vi.spyOn(router.history, "back").mockImplementation(() => {
      throw new Error("leave failed");
    });

    const failedLeave = await adapter.goBack();
    expect(failedLeave.outcome).toBe("failed");
    expect(router.state.location.pathname).toBe(`/playlists/${playlistId}`);

    await router.navigate({
      replace: true,
      to: "/playlists",
      viewTransition: false,
    });
    expect(router.state.location.pathname).toBe("/playlists");
  });
});
