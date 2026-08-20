import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMemo } from "react";

import type { DailyRouteNavigationAdapter } from "@/features/daily/DailyRouteNavigationContext";
import type { RadioRouteNavigationAdapter } from "@/features/radio/RadioRouteNavigationContext";
import type { PlaylistRouteNavigationAdapter } from "@/features/saved-library/playlistRouteNavigation";
import type { OwnDataValue } from "@/ownData";
import {
  stringifyRadioSeriesIdParam,
  stringifyRadioShowIdParam,
} from "@/routing/routeContracts";

import {
  awaitRouteCommit,
  routeCommitResult,
  type RouteCommitResult,
} from "./routeCommit";

export type RenderedRouterLocation = Readonly<{
  href?: string;
  pathname?: string;
  search?: OwnDataValue;
  state: Readonly<{ __TSR_key?: string }>;
}>;

export type RenderedRouterEvent = Readonly<{
  toLocation: RenderedRouterLocation;
}>;

export type RenderedNavigationRouter = Readonly<{
  history: Readonly<{
    back: () => void;
    canGoBack: () => boolean;
  }>;
  state: Readonly<{ location: RenderedRouterLocation }>;
  subscribe: (
    event: "onRendered",
    listener: (event: RenderedRouterEvent) => void,
  ) => () => void;
}>;

type RouteNavigationAdapterRuntime = Readonly<{
  navigate: ReturnType<typeof useNavigate>;
  router: RenderedNavigationRouter;
}>;

export const DAILY_ROUTE_SPEC = { kind: "daily" } as const;
export const PLAYLIST_ROUTE_SPEC = { kind: "playlist" } as const;
export const RADIO_ROUTE_SPEC = { kind: "radio" } as const;

type DailyDetailRouteSpec = typeof DAILY_ROUTE_SPEC;
type PlaylistDetailRouteSpec = typeof PLAYLIST_ROUTE_SPEC;
type RadioDetailRouteSpec = typeof RADIO_ROUTE_SPEC;
type DetailRouteSpec =
  DailyDetailRouteSpec | PlaylistDetailRouteSpec | RadioDetailRouteSpec;

function assertNever(value: never): never {
  throw new TypeError(`Unsupported exhaustive variant: ${String(value)}`);
}

async function awaitBoundedRouterCommit(
  router: RenderedNavigationRouter,
  commit: () => void | Promise<void>,
): Promise<RouteCommitResult> {
  const outcome = await awaitRouteCommit(router, commit);
  return routeCommitResult(router, outcome);
}

/**
 * TanStack navigation is allowed to load and commit asynchronously. Subscribe
 * before starting it so a View Transition update never resolves until React
 * has acknowledged rendering a different route entry. The router's broader
 * settlement promise can include post-render work and must not hold the visual
 * transition after the destination DOM is available.
 */
export function awaitRouterNavigationAfterRender(
  router: RenderedNavigationRouter,
  navigate: () => void | Promise<void>,
): Promise<RouteCommitResult> {
  return awaitBoundedRouterCommit(router, navigate);
}

/**
 * Browser history does not return a completion promise. Resolve only after a
 * different history entry has rendered so View Transition snapshots, focus,
 * and scroll restoration all observe the destination DOM.
 */
export function awaitRouterBackAfterRender(
  router: RenderedNavigationRouter,
): Promise<RouteCommitResult> {
  return awaitBoundedRouterCommit(router, () => {
    router.history.back();
  });
}

function createDailyRouteNavigationAdapter(
  runtime: RouteNavigationAdapterRuntime,
): DailyRouteNavigationAdapter {
  const goToIndex: DailyRouteNavigationAdapter["goToIndex"] = async (
    category,
    replace = false,
  ) => {
    return awaitRouterNavigationAfterRender(runtime.router, () =>
      runtime.navigate({
        replace,
        search: { articleSection: undefined, category },
        to: "/daily",
        viewTransition: false,
      }),
    );
  };
  const goToArticle: DailyRouteNavigationAdapter["goToArticle"] = async ({
    articleSection,
    category,
    slug,
  }) => {
    return awaitRouterNavigationAfterRender(runtime.router, () =>
      runtime.navigate({
        params: { slug },
        search: { articleSection, category },
        to: "/daily/$slug",
        viewTransition: false,
      }),
    );
  };
  const goBack: DailyRouteNavigationAdapter["goBack"] = async (category) => {
    if (!runtime.router.history.canGoBack()) {
      return goToIndex(category, true);
    }
    return awaitRouterBackAfterRender(runtime.router);
  };
  return { goBack, goToArticle, goToIndex };
}

