import { createContext, useContext } from "react";

import type {
  RouteCommitOutcome,
  RouteCommitResult,
} from "@/features/navigation/routeCommit";
import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";

import type { RadioOpenShowRequest } from "./radioScreenTypes";

export type RadioRouteNavigationAdapter = Readonly<{
  goBack: () => Promise<RouteCommitResult>;
  goToIndex: (replace?: boolean) => Promise<RouteCommitResult>;
  goToSeries: (seriesId: RadioSeriesId, replace?: boolean) => Promise<RouteCommitResult>;
  goToShow: (showId: RadioShowId) => Promise<RouteCommitResult>;
}>;

export type RadioRouteNavigationValue = Readonly<{
  browseSeriesFromShow: (seriesId?: RadioSeriesId) => Promise<void>;
  closeShow: (showId: RadioShowId) => Promise<RouteCommitOutcome>;
  openShow: (request: RadioOpenShowRequest) => Promise<RouteCommitOutcome>;
  restoreArchiveContext: (seriesId?: RadioSeriesId) => void;
  seriesTravelSteps: number;
  selectSeries: (seriesId?: RadioSeriesId) => Promise<void>;
}>;

export const RadioRouteNavigationContext = createContext<
  RadioRouteNavigationValue | undefined
>(undefined);

export function useRadioRouteNavigation(): RadioRouteNavigationValue {
  const navigation = useContext(RadioRouteNavigationContext);
  if (!navigation) {
    throw new Error("Radio screens require a Radio route navigation provider");
  }
  return navigation;
}
