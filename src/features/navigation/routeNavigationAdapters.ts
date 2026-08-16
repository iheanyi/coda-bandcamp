import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import type { DailyRouteNavigationAdapter } from "@/features/daily/DailyRouteNavigationContext";
import type { RadioRouteNavigationAdapter } from "@/features/radio/RadioRouteNavigationContext";
import type { PlaylistRouteNavigationAdapter } from "@/features/saved-library/playlistRouteNavigation";
import {
  getMotionDiagnostic,
  type MotionPhaseTimings,
  updateMotionDiagnostic,
} from "@/motionDiagnostics";
import type { CodaRouter } from "@/router";
import {
  stringifyRadioSeriesIdParam,
  stringifyRadioShowIdParam,
} from "@/routing/routeContracts";

const backNavigationInFlight = new WeakMap<CodaRouter, Promise<void>>();

function activeMotionDiagnosticId(): number | undefined {
  const diagnostic = getMotionDiagnostic();
  return diagnostic?.status === "active" ? diagnostic.id : undefined;
}

function recordRouterPhases(
  diagnosticId: number | undefined,
  phaseTimings: Partial<MotionPhaseTimings>,
): void {
  if (diagnosticId === undefined) return;
  updateMotionDiagnostic(diagnosticId, { phaseTimings });
}

function renderedLocationKey(location: {
  href?: string;
  state: { __TSR_key?: string };
}) {
  return location.state.__TSR_key ?? location.href;
}

/**
 * TanStack navigation is allowed to load and commit asynchronously. Subscribe
 * before starting it so a View Transition update never resolves until React
 * has acknowledged rendering a different route entry. The router's broader
 * settlement promise can include post-render work and must not hold the visual
 * transition after the destination DOM is available.
 */
export function awaitRouterNavigationAfterRender(
  router: CodaRouter,
  navigate: () => void | Promise<void>,
): Promise<void> {
  const navigationStartedAt = performance.now();
  const fromLocationKey = renderedLocationKey(router.state.location);
  const diagnosticId = activeMotionDiagnosticId();

  return new Promise<void>((resolve, reject) => {
    let rendered = false;
    let settled = false;
    let unsubscribe = () => {};

    const finish = () => {
      if (settled || !rendered) return;
      settled = true;
      unsubscribe();
      recordRouterPhases(diagnosticId, {
        routerReleaseMs: performance.now() - navigationStartedAt,
      });
      resolve();
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(cause);
    };

    unsubscribe = router.subscribe("onRendered", (event) => {
      if (renderedLocationKey(event.toLocation) === fromLocationKey) return;
      if (rendered) return;
      recordRouterPhases(diagnosticId, {
        routerRenderMs: performance.now() - navigationStartedAt,
      });
      rendered = true;
      finish();
    });
    let navigation: void | Promise<void>;
    try {
      navigation = navigate();
    } catch (cause) {
      fail(cause);
      return;
    }
    Promise.resolve(navigation).then(() => {
      recordRouterPhases(diagnosticId, {
        routerNavigationMs: performance.now() - navigationStartedAt,
      });
    }, fail);
  });
}

/**
 * Browser history does not return a completion promise. Resolve only after a
 * different history entry has rendered so View Transition snapshots, focus,
 * and scroll restoration all observe the destination DOM.
 */
export function awaitRouterBackAfterRender(router: CodaRouter): Promise<void> {
  const active = backNavigationInFlight.get(router);
  if (active) return active;
  const navigationStartedAt = performance.now();
  const fromLocationKey = renderedLocationKey(router.state.location);
  const diagnosticId = activeMotionDiagnosticId();

  const navigation = new Promise<void>((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = () => {
      if (settled) return;
      settled = true;
      unsubscribe();
      recordRouterPhases(diagnosticId, {
        routerReleaseMs: performance.now() - navigationStartedAt,
      });
      resolve();
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(cause);
    };

    unsubscribe = router.subscribe("onRendered", (event) => {
      const toLocationKey = renderedLocationKey(event.toLocation);
      if (toLocationKey !== fromLocationKey) {
        recordRouterPhases(diagnosticId, {
          routerRenderMs: performance.now() - navigationStartedAt,
        });
        finish();
      }
    });
    try {
      router.history.back();
    } catch (cause) {
      fail(cause);
    }
  });
  backNavigationInFlight.set(router, navigation);
  const clearInFlight = () => {
    if (backNavigationInFlight.get(router) === navigation) {
      backNavigationInFlight.delete(router);
    }
  };
  void navigation.then(clearInFlight, clearInFlight);
  return navigation;
}

/**
 * Route-layout adapter for DailyRouteNavigationProvider. Router-owned
 * transitions stay disabled so the provider can retain the article artwork
 * and title identity through the asynchronous route commit.
 */