function createPlaylistRouteNavigationAdapter(
  runtime: RouteNavigationAdapterRuntime,
): PlaylistRouteNavigationAdapter {
  const goToIndex: PlaylistRouteNavigationAdapter["goToIndex"] = async (
    replace = false,
  ) => {
    return awaitRouterNavigationAfterRender(runtime.router, () =>
      runtime.navigate({
        replace,
        to: "/playlists",
        viewTransition: false,
      }),
    );
  };
  const goToPlaylist: PlaylistRouteNavigationAdapter["goToPlaylist"] = async (
    playlistId,
  ) => {
    return awaitRouterNavigationAfterRender(runtime.router, () =>
      runtime.navigate({
        params: { playlistId },
        to: "/playlists/$playlistId",
        viewTransition: false,
      }),
    );
  };
  const goBack: PlaylistRouteNavigationAdapter["goBack"] = async () => {
    if (!runtime.router.history.canGoBack()) {
      return goToIndex(true);
    }
    return awaitRouterBackAfterRender(runtime.router);
  };
  return { goBack, goToIndex, goToPlaylist };
}

function createRadioRouteNavigationAdapter(
  runtime: RouteNavigationAdapterRuntime,
): RadioRouteNavigationAdapter {
  const goToIndex: RadioRouteNavigationAdapter["goToIndex"] = async (
    replace = false,
  ) => {
    return awaitRouterNavigationAfterRender(runtime.router, () =>
      runtime.navigate({
        replace,
        to: "/radio",
        viewTransition: false,
      }),
    );
  };
  const goToSeries: RadioRouteNavigationAdapter["goToSeries"] = async (
    seriesId,
    replace = false,
  ) => {
    return awaitRouterNavigationAfterRender(runtime.router, () =>
      runtime.navigate({
        params: { seriesId: stringifyRadioSeriesIdParam(seriesId) },
        replace,
        to: "/radio/series/$seriesId",
        viewTransition: false,
      }),
    );
  };
  const goToShow: RadioRouteNavigationAdapter["goToShow"] = async (showId) => {
    return awaitRouterNavigationAfterRender(runtime.router, () =>
      runtime.navigate({
        params: { showId: stringifyRadioShowIdParam(showId) },
        to: "/radio/shows/$showId",
        viewTransition: false,
      }),
    );
  };
  const goBack: RadioRouteNavigationAdapter["goBack"] = async () => {
    if (!runtime.router.history.canGoBack()) {
      return goToIndex(true);
    }
    return awaitRouterBackAfterRender(runtime.router);
  };
  return { goBack, goToIndex, goToSeries, goToShow };
}

export function createRouteNavigationAdapter(
  runtime: RouteNavigationAdapterRuntime,
  spec: DailyDetailRouteSpec,
): DailyRouteNavigationAdapter;
export function createRouteNavigationAdapter(
  runtime: RouteNavigationAdapterRuntime,
  spec: PlaylistDetailRouteSpec,
): PlaylistRouteNavigationAdapter;
export function createRouteNavigationAdapter(
  runtime: RouteNavigationAdapterRuntime,
  spec: RadioDetailRouteSpec,
): RadioRouteNavigationAdapter;
export function createRouteNavigationAdapter(
  runtime: RouteNavigationAdapterRuntime,
  spec: DetailRouteSpec,
):
  | DailyRouteNavigationAdapter
  | PlaylistRouteNavigationAdapter
  | RadioRouteNavigationAdapter;
export function createRouteNavigationAdapter(
  runtime: RouteNavigationAdapterRuntime,
  spec: DetailRouteSpec,
):
  | DailyRouteNavigationAdapter
  | PlaylistRouteNavigationAdapter
  | RadioRouteNavigationAdapter {
  switch (spec.kind) {
    case "daily":
      return createDailyRouteNavigationAdapter(runtime);
    case "playlist":
      return createPlaylistRouteNavigationAdapter(runtime);
    case "radio":
      return createRadioRouteNavigationAdapter(runtime);
    default:
      return assertNever(spec);
  }
}

export function useRouteNavigationAdapter(
  spec: DailyDetailRouteSpec,
): DailyRouteNavigationAdapter;
export function useRouteNavigationAdapter(
  spec: PlaylistDetailRouteSpec,
): PlaylistRouteNavigationAdapter;
export function useRouteNavigationAdapter(
  spec: RadioDetailRouteSpec,
): RadioRouteNavigationAdapter;
export function useRouteNavigationAdapter(
  spec: DetailRouteSpec,
):
  | DailyRouteNavigationAdapter
  | PlaylistRouteNavigationAdapter
  | RadioRouteNavigationAdapter {
  const navigate = useNavigate();
  const router = useRouter();
  return useMemo(
    () => createRouteNavigationAdapter({ navigate, router }, spec),
    [navigate, router, spec],
  );
}
