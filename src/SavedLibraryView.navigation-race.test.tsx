import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PLAYLISTS_QUERY_KEY,
  playlistQueryKey,
} from "@/queries/savedLibraryQueries";
import type { PlaylistDetail, PlaylistSummary, Track } from "@/types";
import { renderSavedLibraryRoute } from "@/test/savedLibraryViewTestHarness";

type PendingTransition = Readonly<{
  kind: string;
  promise: Promise<void>;
  resolve: () => void;
}>;

type PendingTransitions = {
  pending: PendingTransition[];
};

const transitions: PendingTransitions = { pending: [] };
const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);
const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const updateCallbackDone = Promise.resolve(update());
  const promise = updateCallbackDone.then(() => completion);
  const kind = document.documentElement.classList.contains(
    "coda-transition--playlist-detail-close",
  )
    ? "playlist-detail-close"
    : "playlist-detail";
  transitions.pending.push({
    kind,
    promise,
    resolve: resolveCompletion,
  });
  return {
    finished: promise,
    skipTransition: resolveCompletion,
    updateCallbackDone,
  };
});

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

function renderSavedLibrary(includeSecondPlaylist = false) {
  return renderSavedLibraryRoute({
    initialEntry: "/playlists",
    seedQueryClient: (queryClient) => {
      queryClient.setQueryData(
        PLAYLISTS_QUERY_KEY,
        includeSecondPlaylist ? [summary, secondSummary] : [summary],
      );
      queryClient.setQueryData(playlistQueryKey(summary.id), detail);
      if (includeSecondPlaylist) {
        queryClient.setQueryData(
          playlistQueryKey(secondSummary.id),
          secondDetail,
        );
      }
    },
  });
}

async function settleTransition(index: number) {
  const pendingTransition = transitions.pending[index];
  if (!pendingTransition) {
    throw new Error(`Expected pending playlist transition ${index}`);
  }
  await act(async () => {
    pendingTransition.resolve();
    await pendingTransition.promise;
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
  transitions.pending.length = 0;
  startViewTransition.mockClear();
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: startViewTransition,
  });
});

afterEach(() => {
  document.documentElement.classList.remove(
    "coda-transition--playlist-detail",
    "coda-transition--playlist-detail-close",
  );
  if (originalStartViewTransition) {
    Object.defineProperty(
      document,
      "startViewTransition",
      originalStartViewTransition,
    );
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
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

    expect(transitions.pending).toHaveLength(2);
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
    expect(transitions.pending[0]?.kind).toBe("playlist-detail");
    await settleTransition(0);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("link", { name: /Night drive/u });
    expect(transitions.pending[1]?.kind).toBe("playlist-detail-close");
    expectReturnMarkers();

    fireEvent.click(screen.getByRole("link", { name: /Night drive/u }));
    await screen.findByRole("heading", { name: summary.name });
    await settleTransition(2);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("link", { name: /Night drive/u });
    expect(transitions.pending[3]?.kind).toBe("playlist-detail-close");
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
