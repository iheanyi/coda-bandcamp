import { createContext, useContext } from "react";

import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";

import type { RadioOpenShowRequest } from "./radioScreenTypes";

export type RadioRouteNavigationAdapter = Readonly<{
  goBack: () => Promise<void>;
  goToIndex: (replace?: boolean) => Promise<void>;
  goToSeries: (seriesId: RadioSeriesId, replace?: boolean) => Promise<void>;
  goToShow: (showId: RadioShowId) => Promise<void>;
}>;

export type RadioRouteNavigationValue = Readonly<{
  browseSeriesFromShow: (seriesId?: RadioSeriesId) => Promise<void>;
  closeShow: (showId: RadioShowId) => Promise<void>;
  openShow: (request: RadioOpenShowRequest) => Promise<void>;
  restoreArchiveContext: (seriesId?: RadioSeriesId) => void;
  returningArtworkId?: RadioShowId;
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
