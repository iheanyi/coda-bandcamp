import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";

import {
  activateDetailDestination,
  clearDestinationFocus,
  closeDetail,
  openDetail,
  restoreDetailScroll,
} from "@/detailNavigation";
import { DETAIL_TRANSITION_DESCRIPTORS } from "@/detailTransitionDescriptors";
import type {
  AlbumId,
  ArtistKey,
  CollectionRouteSearch,
  DiscoverReleaseId,
} from "@/routing/routeContracts";
import {
  transitionCodaView,
  type CodaViewTransitionUpdate,
} from "@/viewTransitions";

import {
  detailTransitionEndpointTargets,
  interactiveTrigger,
  prepareDetailSource,
} from "./detailSourceIdentity";
import {
  awaitRouteCommit,
  routeCommitResult,
  type RouteCommitOutcome,
  type RouteCommitResult,
} from "./routeCommit";
import {
  awaitRouterBackAfterRender,
  awaitRouterNavigationAfterRender,
  type RenderedNavigationRouter,
} from "./routeNavigationAdapters";
import {
  detailDestinationKey,
  type CodaDetailDestination,
  type CodaRouteDestination,
} from "./useRouteDestination";

type CommitPreparation = () => void;

export type AlbumDetailNavigationRequest = Readonly<{
  albumId: AlbumId;
  beforeCommit?: CommitPreparation;
  coldLoad?: boolean;
  kind: "album";
  sourceTrigger?: HTMLElement;
}>;

export type ArtistDetailNavigationRequest = Readonly<{
  artistKey: ArtistKey;
  beforeCommit?: CommitPreparation;
  collectionSearch?: CollectionRouteSearch;
  kind: "artist";
  sourceAlbumId?: AlbumId;
  sourceTrigger?: HTMLElement;
}>;

export type DiscoverDetailNavigationRequest = Readonly<{
  beforeCommit?: CommitPreparation;
  kind: "discover-release";
  releaseId: DiscoverReleaseId;
  releaseTitle: string;
  sourceTrackId?: string;
  sourceTrigger?: HTMLElement;
}>;

export type NowPlayingNavigationRequest = Readonly<{
  beforeCommit?: CommitPreparation;
  kind: "now-playing";
  trackId: string;
}>;

export type DetailNavigationRequest =
  | AlbumDetailNavigationRequest
  | ArtistDetailNavigationRequest
  | DiscoverDetailNavigationRequest
  | NowPlayingNavigationRequest;

export type DetailNavigationOutcome = RouteCommitOutcome | "refocused";

export type DetailNavigationController = Readonly<{
  back: (
    options?: Readonly<{ restoreFocus?: boolean }>,
  ) => Promise<RouteCommitOutcome | undefined>;
  open: (request: DetailNavigationRequest) => Promise<DetailNavigationOutcome>;
  scrollRootRef: RefObject<HTMLElement | null>;
  transitionPrimary: (update: CodaViewTransitionUpdate) => Promise<void>;
}>;

type DetailNavigationRuntime = Readonly<{
  navigate: ReturnType<typeof useNavigate>;
  router: RenderedNavigationRouter;
}>;

type CoordinatedDetailKind = DetailNavigationRequest["kind"];
type CoordinatedDetailDestination = Extract<
  CodaDetailDestination,
  Readonly<{ kind: CoordinatedDetailKind }>
>;

function assertNever(value: never): never {
  throw new TypeError(`Unsupported exhaustive variant: ${String(value)}`);
}

function targetFromRequest(
  request: DetailNavigationRequest,
): CoordinatedDetailDestination {
  switch (request.kind) {
    case "album":
      return { albumId: request.albumId, kind: "album" };
    case "artist":
      return request.sourceAlbumId
        ? {
            artistKey: request.artistKey,
            kind: "artist",
            sourceAlbumId: request.sourceAlbumId,
          }
        : { artistKey: request.artistKey, kind: "artist" };
    case "discover-release":
      return { kind: "discover-release", releaseId: request.releaseId };
    case "now-playing":
      return { kind: "now-playing" };
    default:
      return assertNever(request);
  }
}

function coordinatedDetailDestination(
  destination: CodaDetailDestination | undefined,
): CoordinatedDetailDestination | undefined {
  if (!destination) return undefined;
  switch (destination.kind) {
    case "album":
    case "artist":
    case "discover-release":
    case "now-playing":
      return destination;
    case "playlist":
    case "radio-series":
    case "radio-show":
      return undefined;
    default:
      return assertNever(destination);
  }
}

