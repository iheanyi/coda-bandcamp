import { type ReactNode, useCallback, useMemo, useRef } from "react";

import {
  createNavigationTransactionState,
  replaceNavigationTransaction,
  resolveNavigationReturnFocus,
  resolveNavigationReturnScrollTop,
  settleNavigationTransaction,
} from "@/navigationTransaction";
import type { PlaylistId } from "@/routing/routeContracts";
import { transitionCodaView } from "@/viewTransitions";
import {
  acquireTemporaryAttribute,
  combineMarkerReleases,
} from "@/features/navigation/temporaryDomMarkers";
import {
  awaitVirtualReturnTrigger,
  forcePaintedReturnAncestors,
} from "@/features/navigation/virtualReturnEndpoint";

import {
  PlaylistRouteNavigationContext,
  type PlaylistRouteNavigationAdapter,
  type PlaylistRouteNavigationValue,
} from "./playlistRouteNavigation";

function findPlaylistTrigger(playlistId: PlaylistId): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-playlist-open]"),
  ).find((candidate) => candidate.dataset.playlistOpen === playlistId);
}

function playlistIdentity(trigger?: HTMLElement): HTMLElement | undefined {
  return (
    trigger?.querySelector<HTMLElement>("[data-playlist-identity]") ?? undefined
  );
}

function playlistTitle(trigger?: HTMLElement): HTMLElement | undefined {
  const titleRoot = trigger?.querySelector<HTMLElement>(
    "[data-playlist-title]",
  );
  return (
    titleRoot?.querySelector<HTMLElement>(
      '[data-slot="overflow-marquee-text"]',
    ) ?? undefined
  );
}

function markPlaylistReturnDestination(
  trigger: HTMLElement,
  playlistId: PlaylistId,
  scrollRoot: HTMLElement | null,
): () => void {
  const identity = playlistIdentity(trigger);
  const title = playlistTitle(trigger);
  return combineMarkerReleases([
    forcePaintedReturnAncestors(trigger, scrollRoot),
    ...(identity
      ? [
          acquireTemporaryAttribute(
            identity,
            "data-coda-playlist-identity-return",
            playlistId,
          ),
        ]
      : []),
    ...(title
      ? [
          acquireTemporaryAttribute(
            title,
            "data-coda-playlist-title-return",
            playlistId,
          ),
        ]
      : []),
  ]);
}

