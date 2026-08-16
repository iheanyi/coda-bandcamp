import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createNavigationTransactionState,
  replaceNavigationTransaction,
  resolveNavigationReturnFocus,
  resolveNavigationReturnScrollTop,
  settleNavigationTransaction,
} from "@/navigationTransaction";
import { BANDCAMP_RADIO_SERIES } from "@/radioSeries";
import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";
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
  RadioRouteNavigationContext,
  type RadioRouteNavigationAdapter,
  type RadioRouteNavigationValue,
} from "./RadioRouteNavigationState";
import type { RadioOpenShowRequest } from "./radioScreenTypes";

export type {
  RadioRouteNavigationAdapter,
  RadioRouteNavigationValue,
} from "./RadioRouteNavigationState";

function radioSeriesIndex(seriesId?: RadioSeriesId): number {
  if (seriesId === undefined) return 0;
  const index = BANDCAMP_RADIO_SERIES.findIndex(
    (series) => series.id === seriesId,
  );
  return index < 0 ? 0 : index + 1;
}

function findRadioReturnTrigger(
  showId: RadioShowId,
  sourceSlot?: string,
): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-radio-show-open]"),
  ).find(
    (candidate) =>
      candidate.dataset.radioShowOpen === String(showId) &&
      (sourceSlot === undefined ||
        candidate.dataset.radioShowNavigationSlot === sourceSlot),
  );
}

function markRadioReturnDestination(
  trigger: HTMLElement,
  showId: RadioShowId,
  scrollRoot: HTMLElement | null,
): () => void {
  const showIdentity = String(showId);
  const owner = trigger.closest<HTMLElement>("article") ?? trigger;
  const artwork = Array.from(
    owner.querySelectorAll<HTMLElement>("[data-radio-show-artwork]"),
  ).find((candidate) => candidate.dataset.radioShowArtwork === showIdentity);
  const titleRoot = Array.from(
    owner.querySelectorAll<HTMLElement>("[data-radio-show-title]"),
  ).find((candidate) => candidate.dataset.radioShowTitle === showIdentity);
  const title =
    titleRoot?.querySelector<HTMLElement>(
      ':is([data-slot="overflow-marquee-text"], [data-coda-radio-title-text])',
    ) ?? titleRoot;

  return combineMarkerReleases([
    forcePaintedReturnAncestors(owner, scrollRoot),
    ...(artwork
      ? [
          acquireTemporaryAttribute(
            artwork,
            "data-coda-radio-artwork-return",
            showIdentity,
          ),
        ]
      : []),
    ...(title
      ? [
          acquireTemporaryAttribute(
            title,
            "data-coda-radio-title-return",
            showIdentity,
          ),
        ]
      : []),
  ]);
}