function detailMarkerIdentity(target: CoordinatedDetailDestination): string {
  switch (target.kind) {
    case "album":
      return target.albumId;
    case "artist":
      return target.artistKey;
    case "discover-release":
      return target.releaseId;
    case "now-playing":
      return "now-playing";
    default:
      return assertNever(target);
  }
}

function targetMatchesDestination(
  target: CoordinatedDetailDestination | undefined,
  destination: CodaDetailDestination | undefined,
): boolean {
  if (!target || !destination || target.kind !== destination.kind) return false;
  switch (target.kind) {
    case "album":
      return (
        destination.kind === "album" && target.albumId === destination.albumId
      );
    case "artist":
      return (
        destination.kind === "artist" &&
        target.artistKey === destination.artistKey &&
        target.sourceAlbumId === destination.sourceAlbumId
      );
    case "discover-release":
      return (
        destination.kind === "discover-release" &&
        target.releaseId === destination.releaseId
      );
    case "now-playing":
      return destination.kind === "now-playing";
    default:
      return assertNever(target);
  }
}

function prepareRequestedDetailSource(
  request: DetailNavigationRequest,
  destination: CodaRouteDestination,
): ReturnType<typeof prepareDetailSource> {
  switch (request.kind) {
    case "album":
      return prepareDetailSource(
        "album",
        request.albumId,
        true,
        request.sourceTrigger,
      );
    case "artist":
      return prepareDetailSource(
        "artist",
        request.artistKey,
        true,
        request.sourceTrigger,
      );
    case "discover-release": {
      const prepared = prepareDetailSource(
        "discover-release",
        request.releaseId,
        true,
        request.sourceTrigger,
      );
      if (prepared.targets?.shared) return prepared;
      return prepareDiscoverNowPlayingSource(request, destination) ?? prepared;
    }
    case "now-playing":
      return prepareDetailSource("now-playing", request.trackId, true);
    default:
      return assertNever(request);
  }
}

function prepareDiscoverNowPlayingSource(
  request: DiscoverDetailNavigationRequest,
  destination: CodaRouteDestination,
): ReturnType<typeof prepareDetailSource> | undefined {
  const trigger = interactiveTrigger(request.sourceTrigger);
  if (
    destination.detail?.kind !== "now-playing" ||
    !request.sourceTrackId ||
    !trigger?.hasAttribute("data-player-album-link")
  ) {
    return undefined;
  }
  const sourceArtwork = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".now-playing__artwork[data-coda-track-id]",
    ),
  ).find(
    (candidate) => candidate.dataset.codaTrackId === request.sourceTrackId,
  );
  const titleCandidate = trigger.querySelector<HTMLElement>(
    '[data-slot="overflow-marquee-text"]',
  );
  const sourceTitle =
    titleCandidate?.textContent?.trim() === request.releaseTitle
      ? titleCandidate
      : undefined;
  if (!sourceArtwork && !sourceTitle) return undefined;
  return {
    identity: request.releaseId,
    sharedIdentityAvailable: Boolean(sourceArtwork),
    sourceTrigger: trigger,
    targets: detailTransitionEndpointTargets(
      trigger,
      sourceArtwork,
      sourceTitle,
    ),
  };
}

function headingFallbackId(
  fromKind: CoordinatedDetailKind | undefined,
  toKind: CoordinatedDetailKind,
): string | undefined {
  if (!fromKind || fromKind === toKind) return undefined;
  const from = DETAIL_TRANSITION_DESCRIPTORS[fromKind];
  const to = DETAIL_TRANSITION_DESCRIPTORS[toKind];
  if (
    !("returnFocusFallsBackToHeading" in from) ||
    !from.returnFocusFallsBackToHeading ||
    !("returnFocusFallsBackToHeading" in to) ||
    !to.returnFocusFallsBackToHeading
  ) {
    return undefined;
  }
  return from.destinationHeadingId;
}

export function useDetailNavigation(
  destination: CodaRouteDestination,
): DetailNavigationController {
  const navigate = useNavigate();
  const router = useRouter();
  return useDetailNavigationWithRuntime(destination, { navigate, router });
}

