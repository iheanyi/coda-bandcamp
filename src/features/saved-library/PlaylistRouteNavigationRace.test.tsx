import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { parsePlaylistIdParam } from "@/routing/routeContracts";

import { PlaylistRouteNavigationProvider } from "./PlaylistRouteNavigationContext";
import {
  usePlaylistRouteNavigation,
  type PlaylistRouteNavigationAdapter,
} from "./playlistRouteNavigation";

type PendingTransition = Readonly<{
  promise: Promise<void>;
  resolve: () => void;
}>;

const transitions = vi.hoisted(() => ({
  pending: [] as PendingTransition[],
}));

vi.mock("@/viewTransitions", () => ({
  transitionCodaView: vi.fn((update: () => void | Promise<void>) => {
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const promise = Promise.resolve()
      .then(update)
      .then(() => completion);
    transitions.pending.push({ promise, resolve: resolveCompletion });
    return promise;
  }),
}));

const playlistId = parsePlaylistIdParam("playlist-1");

function PlaylistHarness() {
  const navigation = usePlaylistRouteNavigation();
  return (
    <>
      <button
        aria-label="Open playlist"
        data-playlist-open={playlistId}
        onClick={() => void navigation.openPlaylist(playlistId)}
        type="button"
      >
        <span
          data-coda-playlist-identity-source={playlistId}
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
    goBack: vi.fn().mockResolvedValue(undefined),
    goToIndex: vi.fn().mockResolvedValue(undefined),
    goToPlaylist: vi.fn().mockResolvedValue(undefined),
  };
}

async function settleTransition(index: number) {
  const transition = transitions.pending[index];
  expect(transition).toBeDefined();
  await act(async () => {
    transition!.resolve();
    await transition!.promise;
  });
}

beforeEach(() => {
  transitions.pending.length = 0;
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
    });

    render(
      <div data-coda-library-scroll>
        <PlaylistRouteNavigationProvider adapter={adapter}>
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

    await settleTransition(0);

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
        <PlaylistRouteNavigationProvider adapter={createAdapter()}>
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

    await settleTransition(0);
    expect(screen.getByText("Playlist identity")).toHaveAttribute(
      "data-coda-playlist-identity-return",
      playlistId,
    );
    expect(screen.getByText("Open playlist")).toHaveAttribute(
      "data-coda-playlist-title-return",
      playlistId,
    );

    await settleTransition(1);
    expect(screen.getByText("Playlist identity")).not.toHaveAttribute(
      "data-coda-playlist-identity-return",
    );
    expect(screen.getByText("Open playlist")).not.toHaveAttribute(
      "data-coda-playlist-title-return",
    );
  });
});
