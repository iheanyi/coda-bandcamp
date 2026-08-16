import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  parsePlaylistIdParam,
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
} from "@/routing/routeContracts";

import { MAX_ROUTE_COMMIT_MS } from "./routeCommit";
import {
  awaitRouterBackAfterRender,
  awaitRouterNavigationAfterRender,
  createRouteNavigationAdapter,
  DAILY_ROUTE_SPEC,
  PLAYLIST_ROUTE_SPEC,
  RADIO_ROUTE_SPEC,
  type RenderedRouterEvent,
} from "./routeNavigationAdapters";

type RenderListener = (event: RenderedRouterEvent) => void;

let renderedListener: RenderListener | undefined;

const adapterMocks = {
  navigate: vi.fn(),
  nextRenderKey: 3,
  router: {
    history: {
      back: vi.fn(),
      canGoBack: vi.fn(() => false),
    },
    state: {
      location: { state: { __TSR_key: "entry-2" } },
    },
    subscribe: vi.fn(),
  },
};

const adapterRuntime = {
  navigate: adapterMocks.navigate,
  router: adapterMocks.router,
};

beforeEach(() => {
  adapterMocks.nextRenderKey = 3;
  renderedListener = undefined;
  adapterMocks.router.state.location.state.__TSR_key = "entry-2";
  adapterMocks.navigate.mockReset().mockImplementation(async () => {
    const nextKey = `entry-${adapterMocks.nextRenderKey++}`;
    adapterMocks.router.state.location.state.__TSR_key = nextKey;
    renderedListener?.({
      toLocation: { state: { __TSR_key: nextKey } },
    });
  });
  adapterMocks.router.history.back.mockReset();
  adapterMocks.router.history.canGoBack.mockReset().mockReturnValue(false);
  adapterMocks.router.subscribe
    .mockReset()
    .mockImplementation(
      (event: string, listener: RenderListener) => {
        if (event === "onRendered") renderedListener = listener;
        return () => {
          if (renderedListener === listener) {
            renderedListener = undefined;
          }
        };
      },
    );
});

afterEach(() => {
  vi.useRealTimers();
});