export function PlaylistRouteNavigationProvider({
  adapter,
  children,
}: Readonly<{
  adapter: PlaylistRouteNavigationAdapter;
  children: ReactNode;
}>) {
  const navigationRef = useRef(createNavigationTransactionState());
  const activePlaylistIdRef = useRef<PlaylistId | undefined>(undefined);
  const returnFocusRequestedRef = useRef(false);
  const returnScrollTopRef = useRef<number | undefined>(undefined);
  const closeGenerationRef = useRef(0);
  const returningPlaylistIdRef = useRef<PlaylistId | undefined>(undefined);
  const releaseReturningMarkersRef = useRef<() => void>(() => undefined);

  const clearReturningIdentity = useCallback(() => {
    releaseReturningMarkersRef.current();
    releaseReturningMarkersRef.current = () => undefined;
    returningPlaylistIdRef.current = undefined;
  }, []);

  const openPlaylist = useCallback(
    (playlistId: PlaylistId) => {
      closeGenerationRef.current += 1;
      const sourceTrigger = findPlaylistTrigger(playlistId);
      const sourceIdentity = playlistIdentity(sourceTrigger);
      const hasSharedIdentity =
        sourceIdentity?.dataset.codaPlaylistIdentitySource === playlistId;
      const returnScrollTop =
        document.querySelector<HTMLElement>("[data-coda-library-scroll]")
          ?.scrollTop ?? 0;

      clearReturningIdentity();
      activePlaylistIdRef.current = playlistId;
      returnFocusRequestedRef.current = false;
      navigationRef.current = replaceNavigationTransaction(
        navigationRef.current,
        {
          routeKey: "playlist-detail",
          intent: "forward",
          entrance: hasSharedIdentity ? "shared-element" : "none",
          sourceTrigger,
          returnScrollTop,
          destinationHeadingId: "playlist-detail-heading",
          sharedElementOwner: hasSharedIdentity
            ? "coda-playlist-identity"
            : undefined,
        },
      );
      return adapter.goToPlaylist(playlistId);
    },
    [adapter, clearReturningIdentity],
  );

  const restoreListContext = useCallback(() => {
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    if (returnScrollTopRef.current !== undefined && scrollRoot) {
      scrollRoot.scrollTop = returnScrollTopRef.current;
      returnScrollTopRef.current = undefined;
    }
  }, []);

  const closePlaylist = useCallback(
    async (playlistId: PlaylistId) => {
      const closeGeneration = ++closeGenerationRef.current;
      const transaction = navigationRef.current.active;
      const reversesSharedIdentity =
        transaction?.entrance === "shared-element" &&
        transaction.sharedElementOwner === "coda-playlist-identity" &&
        activePlaylistIdRef.current === playlistId;

      returnFocusRequestedRef.current = Boolean(transaction);
      const returnScrollTop = transaction
        ? resolveNavigationReturnScrollTop(transaction)
        : 0;
      returnScrollTopRef.current = returnScrollTop;
      returningPlaylistIdRef.current = reversesSharedIdentity
        ? playlistId
        : undefined;
      let replacement: HTMLElement | undefined;
      let releaseReturnDestination = () => {};

      try {
        await transitionCodaView(
          async () => {
            if (transaction) {
              await adapter.goBack();
            } else {
              await adapter.goToIndex(true);
            }

            const scrollRoot = document.querySelector<HTMLElement>(
              "[data-coda-library-scroll]",
            );
            if (transaction) {
              replacement = await awaitVirtualReturnTrigger({
                findTrigger: () => findPlaylistTrigger(playlistId),
                isCurrent: () => closeGenerationRef.current === closeGeneration,
                scrollRoot,
                scrollTop: returnScrollTop,
              });
            } else if (scrollRoot) {
              scrollRoot.scrollTop = returnScrollTop;
            }
            if (
              reversesSharedIdentity &&
              replacement &&
              closeGenerationRef.current === closeGeneration
            ) {
              releaseReturnDestination = markPlaylistReturnDestination(
                replacement,
                playlistId,
                scrollRoot,
              );
              releaseReturningMarkersRef.current = releaseReturnDestination;
            }
          },
          reversesSharedIdentity ? "playlist-detail-close" : "page-back",
        );

        if (
          transaction &&
          returnFocusRequestedRef.current &&
          closeGenerationRef.current === closeGeneration
        ) {
          const result = resolveNavigationReturnFocus(
            transaction,
            replacement ?? findPlaylistTrigger(playlistId),
          );
          result.target?.focus({ preventScroll: true });
          if (navigationRef.current.active?.identity === transaction.identity) {
            navigationRef.current = settleNavigationTransaction(
              navigationRef.current,
              transaction.identity,
            );
          }
          returnFocusRequestedRef.current = false;
          activePlaylistIdRef.current = undefined;
        }
      } finally {
        releaseReturnDestination();
        if (releaseReturningMarkersRef.current === releaseReturnDestination) {
          releaseReturningMarkersRef.current = () => undefined;
        }
        if (closeGenerationRef.current === closeGeneration) {
          returningPlaylistIdRef.current = undefined;
        }
      }
    },
    [adapter],
  );

  const value = useMemo<PlaylistRouteNavigationValue>(
    () => ({ closePlaylist, openPlaylist, restoreListContext }),
    [closePlaylist, openPlaylist, restoreListContext],
  );

  return (
    <PlaylistRouteNavigationContext.Provider value={value}>
      {children}
    </PlaylistRouteNavigationContext.Provider>
  );
}
