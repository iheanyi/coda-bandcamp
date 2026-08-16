import {
  useCallback,
  useEffect,
  useLayoutEffect,
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
import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";
import { transitionCodaView } from "@/viewTransitions";
import {
  acquireTemporaryAttribute,
  combineMarkerReleases,
} from "@/features/navigation/temporaryDomMarkers";

import { RadioIndexScreen, RadioSeriesScreen } from "./RadioArchiveScreen";
import { radioSeriesId, radioShowId } from "./radioRouteIds";
import type {
  RadioOpenShowRequest,
  RadioPlaybackProps,
} from "./radioScreenTypes";
import { RadioShowScreen } from "./RadioShowScreen";

export type RadioViewCompatibilityProps = RadioPlaybackProps &
  Readonly<{
    selectedSeriesId?: number;
    onSelectSeries: (seriesId?: number) => void;
    requestedShowId?: number;
    onRequestedShowChange: (showId?: number) => void;
  }>;

export function RadioViewCompatibility({
  selectedSeriesId,
  onSelectSeries,
  requestedShowId,
  onRequestedShowChange,
  ...playbackProps
}: RadioViewCompatibilityProps) {
  const seriesId = radioSeriesId(selectedSeriesId);
  const showId = radioShowId(requestedShowId);
  const radioNavigationRef = useRef(createNavigationTransactionState());
  const activeSourceReleaseRef = useRef<(() => void) | undefined>(undefined);
  const radioReturnFocusRequestedRef = useRef(false);
  const radioScrollTopRef = useRef<number | undefined>(undefined);
  const closeGenerationRef = useRef(0);
  const [returningArtworkId, setReturningArtworkId] = useState<RadioShowId>();

  useLayoutEffect(() => {
    if (showId) return;
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    if (radioScrollTopRef.current !== undefined && scrollRoot) {
      scrollRoot.scrollTop = radioScrollTopRef.current;
      radioScrollTopRef.current = undefined;
    }
    if (!radioReturnFocusRequestedRef.current) return;
    radioReturnFocusRequestedRef.current = false;
    const transaction = radioNavigationRef.current.active;
    if (!transaction) return;
    const sourceShowId = transaction.sourceTrigger?.dataset.radioShowOpen;
    const sourceSlot =
      transaction.sourceTrigger?.dataset.radioShowNavigationSlot;
    const replacement = Array.from(
      document.querySelectorAll<HTMLElement>("[data-radio-show-open]"),
    ).find(
      (candidate) =>
        candidate.dataset.radioShowOpen === sourceShowId &&
        candidate.dataset.radioShowNavigationSlot === sourceSlot,
    );
    const result = resolveNavigationReturnFocus(transaction, replacement);
    result.target?.focus({ preventScroll: true });
    radioNavigationRef.current = settleNavigationTransaction(
      radioNavigationRef.current,
      transaction.identity,
    );
  }, [showId]);

  useEffect(
    () => () => {
      activeSourceReleaseRef.current?.();
      activeSourceReleaseRef.current = undefined;
    },
    [],
  );

  const openShow = useCallback(
    (request: RadioOpenShowRequest) => {
      closeGenerationRef.current += 1;
      setReturningArtworkId(undefined);
      radioReturnFocusRequestedRef.current = false;
      radioNavigationRef.current = replaceNavigationTransaction(
        radioNavigationRef.current,
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
      void transitionCodaView(
        () => onRequestedShowChange(request.showId),
        request.sourceArtwork ? "radio-detail" : "page-forward",
      ).finally(() => {
        releaseSourceMarkers();
        if (activeSourceReleaseRef.current === releaseSourceMarkers) {
          activeSourceReleaseRef.current = undefined;
        }
      });
    },
    [onRequestedShowChange],
  );

  const selectSeries = useCallback(
    (nextSeriesId?: RadioSeriesId) => {
      closeGenerationRef.current += 1;
      setReturningArtworkId(undefined);
      onRequestedShowChange(undefined);
      onSelectSeries(nextSeriesId);
    },
    [onRequestedShowChange, onSelectSeries],
  );

  const browseSeriesFromShow = useCallback(
    (nextSeriesId?: RadioSeriesId) => {
      closeGenerationRef.current += 1;
      setReturningArtworkId(undefined);
      const transaction = radioNavigationRef.current.active;
      if (transaction) {
        radioNavigationRef.current = settleNavigationTransaction(
          radioNavigationRef.current,
          transaction.identity,
        );
      }
      radioReturnFocusRequestedRef.current = false;
      radioScrollTopRef.current = 0;
      onSelectSeries(nextSeriesId);
      onRequestedShowChange(undefined);
    },
    [onRequestedShowChange, onSelectSeries],
  );

  const closeShow = useCallback(() => {
    if (!showId) {
      onRequestedShowChange(undefined);
      return;
    }
    const transaction = radioNavigationRef.current.active;
    const closeGeneration = ++closeGenerationRef.current;
    const reversesSharedArtwork =
      transaction?.entrance === "shared-element" &&
      transaction.sharedElementOwner === "coda-radio-artwork" &&
      transaction.sourceTrigger?.dataset.radioShowOpen === String(showId);
    radioReturnFocusRequestedRef.current = Boolean(transaction);
    radioScrollTopRef.current = transaction
      ? resolveNavigationReturnScrollTop(transaction)
      : 0;
    void transitionCodaView(
      () => {
        setReturningArtworkId(reversesSharedArtwork ? showId : undefined);
        onRequestedShowChange(undefined);
      },
      reversesSharedArtwork ? "radio-detail-close" : "page-back",
    ).finally(() => {
      if (closeGenerationRef.current !== closeGeneration) return;
      setReturningArtworkId((current) =>
        current === showId ? undefined : current,
      );
    });
  }, [onRequestedShowChange, showId]);

  if (showId) {
    return (
      <RadioShowScreen
        {...playbackProps}
        showId={showId}
        onBack={closeShow}
        onBrowseSeries={browseSeriesFromShow}
        preferredSummaryScope={seriesId ?? "all"}
      />
    );
  }

  const archiveProps = {
    ...playbackProps,
    onSelectSeries: selectSeries,
    onOpenShow: openShow,
    returningArtworkId,
  };

  return seriesId ? (
    <RadioSeriesScreen {...archiveProps} seriesId={seriesId} />
  ) : (
    <RadioIndexScreen {...archiveProps} />
  );
}
