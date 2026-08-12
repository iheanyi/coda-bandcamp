import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  parsePlaylistIdParam,
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
} from "@/routing/routeContracts";

const adapterMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  nextRenderKey: 3,
  onRendered: undefined as
    | ((
        event: Readonly<{ toLocation: { state: { __TSR_key: string } } }>,
      ) => void)
    | undefined,
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
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => adapterMocks.navigate,
  useRouter: () => adapterMocks.router,
}));

import {
  awaitRouterBackAfterRender,
  awaitRouterNavigationAfterRender,
  usePlaylistRouteNavigationAdapter,
  useRadioRouteNavigationAdapter,
} from "./routeNavigationAdapters";

beforeEach(() => {
  adapterMocks.nextRenderKey = 3;
  adapterMocks.onRendered = undefined;
  adapterMocks.router.state.location.state.__TSR_key = "entry-2";
  adapterMocks.navigate.mockReset().mockImplementation(async () => {
    const nextKey = `entry-${adapterMocks.nextRenderKey++}`;
    adapterMocks.router.state.location.state.__TSR_key = nextKey;
    adapterMocks.onRendered?.({
      toLocation: { state: { __TSR_key: nextKey } },
    });
  });
  adapterMocks.router.history.back.mockReset();
  adapterMocks.router.history.canGoBack.mockReset().mockReturnValue(false);
  adapterMocks.router.subscribe
    .mockReset()
    .mockImplementation(
      (event: string, listener: typeof adapterMocks.onRendered) => {
        if (event === "onRendered") adapterMocks.onRendered = listener;
        return () => {
          if (adapterMocks.onRendered === listener) {
            adapterMocks.onRendered = undefined;
          }
        };
      },
    );
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
      adapterMocks.router as never,
      navigate,
    ).then(() => {
      settled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
    expect(settled).toBe(false);

    onRendered?.({ toLocation: { state: { __TSR_key: "entry-3" } } });
    await navigation;

    expect(settled).toBe(true);
    expect(unsubscribe).toHaveBeenCalledOnce();
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

    const back = awaitRouterBackAfterRender(adapterMocks.router as never).then(
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

  it("provides the existing Playlist context with typed, transition-free commits", async () => {
    const playlistId = parsePlaylistIdParam("playlist-1");
    const { result } = renderHook(() => usePlaylistRouteNavigationAdapter());

    await act(() => result.current.goToPlaylist(playlistId));
    await act(() => result.current.goBack());

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

  it("provides typed Radio index, series, show, and Back fallbacks", async () => {
    const seriesId = parseRadioSeriesIdParam(1);
    const showId = parseRadioShowIdParam(42);
    const { result } = renderHook(() => useRadioRouteNavigationAdapter());

    await act(() => result.current.goToSeries(seriesId));
    await act(() => result.current.goToShow(showId));
    await act(() => result.current.goBack());

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
