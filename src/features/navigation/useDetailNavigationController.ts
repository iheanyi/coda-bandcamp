import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  type RefObject,
} from "react";

import {
  createNavigationTransactionState,
  replaceNavigationTransaction,
  resolveNavigationReturnFocus,
  resolveNavigationReturnScrollTop,
  settleNavigationTransaction,
  type NavigationTransaction,
  type NavigationTransactionState,
} from "@/navigationTransaction";
import type {
  AlbumId,
  ArtistKey,
  CollectionRouteSearch,
  DiscoverReleaseId,
} from "@/routing/routeContracts";
import {
  transitionCodaView,
  type CodaViewTransitionKind,
  type CodaViewTransitionUpdate,
} from "@/viewTransitions";

import {
  awaitRouterBackAfterRender,
  awaitRouterNavigationAfterRender,
} from "./routeNavigationAdapters";
import { awaitVirtualReturnTrigger } from "./virtualReturnEndpoint";
import {
  detailDestinationKey,
  type CodaDetailDestination,
  type CodaRouteDestination,
} from "./useRouteDestination";
import {
  markAlbumReturnDestination,
  markArtistReturnDestination,
  prepareDetailSource,
  type PreparedDetailSource,
} from "./detailSourceIdentity";

type CommitPreparation = () => void;