describe("route navigation adapters", () => {
  it("settles forward navigation only after the destination entry renders", async () => {
    let onRendered:
      | ((
          event: Readonly<{ toLocation: { state: { __TSR_key: string } } }>,
        ) => void)
      | undefined;
    const unsubscribe = vi.fn();
    adapterMocks.router.subscribe.mockImplementation(
      (_event: string, listener: typeof onRendered) => {
        onRendered = listener;
        return unsubscribe;
      },
    );
    const navigate = vi.fn().mockResolvedValue(undefined);
    let settled = false;

    const navigation = awaitRouterNavigationAfterRender(
      adapterMocks.router,
      navigate,
    ).then(() => {
      settled = true;
    });

    expect(navigate).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(settled).toBe(false);

    onRendered?.({ toLocation: { state: { __TSR_key: "entry-3" } } });
    await navigation;

    expect(settled).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not hold a rendered destination on post-render router work", async () => {
    let onRendered:
      | ((
          event: Readonly<{ toLocation: { state: { __TSR_key: string } } }>,
        ) => void)
      | undefined;
    adapterMocks.router.subscribe.mockImplementation(
      (_event: string, listener: typeof onRendered) => {
        onRendered = listener;
        return vi.fn();
      },
    );
    let finishRouterWork = () => {};
    const navigate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRouterWork = resolve;
        }),
    );
    let settled = false;

    const navigation = awaitRouterNavigationAfterRender(
      adapterMocks.router,
      navigate,
    ).then(() => {
      settled = true;
    });

    onRendered?.({ toLocation: { state: { __TSR_key: "entry-3" } } });
    await navigation;

    expect(settled).toBe(true);
    finishRouterWork();
  });

  it("settles browser Back only after a different history entry renders", async () => {
    let onRendered:
      | ((
          event: Readonly<{ toLocation: { state: { __TSR_key: string } } }>,
        ) => void)
      | undefined;
    const unsubscribe = vi.fn();
    adapterMocks.router.subscribe.mockImplementation(
      (_event: string, listener: typeof onRendered) => {
        onRendered = listener;
        return unsubscribe;
      },
    );
    let settled = false;

    const back = awaitRouterBackAfterRender(adapterMocks.router).then(
      () => {
        settled = true;
      },
    );

    expect(adapterMocks.router.history.back).toHaveBeenCalledOnce();
    onRendered?.({ toLocation: { state: { __TSR_key: "entry-2" } } });
    await Promise.resolve();
    expect(settled).toBe(false);

    onRendered?.({ toLocation: { state: { __TSR_key: "entry-1" } } });
    await back;
    expect(settled).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not coalesce browser Back at the adapter layer", async () => {
    const listeners: RenderListener[] = [];
    adapterMocks.router.subscribe.mockImplementation(
      (_event: string, listener: RenderListener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      },
    );

    const first = awaitRouterBackAfterRender(adapterMocks.router);
    const second = awaitRouterBackAfterRender(adapterMocks.router);

    expect(second).not.toBe(first);
    expect(adapterMocks.router.history.back).toHaveBeenCalledTimes(2);

    const firstListener = listeners[0];
    const secondListener = listeners[1];
    firstListener?.({ toLocation: { state: { __TSR_key: "entry-3" } } });
    secondListener?.({ toLocation: { state: { __TSR_key: "entry-3" } } });
    await Promise.all([first, second]);
  });

  it("clears a failed browser Back request so navigation can recover", async () => {
    const failure = new Error("history unavailable");
    const unsubscribe = vi.fn();
    adapterMocks.router.subscribe.mockImplementation(
      (_event: string, listener: RenderListener) => {
        renderedListener = listener;
        return unsubscribe;
      },
    );
    adapterMocks.router.history.back.mockImplementationOnce(() => {
      throw failure;
    });

    await expect(
      awaitRouterBackAfterRender(adapterMocks.router),
    ).resolves.toEqual({
      locationKey: "entry-2",
      outcome: "failed",
    });
    expect(unsubscribe).toHaveBeenCalledOnce();

    const recovered = awaitRouterBackAfterRender(adapterMocks.router);
    renderedListener?.({
      toLocation: { state: { __TSR_key: "entry-1" } },
    });
    await recovered;

    expect(adapterMocks.router.history.back).toHaveBeenCalledTimes(2);
  });

  it("does not let a hung Back block a subsequent Back after the commit bound", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let onRendered:
      | ((
          event: Readonly<{ toLocation: { state: { __TSR_key: string } } }>,
        ) => void)
      | undefined;
    adapterMocks.router.subscribe.mockImplementation(
      (_event: string, listener: typeof onRendered) => {
        onRendered = listener;
        return vi.fn();
      },
    );
    adapterMocks.router.history.back.mockImplementation(() => {
      adapterMocks.router.state.location.state.__TSR_key = "entry-pending";
    });

    const hung = awaitRouterBackAfterRender(adapterMocks.router);
    await vi.advanceTimersByTimeAsync(MAX_ROUTE_COMMIT_MS);
    await hung;

    const recovered = awaitRouterBackAfterRender(adapterMocks.router);
    expect(recovered).not.toBe(hung);
    expect(adapterMocks.router.history.back).toHaveBeenCalledTimes(2);

    onRendered?.({ toLocation: { state: { __TSR_key: "entry-1" } } });
    await recovered;
  });

  it("provides the existing Playlist context with typed, transition-free commits", async () => {
    const playlistId = parsePlaylistIdParam("playlist-1");
    const adapter = createRouteNavigationAdapter(
      adapterRuntime,
      PLAYLIST_ROUTE_SPEC,
    );

    await act(() => adapter.goToPlaylist(playlistId));
    await act(() => adapter.goBack());

    expect(adapterMocks.navigate).toHaveBeenNthCalledWith(1, {
      params: { playlistId },
      to: "/playlists/$playlistId",
      viewTransition: false,
    });
    expect(adapterMocks.navigate).toHaveBeenNthCalledWith(2, {
      replace: true,
      to: "/playlists",
      viewTransition: false,
    });
  });

  it("provides Daily article and archive commits without Router-owned transitions", async () => {
    const adapter = createRouteNavigationAdapter(
      adapterRuntime,
      DAILY_ROUTE_SPEC,
    );

    await act(() =>
      adapter.goToArticle({
        articleSection: "essential-releases",
        category: "genre-jazz",
        slug: "essential-releases-august-7-2026",
      }),
    );
    await act(() => adapter.goBack("genre-jazz"));

    expect(adapterMocks.navigate).toHaveBeenNthCalledWith(1, {
      params: { slug: "essential-releases-august-7-2026" },
      search: {
        articleSection: "essential-releases",
        category: "genre-jazz",
      },
      to: "/daily/$slug",
      viewTransition: false,
    });
    expect(adapterMocks.navigate).toHaveBeenNthCalledWith(2, {
      replace: true,
      search: { articleSection: undefined, category: "genre-jazz" },
      to: "/daily",
      viewTransition: false,
    });
  });

  it("provides typed Radio index, series, show, and Back fallbacks", async () => {
    const seriesId = parseRadioSeriesIdParam(1);
    const showId = parseRadioShowIdParam(42);
    const adapter = createRouteNavigationAdapter(
      adapterRuntime,
      RADIO_ROUTE_SPEC,
    );

    await act(() => adapter.goToSeries(seriesId));
    await act(() => adapter.goToShow(showId));
    await act(() => adapter.goBack());

    expect(adapterMocks.navigate).toHaveBeenNthCalledWith(1, {
      params: { seriesId: String(seriesId) },
      replace: false,
      to: "/radio/series/$seriesId",
      viewTransition: false,
    });
    expect(adapterMocks.navigate).toHaveBeenNthCalledWith(2, {
      params: { showId: String(showId) },
      to: "/radio/shows/$showId",
      viewTransition: false,
    });
    expect(adapterMocks.navigate).toHaveBeenNthCalledWith(3, {
      replace: true,
      to: "/radio",
      viewTransition: false,
    });
  });
});