export function useDetailNavigationWithRuntime(
  destination: CodaRouteDestination,
  runtime: DetailNavigationRuntime,
): DetailNavigationController {
  const scrollRootRef = useRef<HTMLElement>(null);
  const currentDetailKey = detailDestinationKey(destination.detail);

  const commitOpen = useCallback(
    async (request: DetailNavigationRequest): Promise<RouteCommitResult> => {
      switch (request.kind) {
        case "album": {
          const outcome = await awaitRouteCommit(runtime.router, () =>
            runtime.navigate({
              params: { albumId: request.albumId },
              search: destination.collectionSearch,
              to: "/collection/albums/$albumId",
              viewTransition: false,
            }),
          );
          return routeCommitResult(runtime.router, outcome);
        }
        case "artist": {
          const outcome = await awaitRouteCommit(runtime.router, () =>
            runtime.navigate({
              params: { artistKey: request.artistKey },
              search: request.sourceAlbumId
                ? {
                    ...(request.collectionSearch ??
                      destination.collectionSearch),
                    albumId: request.sourceAlbumId,
                    mode: "artists",
                  }
                : {
                    ...(request.collectionSearch ??
                      destination.collectionSearch),
                    mode: "artists",
                  },
              to: "/collection/artists/$artistKey",
              viewTransition: false,
            }),
          );
          return routeCommitResult(runtime.router, outcome);
        }
        case "discover-release": {
          const outcome = await awaitRouteCommit(runtime.router, () =>
            runtime.navigate({
              params: { releaseId: request.releaseId },
              search: destination.discoverSearch,
              to: "/discover/releases/$releaseId",
              viewTransition: false,
            }),
          );
          return routeCommitResult(runtime.router, outcome);
        }
        case "now-playing": {
          const outcome = await awaitRouteCommit(runtime.router, () =>
            runtime.navigate({ to: "/now-playing", viewTransition: false }),
          );
          return routeCommitResult(runtime.router, outcome);
        }
        default:
          return assertNever(request);
      }
    },
    [
      destination.collectionSearch,
      destination.discoverSearch,
      runtime.navigate,
      runtime.router,
    ],
  );

  const open = useCallback<DetailNavigationController["open"]>(
    async (request) => {
      const target = targetFromRequest(request);
      if (targetMatchesDestination(target, destination.detail)) {
        request.beforeCommit?.();
        clearDestinationFocus();
        activateDetailDestination(request.kind, detailDestinationKey(target));
        return "refocused";
      }
      const fallbackId = headingFallbackId(
        coordinatedDetailDestination(destination.detail)?.kind,
        request.kind,
      );
      return openDetail({
        forcePageTransition: Boolean(
          request.kind === "album" && request.coldLoad,
        ),
        headingFallbackId: fallbackId,
        kind: request.kind,
        resetScrollOnOpen: true,
        source: prepareRequestedDetailSource(request, destination),
        targetKey: detailDestinationKey(target),
        update: async () => {
          request.beforeCommit?.();
          return commitOpen(request);
        },
      });
    },
    [commitOpen, destination],
  );

  const back = useCallback<DetailNavigationController["back"]>(
    (options = {}) => {
      const detail = coordinatedDetailDestination(destination.detail);
      if (!detail) return Promise.resolve(undefined);
      return closeDetail({
        identity: detailMarkerIdentity(detail),
        kind: detail.kind,
        requestKey: destination.locationKey,
        restoreFocus: options.restoreFocus !== false,
        targetKey: detailDestinationKey(detail),
        update: async () => {
          if (runtime.router.history.canGoBack()) {
            return awaitRouterBackAfterRender(runtime.router);
          }
          switch (detail.kind) {
            case "album":
            case "now-playing":
              return awaitRouterNavigationAfterRender(runtime.router, () =>
                runtime.navigate({
                  replace: true,
                  search: destination.collectionSearch,
                  to: "/collection",
                  viewTransition: false,
                }),
              );
            case "artist":
              return awaitRouterNavigationAfterRender(runtime.router, () =>
                runtime.navigate({
                  replace: true,
                  search: { ...destination.collectionSearch, mode: "artists" },
                  to: "/collection",
                  viewTransition: false,
                }),
              );
            case "discover-release":
              return awaitRouterNavigationAfterRender(runtime.router, () =>
                runtime.navigate({
                  replace: true,
                  search: destination.discoverSearch,
                  to: "/discover",
                  viewTransition: false,
                }),
              );
            default:
              return assertNever(detail);
          }
        },
      });
    },
    [
      destination.collectionSearch,
      destination.detail,
      destination.discoverSearch,
      destination.locationKey,
      runtime.navigate,
      runtime.router,
    ],
  );

  const transitionPrimary = useCallback(
    (update: CodaViewTransitionUpdate) =>
      transitionCodaView(update, "page-forward"),
    [],
  );

  useLayoutEffect(() => {
    restoreDetailScroll(true);
  }, [currentDetailKey, destination.locationKey]);

  return useMemo(
    () => ({
      back,
      open,
      scrollRootRef,
      transitionPrimary,
    }),
    [back, open, transitionPrimary],
  );
}