export function useDailyRouteNavigationAdapter(): DailyRouteNavigationAdapter {
  const navigate = useNavigate();
  const router = useRouter();
  const goToIndex = useCallback<DailyRouteNavigationAdapter["goToIndex"]>(
    async (category, replace = false) => {
      await awaitRouterNavigationAfterRender(router, () =>
        navigate({
          replace,
          search: { articleSection: undefined, category },
          to: "/daily",
          viewTransition: false,
        }),
      );
    },
    [navigate, router],
  );
  const goToArticle = useCallback<DailyRouteNavigationAdapter["goToArticle"]>(
    async ({ articleSection, category, slug }) => {
      await awaitRouterNavigationAfterRender(router, () =>
        navigate({
          params: { slug },
          search: { articleSection, category },
          to: "/daily/$slug",
          viewTransition: false,
        }),
      );
    },
    [navigate, router],
  );
  const goBack = useCallback<DailyRouteNavigationAdapter["goBack"]>(
    async (category) => {
      if (!router.history.canGoBack()) {
        await goToIndex(category, true);
        return;
      }
      await awaitRouterBackAfterRender(router);
    },
    [goToIndex, router],
  );

  return useMemo(
    () => ({ goBack, goToArticle, goToIndex }),
    [goBack, goToArticle, goToIndex],
  );
}

/**
 * Route-layout adapter for PlaylistRouteNavigationProvider. Every commit opts
 * out of Router-owned transitions so the provider retains its targeted
 * playlist-detail/playlist-detail-close shared animation.
 */
export function usePlaylistRouteNavigationAdapter(): PlaylistRouteNavigationAdapter {
  const navigate = useNavigate();
  const router = useRouter();
  const goToIndex = useCallback<PlaylistRouteNavigationAdapter["goToIndex"]>(
    async (replace = false) => {
      await awaitRouterNavigationAfterRender(router, () =>
        navigate({
          replace,
          to: "/playlists",
          viewTransition: false,
        }),
      );
    },
    [navigate, router],
  );
  const goToPlaylist = useCallback<
    PlaylistRouteNavigationAdapter["goToPlaylist"]
  >(
    async (playlistId) => {
      await awaitRouterNavigationAfterRender(router, () =>
        navigate({
          params: { playlistId },
          to: "/playlists/$playlistId",
          viewTransition: false,
        }),
      );
    },
    [navigate, router],
  );
  const goBack = useCallback<
    PlaylistRouteNavigationAdapter["goBack"]
  >(async () => {
    if (!router.history.canGoBack()) {
      await goToIndex(true);
      return;
    }
    await awaitRouterBackAfterRender(router);
  }, [goToIndex, router]);

  return useMemo(
    () => ({ goBack, goToIndex, goToPlaylist }),
    [goBack, goToIndex, goToPlaylist],
  );
}

/**
 * Route-layout adapter for RadioRouteNavigationProvider. Every commit opts out
 * of Router-owned transitions so the provider retains its targeted
 * radio-detail/radio-detail-close shared animation.
 */
export function useRadioRouteNavigationAdapter(): RadioRouteNavigationAdapter {
  const navigate = useNavigate();
  const router = useRouter();
  const goToIndex = useCallback<RadioRouteNavigationAdapter["goToIndex"]>(
    async (replace = false) => {
      await awaitRouterNavigationAfterRender(router, () =>
        navigate({
          replace,
          to: "/radio",
          viewTransition: false,
        }),
      );
    },
    [navigate, router],
  );
  const goToSeries = useCallback<RadioRouteNavigationAdapter["goToSeries"]>(
    async (seriesId, replace = false) => {
      await awaitRouterNavigationAfterRender(router, () =>
        navigate({
          params: { seriesId: stringifyRadioSeriesIdParam(seriesId) },
          replace,
          to: "/radio/series/$seriesId",
          viewTransition: false,
        }),
      );
    },
    [navigate, router],
  );
  const goToShow = useCallback<RadioRouteNavigationAdapter["goToShow"]>(
    async (showId) => {
      await awaitRouterNavigationAfterRender(router, () =>
        navigate({
          params: { showId: stringifyRadioShowIdParam(showId) },
          to: "/radio/shows/$showId",
          viewTransition: false,
        }),
      );
    },
    [navigate, router],
  );
  const goBack = useCallback<
    RadioRouteNavigationAdapter["goBack"]
  >(async () => {
    if (!router.history.canGoBack()) {
      await goToIndex(true);
      return;
    }
    await awaitRouterBackAfterRender(router);
  }, [goToIndex, router]);

  return useMemo(
    () => ({ goBack, goToIndex, goToSeries, goToShow }),
    [goBack, goToIndex, goToSeries, goToShow],
  );
}