export type AlbumDetailNavigationRequest = Readonly<{
  albumId: AlbumId;
  beforeCommit?: CommitPreparation;
  /** Hydration state is deliberately orthogonal to transition ownership. */
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

type CoordinatedDetailKind = DetailNavigationRequest["kind"];
type CoordinatedDetailDestination = Extract<
  CodaDetailDestination,
  Readonly<{ kind: CoordinatedDetailKind }>
>;

export type DetailNavigationOutcome = "navigated" | "refocused";

export type DetailNavigationController = Readonly<{
  back: (options?: Readonly<{ restoreFocus?: boolean }>) => Promise<void>;
  open: (request: DetailNavigationRequest) => Promise<DetailNavigationOutcome>;
  scrollRootRef: RefObject<HTMLElement | null>;
  transitionPrimary: (update: CodaViewTransitionUpdate) => Promise<void>;
}>;

type DetailCoordinator = {
  focusedIdentity: number;
  navigation: NavigationTransactionState;
  restoreFocus: boolean;
  returnFocusRequested: boolean;
  returnToDestinationHeading: boolean;
  target?: CoordinatedDetailDestination;
};

type DetailCoordinators = Record<CoordinatedDetailKind, DetailCoordinator>;

type ManualFocusRequest = Readonly<{
  headingId: string;
  target: CoordinatedDetailDestination;
}>;

const DESTINATION_HEADING_IDS: Record<CoordinatedDetailKind, string> = {
  album: "album-detail-heading",
  artist: "artist-detail-heading",
  "discover-release": "discover-release-heading",
  "now-playing": "now-playing-heading",
};

const ROUTE_KEYS: Record<CoordinatedDetailKind, string> = {
  album: "album-detail",
  artist: "artist-detail",
  "discover-release": "discover-detail",
  "now-playing": "now-playing-detail",
};

const MAX_DOM_RESTORE_ATTEMPTS = 8;

function createCoordinator(): DetailCoordinator {
  return {
    focusedIdentity: 0,
    navigation: createNavigationTransactionState(),
    restoreFocus: true,
    returnFocusRequested: false,
    returnToDestinationHeading: false,
  };
}

function createDetailCoordinators(): DetailCoordinators {
  return {
    album: createCoordinator(),
    artist: createCoordinator(),
    "discover-release": createCoordinator(),
    "now-playing": createCoordinator(),
  };
}

function targetFromRequest(
  request: DetailNavigationRequest,
): CoordinatedDetailDestination {
  switch (request.kind) {
    case "album":
      return { kind: "album", albumId: request.albumId };
    case "artist":
      return {
        kind: "artist",
        artistKey: request.artistKey,
        ...(request.sourceAlbumId
          ? { sourceAlbumId: request.sourceAlbumId }
          : {}),
      };
    case "discover-release":
      return { kind: "discover-release", releaseId: request.releaseId };
    case "now-playing":
      return { kind: "now-playing" };
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
  }
}

function transitionKindForOpen(
  request: DetailNavigationRequest,
  source: PreparedDetailSource,
): CodaViewTransitionKind {
  switch (request.kind) {
    case "album":
      return source.sharedElementOwner ? "album-detail" : "page-forward";
    case "artist":
      return source.sharedElementOwner ? "artist-detail" : "page-forward";
    case "discover-release":
      return source.sharedElementOwner ? "discover-detail" : "page-forward";
    case "now-playing":
      return "now-playing-open";
  }
}

function replacementNavigationTrigger(
  transaction: NavigationTransaction,
  target: CoordinatedDetailDestination,
): HTMLElement | undefined {
  const sourceSlot = transaction.sourceTrigger?.dataset.navigationSlot;
  switch (target.kind) {
    case "album":
      return Array.from(
        document.querySelectorAll<HTMLElement>("[data-album-open]"),
      ).find(
        (candidate) =>
          candidate.dataset.albumOpen === target.albumId &&
          (!sourceSlot || candidate.dataset.navigationSlot === sourceSlot),
      );
    case "artist":
      return Array.from(
        document.querySelectorAll<HTMLElement>("[data-artist-open]"),
      ).find(
        (candidate) =>
          candidate.dataset.artistOpen === target.artistKey &&
          (!sourceSlot || candidate.dataset.navigationSlot === sourceSlot),
      );
    case "discover-release": {
      if (sourceSlot === "player-album") {
        return (
          document.querySelector<HTMLElement>("[data-player-album-link]") ??
          undefined
        );
      }
      const card = Array.from(
        document.querySelectorAll<HTMLElement>("[data-discover-release-card]"),
      ).find(
        (candidate) =>
          candidate.dataset.discoverReleaseCard === target.releaseId,
      );
      if (!card) return undefined;
      if (sourceSlot === "discover-artwork") {
        return (
          card
            .querySelector<HTMLElement>("[data-coda-discover-artwork]")
            ?.querySelector<HTMLElement>("a[href], button") ?? undefined
        );
      }
      if (sourceSlot === "discover-title") {
        return (
          card
            .querySelector<HTMLElement>("[data-coda-discover-title]")
            ?.closest<HTMLElement>("a[href], button") ?? undefined
        );
      }
      return undefined;
    }
    case "now-playing": {
      const trackId = transaction.sourceTrigger?.dataset.codaTrackId;
      if (!trackId) return undefined;
      return Array.from(
        document.querySelectorAll<HTMLElement>(
          ".player__art-link[data-coda-track-id]",
        ),
      ).find((candidate) => candidate.dataset.codaTrackId === trackId);
    }
  }
}

function destinationHeadingId(
  destination: CodaDetailDestination | undefined,
): string | undefined {
  if (!destination) return undefined;
  switch (destination.kind) {
    case "album":
    case "artist":
    case "discover-release":
    case "now-playing":
      return DESTINATION_HEADING_IDS[destination.kind];
    case "playlist":
      return "playlist-detail-heading";
    case "radio-show":
      return "radio-detail-title";
    case "radio-series":
      return undefined;
  }
}

/**
 * Owns transient DOM choreography for root-level detail routes. The generated
 * route location remains the sole destination state; refs hold only bounded
 * source identity, return focus, and return scroll coordination.
 */
export function useDetailNavigationController(
  destination: CodaRouteDestination,
): DetailNavigationController {
  const navigate = useNavigate();
  const router = useRouter();
  const scrollRootRef = useRef<HTMLElement>(null);
  const pendingScrollTopRef = useRef<number | undefined>(undefined);
  const coordinatorsRef = useRef<DetailCoordinators>(
    createDetailCoordinators(),
  );
  const activeSourceReleaseRef = useRef<(() => void) | undefined>(undefined);
  const returnGenerationRef = useRef(0);
  const manualFocusRequestRef = useRef<ManualFocusRequest | undefined>(
    undefined,
  );
  const [domRequestVersion, requestDomWork] = useReducer(
    (version: number) => version + 1,
    0,
  );
  const currentDetailKey = detailDestinationKey(destination.detail);

  const commitNavigation = useCallback(
    async (request: DetailNavigationRequest) => {
      switch (request.kind) {
        case "album":
          await awaitRouterNavigationAfterRender(router, () =>
            navigate({
              params: { albumId: request.albumId },
              search: destination.collectionSearch,
              to: "/collection/albums/$albumId",
              viewTransition: false,
            }),
          );
          return;
        case "artist":
          await awaitRouterNavigationAfterRender(router, () =>
            navigate({
              params: { artistKey: request.artistKey },
              search: {
                ...(request.collectionSearch ?? destination.collectionSearch),
                mode: "artists",
                ...(request.sourceAlbumId
                  ? { albumId: request.sourceAlbumId }
                  : {}),
              },
              to: "/collection/artists/$artistKey",
              viewTransition: false,
            }),
          );
          return;
        case "discover-release":
          await awaitRouterNavigationAfterRender(router, () =>
            navigate({
              params: { releaseId: request.releaseId },
              search: destination.discoverSearch,
              to: "/discover/releases/$releaseId",
              viewTransition: false,
            }),
          );
          return;
        case "now-playing":
          await awaitRouterNavigationAfterRender(router, () =>
            navigate({ to: "/now-playing", viewTransition: false }),
          );
      }
    },
    [
      destination.collectionSearch,
      destination.discoverSearch,
      navigate,
      router,
    ],
  );

  const open = useCallback<DetailNavigationController["open"]>(
    async (request) => {
      returnGenerationRef.current += 1;
      const target = targetFromRequest(request);
      if (targetMatchesDestination(target, destination.detail)) {
        request.beforeCommit?.();
        manualFocusRequestRef.current = {
          headingId: DESTINATION_HEADING_IDS[request.kind],
          target,
        };
        requestDomWork();
        return "refocused";
      }

      const source = prepareDetailSource(request, destination);
      const coordinator = coordinatorsRef.current[request.kind];
      const returnScrollTop = scrollRootRef.current?.scrollTop ?? 0;
      coordinator.navigation = replaceNavigationTransaction(
        coordinator.navigation,
        {
          routeKey: ROUTE_KEYS[request.kind],
          intent: "forward",
          entrance: source.sharedElementOwner
            ? "shared-element"
            : "page-forward",
          sourceTrigger: source.sourceTrigger,
          returnScrollTop,
          destinationHeadingId: DESTINATION_HEADING_IDS[request.kind],
          sharedElementOwner: source.sharedElementOwner,
        },
      );
      coordinator.target = target;
      coordinator.restoreFocus = true;
      coordinator.returnFocusRequested = false;
      coordinator.returnToDestinationHeading =
        request.kind === "now-playing" &&
        destination.detail?.kind === "discover-release";
      manualFocusRequestRef.current = undefined;
      pendingScrollTopRef.current = 0;
      requestDomWork();

      activeSourceReleaseRef.current?.();
      const clearMarkers = source.applyMarkers();
      activeSourceReleaseRef.current = clearMarkers;
      try {
        await transitionCodaView(
          async () => {
            request.beforeCommit?.();
            await commitNavigation(request);
          },
          transitionKindForOpen(request, source),
        );
      } finally {
        clearMarkers();
        if (activeSourceReleaseRef.current === clearMarkers) {
          activeSourceReleaseRef.current = undefined;
        }
      }
      return "navigated";
    },
    [commitNavigation, destination],
  );

  const commitFallback = useCallback(
    async (detail: CoordinatedDetailDestination) => {
      switch (detail.kind) {
        case "album":
        case "now-playing":
          await navigate({
            replace: true,
            search: destination.collectionSearch,
            to: "/collection",
            viewTransition: false,
          });
          return;
        case "artist":
          await navigate({
            replace: true,
            search: { ...destination.collectionSearch, mode: "artists" },
            to: "/collection",
            viewTransition: false,
          });
          return;
        case "discover-release":
          await navigate({
            replace: true,
            search: destination.discoverSearch,
            to: "/discover",
            viewTransition: false,
          });
      }
    },
    [destination.collectionSearch, destination.discoverSearch, navigate],
  );

  const back = useCallback<DetailNavigationController["back"]>(
    async (options = {}) => {
      const detail = destination.detail;
      if (
        !detail ||
        (detail.kind !== "album" &&
          detail.kind !== "artist" &&
          detail.kind !== "discover-release" &&
          detail.kind !== "now-playing")
      ) {
        return;
      }
      const coordinator = coordinatorsRef.current[detail.kind];
      const transaction = targetMatchesDestination(coordinator.target, detail)
        ? coordinator.navigation.active
        : undefined;
      const returnToDestinationHeading = coordinator.returnToDestinationHeading;
      const returnGeneration = ++returnGenerationRef.current;
      const isCurrentReturn = () =>
        returnGenerationRef.current === returnGeneration;
      coordinator.returnFocusRequested = Boolean(transaction);
      coordinator.restoreFocus = options.restoreFocus !== false;
      const returnScrollTop = transaction
        ? resolveNavigationReturnScrollTop(transaction)
        : 0;
      pendingScrollTopRef.current = returnScrollTop;
      requestDomWork();

      let releaseReturnDestination = () => {};
      let replacementAfterBack: HTMLElement | undefined;
      try {
        await transitionCodaView(
          async () => {
            if (router.history.canGoBack()) {
              await awaitRouterBackAfterRender(router);
            } else {
              await commitFallback(detail);
            }
            if (detail.kind === "album" && transaction) {
              replacementAfterBack = await awaitVirtualReturnTrigger({
                findTrigger: () =>
                  replacementNavigationTrigger(transaction, detail),
                isCurrent: isCurrentReturn,
                scrollRoot: scrollRootRef.current,
                scrollTop: returnScrollTop,
              });
              releaseReturnDestination = markAlbumReturnDestination(
                replacementAfterBack,
                detail.albumId,
              );
            } else if (detail.kind === "artist" && transaction) {
              replacementAfterBack = await awaitVirtualReturnTrigger({
                findTrigger: () =>
                  replacementNavigationTrigger(transaction, detail),
                isCurrent: isCurrentReturn,
                scrollRoot: scrollRootRef.current,
                scrollTop: returnScrollTop,
              });
              releaseReturnDestination = markArtistReturnDestination(
                replacementAfterBack,
                detail.artistKey,
              );
            }
          },
          detail.kind === "now-playing"
            ? "now-playing-close"
            : detail.kind === "album" && transaction
              ? "album-detail-close"
              : detail.kind === "artist" && transaction
                ? "artist-detail-close"
                : "page-back",
        );

        // WebKit can move focus while tearing down the View Transition
        // snapshots. Reassert the exact source only after the animation has
        // finished so a successful pre-snapshot focus is not lost afterward.
        if (
          transaction &&
          options.restoreFocus !== false &&
          !returnToDestinationHeading
        ) {
          const replacement =
            replacementAfterBack ??
            replacementNavigationTrigger(transaction, detail);
          const focus = resolveNavigationReturnFocus(transaction, replacement);
          if (focus.target) {
            focus.target.focus({ preventScroll: true });
            if (
              coordinator.navigation.active?.identity === transaction.identity
            ) {
              coordinator.navigation = settleNavigationTransaction(
                coordinator.navigation,
                transaction.identity,
              );
              coordinator.target = undefined;
              coordinator.returnFocusRequested = false;
              coordinator.returnToDestinationHeading = false;
            }
          }
        }
      } finally {
        releaseReturnDestination();
      }
    },
    [commitFallback, destination.detail, router],
  );

  const transitionPrimary = useCallback(
    (update: CodaViewTransitionUpdate) =>
      transitionCodaView(update, "page-crossfade"),
    [],
  );

  useLayoutEffect(() => {
    const pendingScrollTop = pendingScrollTopRef.current;
    const scrollRoot = scrollRootRef.current;
    if (pendingScrollTop === undefined || !scrollRoot) return;
    pendingScrollTopRef.current = undefined;
    scrollRoot.scrollTop = pendingScrollTop;
  }, [currentDetailKey, destination.locationKey]);

  useEffect(
    () => () => {
      activeSourceReleaseRef.current?.();
      activeSourceReleaseRef.current = undefined;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let frame: number | undefined;
    let timer: number | undefined;

    const schedule = (
      work: () => HTMLElement | undefined,
      finish: () => void,
    ) => {
      const run = () => {
        if (!active) return;
        const target = work();
        if (target) {
          target.focus({ preventScroll: true });
          finish();
          return;
        }
        if (attempts >= MAX_DOM_RESTORE_ATTEMPTS) {
          finish();
          return;
        }
        attempts += 1;
        if (typeof window.requestAnimationFrame === "function") {
          frame = window.requestAnimationFrame(run);
        } else {
          timer = window.setTimeout(run, 0);
        }
      };
      run();
    };

    for (const coordinator of Object.values(coordinatorsRef.current)) {
      const transaction = coordinator.navigation.active;
      if (
        !transaction ||
        !coordinator.target ||
        !coordinator.returnFocusRequested ||
        targetMatchesDestination(coordinator.target, destination.detail)
      ) {
        continue;
      }

      const settle = () => {
        coordinator.returnFocusRequested = false;
        coordinator.navigation = settleNavigationTransaction(
          coordinator.navigation,
          transaction.identity,
        );
        coordinator.target = undefined;
        coordinator.returnToDestinationHeading = false;
      };
      if (!coordinator.restoreFocus) {
        settle();
        return;
      }
      schedule(() => {
        if (coordinator.returnToDestinationHeading) {
          const headingId = destinationHeadingId(destination.detail);
          return headingId
            ? (document.getElementById(headingId) ?? undefined)
            : undefined;
        }
        const replacement = replacementNavigationTrigger(
          transaction,
          coordinator.target!,
        );
        return resolveNavigationReturnFocus(transaction, replacement).target;
      }, settle);
      return () => {
        active = false;
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        if (timer !== undefined) window.clearTimeout(timer);
      };
    }

    const manualFocus = manualFocusRequestRef.current;
    if (
      manualFocus &&
      targetMatchesDestination(manualFocus.target, destination.detail)
    ) {
      schedule(
        () => document.getElementById(manualFocus.headingId) ?? undefined,
        () => {
          if (manualFocusRequestRef.current === manualFocus) {
            manualFocusRequestRef.current = undefined;
          }
        },
      );
      return () => {
        active = false;
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        if (timer !== undefined) window.clearTimeout(timer);
      };
    }

    for (const coordinator of Object.values(coordinatorsRef.current)) {
      const transaction = coordinator.navigation.active;
      if (
        !transaction ||
        !targetMatchesDestination(coordinator.target, destination.detail) ||
        coordinator.focusedIdentity === transaction.identity
      ) {
        continue;
      }
      schedule(
        () =>
          document.getElementById(transaction.destinationHeadingId) ??
          undefined,
        () => {
          coordinator.focusedIdentity = transaction.identity;
        },
      );
      return () => {
        active = false;
        if (frame !== undefined) window.cancelAnimationFrame(frame);
        if (timer !== undefined) window.clearTimeout(timer);
      };
    }

    return () => {
      active = false;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    currentDetailKey,
    destination.detail,
    destination.locationKey,
    domRequestVersion,
  ]);

  return {
    back,
    open,
    scrollRootRef,
    transitionPrimary,
  };
}
