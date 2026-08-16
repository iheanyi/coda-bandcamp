import { createContext, useContext } from "react";

import type {
  RouteCommitOutcome,
  RouteCommitResult,
} from "@/features/navigation/routeCommit";
import type { DailyCategory } from "@/types";

import type { DailyOpenArticleRequest } from "./dailyNavigationTypes";

export type DailyArticleDestination = Readonly<{
  articleSection: string;
  category: DailyCategory;
  slug: string;
}>;

export type DailyRouteNavigationAdapter = Readonly<{
  goBack: (category: DailyCategory) => Promise<RouteCommitResult>;
  goToArticle: (destination: DailyArticleDestination) => Promise<RouteCommitResult>;
  goToIndex: (category: DailyCategory, replace?: boolean) => Promise<RouteCommitResult>;
}>;

export type DailyRouteNavigationValue = Readonly<{
  closeArticle: (slug: string, category: DailyCategory) => Promise<RouteCommitOutcome>;
  openArticle: (request: DailyOpenArticleRequest) => Promise<RouteCommitOutcome>;
}>;

export const DailyRouteNavigationContext = createContext<
  DailyRouteNavigationValue | undefined
>(undefined);

export function useDailyRouteNavigation(): DailyRouteNavigationValue {
  const navigation = useContext(DailyRouteNavigationContext);
  if (!navigation) {
    throw new Error("Daily screens require a Daily route navigation provider");
  }
  return navigation;
}