export function RadioRouteNavigationProvider({
  adapter,
  children,
  transition = transitionCodaView,
}: Readonly<{
  adapter: RadioRouteNavigationAdapter;
  children: ReactNode;
  transition?: typeof transitionCodaView;
}>) {
  const navigationRef = useRef(createNavigationTransactionState());
  const activeSourceReleaseRef = useRef<(() => void) | undefined>(undefined);
  const activeSeriesIdRef = useRef<RadioSeriesId | undefined>(undefined);
  const returnFocusRequestedRef = useRef(false);
  const returnScrollTopRef = useRef<number | undefined>(undefined);
  const closeGenerationRef = useRef(0);
  const [returningArtworkId, setReturningArtworkId] = useState<RadioShowId>();
  const [seriesTravelSteps, setSeriesTravelSteps] = useState(0);

  const openShow = useCallback(
    (request: RadioOpenShowRequest) => {
      closeGenerationRef.current += 1;
      setReturningArtworkId(undefined);
      returnFocusRequestedRef.current = false;
      navigationRef.current = replaceNavigationTransaction(
        navigationRef.current,
        {
          routeKey: "radio-detail",
          intent: "forward",
          entrance: request.sourceArtwork ? "shared-element" : "page-forward",
          sourceTrigger: request.sourceTrigger,
          returnScrollTop: request.returnScrollTop,
          destinationHeadingId: "radio-detail-title",
          sharedElementOwner: request.sourceArtwork
            ? "coda-radio-artwork"
            : undefined,
        },
      );
      activeSourceReleaseRef.current?.();
      const releaseSourceMarkers = combineMarkerReleases([
        ...(request.sourceArtwork
          ? [
              acquireTemporaryAttribute(
                request.sourceArtwork,
                "data-coda-radio-artwork-source",
                String(request.showId),
              ),
            ]
          : []),
        ...(request.sourceTitle
          ? [
              acquireTemporaryAttribute(
                request.sourceTitle,
                "data-coda-radio-title-source",
                String(request.showId),
              ),
            ]
          : []),
      ]);
      activeSourceReleaseRef.current = releaseSourceMarkers;
      return transition(
        () => adapter.goToShow(request.showId),
        request.sourceArtwork ? "radio-detail" : "page-forward",
      ).finally(() => {
        releaseSourceMarkers();
        if (activeSourceReleaseRef.current === releaseSourceMarkers) {
          activeSourceReleaseRef.current = undefined;
        }
      });
    },
    [adapter, transition],
  );

  const selectSeries = useCallback(
    async (seriesId?: RadioSeriesId) => {
      closeGenerationRef.current += 1;
      setReturningArtworkId(undefined);
      setSeriesTravelSteps(
        Math.abs(
          radioSeriesIndex(seriesId) -
            radioSeriesIndex(activeSeriesIdRef.current),
        ),
      );
      if (seriesId) {
        await adapter.goToSeries(seriesId);
        return;
      }
      await adapter.goToIndex();
    },
    [adapter],
  );

  const browseSeriesFromShow = useCallback(
    async (seriesId?: RadioSeriesId) => {
      closeGenerationRef.current += 1;
      setReturningArtworkId(undefined);
      const transaction = navigationRef.current.active;
      if (transaction) {
        navigationRef.current = settleNavigationTransaction(
          navigationRef.current,
          transaction.identity,
        );
      }
      returnFocusRequestedRef.current = false;
      returnScrollTopRef.current = 0;
      setSeriesTravelSteps(0);
      if (seriesId) {
        await adapter.goToSeries(seriesId, true);
      } else {
        await adapter.goToIndex(true);
      }
    },
    [adapter],
  );

  const closeShow = useCallback(
    async (showId: RadioShowId) => {
      const closeGeneration = ++closeGenerationRef.current;
      const transaction = navigationRef.current.active;
      const reversesSharedArtwork =
        transaction?.entrance === "shared-element" &&
        transaction.sharedElementOwner === "coda-radio-artwork" &&
        transaction.sourceTrigger?.dataset.radioShowOpen === String(showId);
      returnFocusRequestedRef.current = Boolean(transaction);
      const returnScrollTop = transaction
        ? resolveNavigationReturnScrollTop(transaction)
        : 0;
      returnScrollTopRef.current = returnScrollTop;
      const sourceSlot =
        transaction?.sourceTrigger?.dataset.radioShowNavigationSlot;
      let replacement: HTMLElement | undefined;
      let releaseReturnDestination = () => {};

      try {
        await transition(
          async () => {
            setReturningArtworkId(reversesSharedArtwork ? showId : undefined);
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
                findTrigger: () => findRadioReturnTrigger(showId, sourceSlot),
                isCurrent: () => closeGenerationRef.current === closeGeneration,
                scrollRoot,
                scrollTop: returnScrollTop,
              });
            } else if (scrollRoot) {
              scrollRoot.scrollTop = returnScrollTop;
            }
            if (
              reversesSharedArtwork &&
              replacement &&
              closeGenerationRef.current === closeGeneration
            ) {
              releaseReturnDestination = markRadioReturnDestination(
                replacement,
                showId,
                scrollRoot,
              );
            }
          },
          reversesSharedArtwork ? "radio-detail-close" : "page-back",
        );

        if (
          transaction &&
          returnFocusRequestedRef.current &&
          closeGenerationRef.current === closeGeneration
        ) {
          const result = resolveNavigationReturnFocus(
            transaction,
            replacement ?? findRadioReturnTrigger(showId, sourceSlot),
          );
          result.target?.focus({ preventScroll: true });
          if (navigationRef.current.active?.identity === transaction.identity) {
            navigationRef.current = settleNavigationTransaction(
              navigationRef.current,
              transaction.identity,
            );
          }
          returnFocusRequestedRef.current = false;
        }
      } finally {
        releaseReturnDestination();
        if (closeGenerationRef.current === closeGeneration) {
          setReturningArtworkId((current) =>
            current === showId ? undefined : current,
          );
        }
      }
    },
    [adapter, transition],
  );

  const restoreArchiveContext = useCallback((seriesId?: RadioSeriesId) => {
    activeSeriesIdRef.current = seriesId;
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    if (returnScrollTopRef.current !== undefined && scrollRoot) {
      scrollRoot.scrollTop = returnScrollTopRef.current;
      returnScrollTopRef.current = undefined;
    }
  }, []);

  useEffect(
    () => () => {
      activeSourceReleaseRef.current?.();
      activeSourceReleaseRef.current = undefined;
    },
    [],
  );

  const value = useMemo<RadioRouteNavigationValue>(
    () => ({
      browseSeriesFromShow,
      closeShow,
      openShow,
      restoreArchiveContext,
      returningArtworkId,
      seriesTravelSteps,
      selectSeries,
    }),
    [
      browseSeriesFromShow,
      closeShow,
      openShow,
      restoreArchiveContext,
      returningArtworkId,
      seriesTravelSteps,
      selectSeries,
    ],
  );

  return (
    <RadioRouteNavigationContext.Provider value={value}>
      {children}
    </RadioRouteNavigationContext.Provider>
  );
}
