import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
  markDiscoverReturnDestination,
  prepareDetailSource,
  type PreparedDetailSource,
} from "./detailSourceIdentity";

type CommitPreparation = () => void;

export type AlbumDetailNavigationRequest = Readonly<{
  albumId: AlbumId;
  beforeCommit?: CommitPreparation;
  /** A cold shell uses page-forward while retaining validated return artwork. */
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

const DETAIL_TRANSITIONS = {
  album: {
    owner: "coda-album-artwork",
    open: "album-detail",
    close: "album-detail-close",
  },
  artist: {
    owner: "coda-artist-artwork",
    open: "artist-detail",
    close: "artist-detail-close",
  },
  "discover-release": {
    owner: "coda-discover-artwork",
    open: "discover-detail",
    close: "discover-detail-close",
  },
  "now-playing": {
    owner: "coda-now-playing-artwork",
    open: "now-playing-open",
    close: "now-playing-close",
  },
} as const satisfies Record<
  CoordinatedDetailKind,
  Readonly<{
    owner: string;
    open: CodaViewTransitionKind;
    close: CodaViewTransitionKind;
  }>
>;

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
  nativeSharedElement: boolean,
): CodaViewTransitionKind {
  if (!nativeSharedElement) return "page-forward";
  return DETAIL_TRANSITIONS[request.kind].open;
}

function ownsNativeSharedElement(
  request: DetailNavigationRequest,
  source: PreparedDetailSource,
): boolean {
  if (request.kind === "album" && request.coldLoad) return false;
  return source.sharedElementOwner === DETAIL_TRANSITIONS[request.kind].owner;
}

