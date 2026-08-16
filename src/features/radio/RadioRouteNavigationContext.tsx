import {
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  cancelDetailNavigation,
  restoreDetailScroll,
} from "@/detailNavigation";
import {
  closeIdentifiedDetail,
  openIdentifiedDetail,
} from "@/features/navigation/detailRouteNavigation";
import { BANDCAMP_RADIO_SERIES } from "@/radioSeries";
import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";

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

export function RadioRouteNavigationProvider({
  adapter,
  children,
}: Readonly<{
  adapter: RadioRouteNavigationAdapter;
  children: ReactNode;
}>) {
  const activeSeriesIdRef = useRef<RadioSeriesId | undefined>(undefined);
  const [seriesTravelSteps, setSeriesTravelSteps] = useState(0);

  const openShow = useCallback(
    (request: RadioOpenShowRequest) => {
      const identity = String(request.showId);
      return openIdentifiedDetail("radio", identity, request, () =>
        adapter.goToShow(request.showId),
      );
    },
    [adapter],
  );

  const selectSeries = useCallback(
    async (seriesId?: RadioSeriesId) => {
      await cancelDetailNavigation();
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
      await cancelDetailNavigation();
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
    (showId: RadioShowId) => {
      const identity = String(showId);
      return closeIdentifiedDetail("radio", identity, (hasReturnState) =>
        hasReturnState ? adapter.goBack() : adapter.goToIndex(true),
      );
    },
    [adapter],
  );

  const restoreArchiveContext = useCallback((seriesId?: RadioSeriesId) => {
    activeSeriesIdRef.current = seriesId;
    restoreDetailScroll();
  }, []);

  const value = useMemo<RadioRouteNavigationValue>(
    () => ({
      browseSeriesFromShow,
      closeShow,
      openShow,
      restoreArchiveContext,
      seriesTravelSteps,
      selectSeries,
    }),
    [
      browseSeriesFromShow,
      closeShow,
      openShow,
      restoreArchiveContext,
      seriesTravelSteps,
      selectSeries,
    ],
  );

  return (
    <RadioRouteNavigationContext value={value}>
      {children}
    </RadioRouteNavigationContext>
  );
}