function transitionKindForBack(
  detail: CoordinatedDetailDestination,
  transaction: NavigationTransaction | undefined,
): CodaViewTransitionKind {
  const transition = DETAIL_TRANSITIONS[detail.kind];
  if (
    transaction?.sharedElementOwner !== transition.owner ||
    (detail.kind === "discover-release" && !returnsToDiscoverCard(transaction))
  ) {
    return "page-back";
  }
  return transition.close;
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

function returnsToDiscoverCard(
  transaction: NavigationTransaction | undefined,
): transaction is NavigationTransaction {
  const sourceSlot = transaction?.sourceTrigger?.dataset.navigationSlot;
  return sourceSlot === "discover-artwork" || sourceSlot === "discover-title";
}

function clearReturnFocusRequests(coordinators: DetailCoordinators): void {
  for (const coordinator of Object.values(coordinators)) {
    coordinator.returnFocusRequested = false;
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
  const backInFlightRef = useRef<
    { locationKey: string; request: Promise<void> } | undefined
  >(undefined);
  const returnGenerationRef = useRef(0);
  const manualFocusRequestRef = useRef<ManualFocusRequest | undefined>(
    undefined,
  );
  const currentLocationKeyRef = useRef(destination.locationKey);
  currentLocationKeyRef.current = destination.locationKey;
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
      const navigationGeneration = ++returnGenerationRef.current;
      const sourceLocationKey = destination.locationKey;
      clearReturnFocusRequests(coordinatorsRef.current);
      pendingScrollTopRef.current = undefined;
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
      const nativeSharedElement = ownsNativeSharedElement(request, source);
      const coordinator = coordinatorsRef.current[request.kind];
      const returnScrollTop = scrollRootRef.current?.scrollTop ?? 0;
      coordinator.navigation = replaceNavigationTransaction(
        coordinator.navigation,
        {
          routeKey: ROUTE_KEYS[request.kind],
          intent: "forward",
          entrance: nativeSharedElement ? "shared-element" : "page-forward",
          sourceTrigger: source.sourceTrigger,
          returnScrollTop,
          destinationHeadingId: DESTINATION_HEADING_IDS[request.kind],
          sharedElementOwner: source.sharedElementOwner,
        },
      );
      const transactionIdentity = coordinator.navigation.active?.identity;
      coordinator.target = target;
      coordinator.restoreFocus = true;
      coordinator.returnFocusRequested = false;
      coordinator.returnToDestinationHeading =
        request.kind === "now-playing" &&
        destination.detail?.kind === "discover-release";
      manualFocusRequestRef.current = undefined;
      pendingScrollTopRef.current = 0;

      activeSourceReleaseRef.current?.();
      const clearMarkers = nativeSharedElement
        ? source.applyMarkers()
        : () => {};
      activeSourceReleaseRef.current = clearMarkers;
      try {
        await transitionCodaView(
          async () => {
            request.beforeCommit?.();
            await commitNavigation(request);
          },
          transitionKindForOpen(request, nativeSharedElement),
        );
      } catch (cause) {
        if (currentLocationKeyRef.current === sourceLocationKey) {
          if (returnGenerationRef.current === navigationGeneration) {
            pendingScrollTopRef.current = undefined;
          }
          if (
            transactionIdentity !== undefined &&
            coordinator.navigation.active?.identity === transactionIdentity
          ) {
            coordinator.navigation = settleNavigationTransaction(
              coordinator.navigation,
              transactionIdentity,
            );
            coordinator.target = undefined;
            coordinator.returnToDestinationHeading = false;
          }
        }
        throw cause;
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

  const performBack = useCallback<DetailNavigationController["back"]>(
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
      activeSourceReleaseRef.current?.();
      activeSourceReleaseRef.current = undefined;
      const coordinator = coordinatorsRef.current[detail.kind];
      const transaction = targetMatchesDestination(coordinator.target, detail)
        ? coordinator.navigation.active
        : undefined;
      const discoverCardReturn =
        detail.kind === "discover-release" &&
        returnsToDiscoverCard(transaction);
      const returnGeneration = ++returnGenerationRef.current;
      const isCurrentReturn = () =>
        returnGenerationRef.current === returnGeneration;
      clearReturnFocusRequests(coordinatorsRef.current);
      coordinator.restoreFocus = options.restoreFocus !== false;
      const returnScrollTop = transaction
        ? resolveNavigationReturnScrollTop(transaction)
        : 0;
      pendingScrollTopRef.current = returnScrollTop;

      let releaseReturnDestination = () => {};
      const transitionKind = transitionKindForBack(detail, transaction);
      try {
        await transitionCodaView(async () => {
          if (router.history.canGoBack()) {
            await awaitRouterBackAfterRender(router);
          } else {
            await commitFallback(detail);
          }
          if (detail.kind === "album" && transaction) {
            const replacement = await awaitVirtualReturnTrigger({
              findTrigger: () =>
                replacementNavigationTrigger(transaction, detail),
              isCurrent: isCurrentReturn,
              scrollRoot: scrollRootRef.current,
              scrollTop: returnScrollTop,
            });
            releaseReturnDestination = markAlbumReturnDestination(
              replacement,
              detail.albumId,
            );
          } else if (detail.kind === "artist" && transaction) {
            const replacement = await awaitVirtualReturnTrigger({
              findTrigger: () =>
                replacementNavigationTrigger(transaction, detail),
              isCurrent: isCurrentReturn,
              scrollRoot: scrollRootRef.current,
              scrollTop: returnScrollTop,
            });
            releaseReturnDestination = markArtistReturnDestination(
              replacement,
              detail.artistKey,
            );
          } else if (
            detail.kind === "discover-release" &&
            discoverCardReturn
          ) {
            const replacement = await awaitVirtualReturnTrigger({
              findTrigger: () =>
                replacementNavigationTrigger(transaction, detail),
              isCurrent: isCurrentReturn,
              scrollRoot: scrollRootRef.current,
              scrollTop: returnScrollTop,
            });
            releaseReturnDestination = markDiscoverReturnDestination(
              replacement,
              detail.releaseId,
            );
          } else if (detail.kind === "now-playing") {
            await awaitVirtualReturnTrigger({
              findTrigger: () =>
                transaction
                  ? replacementNavigationTrigger(transaction, detail)
                  : (document.querySelector<HTMLElement>(
                      ".player__art-link[data-coda-track-id]",
                    ) ?? undefined),
              isCurrent: isCurrentReturn,
              scrollRoot: null,
              scrollTop: 0,
            });
          }
        }, transitionKind);

        if (!isCurrentReturn()) return;
        if (transaction) {
          coordinator.returnFocusRequested = true;
          requestDomWork();
        }
      } catch (cause) {
        if (isCurrentReturn()) {
          if (currentLocationKeyRef.current === destination.locationKey) {
            coordinator.returnFocusRequested = false;
            pendingScrollTopRef.current = undefined;
          } else if (transaction) {
            coordinator.returnFocusRequested = true;
            requestDomWork();
          }
        }
        throw cause;
      } finally {
        releaseReturnDestination();
      }
    },
    [commitFallback, destination.detail, router],
  );

  const back = useCallback<DetailNavigationController["back"]>(
    (options) => {
      const active = backInFlightRef.current;
      if (active?.locationKey === destination.locationKey) {
        return active.request;
      }
      const request = performBack(options).finally(() => {
        if (backInFlightRef.current?.request === request) {
          backInFlightRef.current = undefined;
        }
      });
      backInFlightRef.current = {
        locationKey: destination.locationKey,
        request,
      };
      return request;
    },
    [destination.locationKey, performBack],
  );

  const transitionPrimary = useCallback(
    (update: CodaViewTransitionUpdate) =>
      transitionCodaView(update, "page-forward"),
    [],
  );

  useLayoutEffect(() => {
    const pendingScrollTop = pendingScrollTopRef.current;
    if (pendingScrollTop === undefined) return;
    pendingScrollTopRef.current = undefined;
    if (scrollRootRef.current) {
      scrollRootRef.current.scrollTop = pendingScrollTop;
    }
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
    const cleanup = () => {
      active = false;
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timer !== undefined) window.clearTimeout(timer);
    };

    const manualFocus = manualFocusRequestRef.current;
    if (
      manualFocus &&
      !targetMatchesDestination(manualFocus.target, destination.detail)
    ) {
      manualFocusRequestRef.current = undefined;
    }

    for (const coordinator of Object.values(coordinatorsRef.current)) {
      const transaction = coordinator.navigation.active;
      const target = coordinator.target;
      if (
        !transaction ||
        !target ||
        !coordinator.returnFocusRequested ||
        targetMatchesDestination(target, destination.detail)
      ) {
        continue;
      }

      const settle = () => {
        if (
          coordinator.navigation.active?.identity !== transaction.identity ||
          coordinator.target !== target
        ) {
          return;
        }
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
        if (
          coordinator.navigation.active?.identity !== transaction.identity ||
          coordinator.target !== target ||
          !coordinator.returnFocusRequested
        ) {
          return undefined;
        }
        if (coordinator.returnToDestinationHeading) {
          const headingId = destinationHeadingId(destination.detail);
          return headingId
            ? (document.getElementById(headingId) ?? undefined)
            : undefined;
        }
        const replacement = replacementNavigationTrigger(
          transaction,
          target,
        );
        return resolveNavigationReturnFocus(transaction, replacement).target;
      }, settle);
      return cleanup;
    }

    const currentManualFocus = manualFocusRequestRef.current;
    if (
      currentManualFocus &&
      targetMatchesDestination(currentManualFocus.target, destination.detail)
    ) {
      schedule(
        () =>
          manualFocusRequestRef.current === currentManualFocus
            ? (document.getElementById(currentManualFocus.headingId) ??
              undefined)
            : undefined,
        () => {
          if (manualFocusRequestRef.current === currentManualFocus) {
            manualFocusRequestRef.current = undefined;
          }
        },
      );
      return cleanup;
    }

    for (const coordinator of Object.values(coordinatorsRef.current)) {
      const transaction = coordinator.navigation.active;
      const target = coordinator.target;
      if (
        !transaction ||
        !targetMatchesDestination(target, destination.detail) ||
        coordinator.focusedIdentity === transaction.identity
      ) {
        continue;
      }
      schedule(
        () => {
          if (
            coordinator.navigation.active?.identity !== transaction.identity ||
            coordinator.target !== target
          ) {
            return undefined;
          }
          return (
            document.getElementById(transaction.destinationHeadingId) ??
            undefined
          );
        },
        () => {
          coordinator.focusedIdentity = transaction.identity;
        },
      );
      return cleanup;
    }

    return cleanup;
  }, [
    currentDetailKey,
    destination.detail,
    destination.locationKey,
    domRequestVersion,
  ]);

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
