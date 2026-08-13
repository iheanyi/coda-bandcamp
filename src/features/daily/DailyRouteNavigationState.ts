import { createContext, useContext } from "react";

import type { DailyCategory } from "@/types";

import type { DailyOpenArticleRequest } from "./dailyNavigationTypes";

export type DailyArticleDestination = Readonly<{
  articleSection: string;
  category: DailyCategory;
  slug: string;
}>;

export type DailyRouteNavigationAdapter = Readonly<{
  goBack: (category: DailyCategory) => Promise<void>;
  goToArticle: (destination: DailyArticleDestination) => Promise<void>;
  goToIndex: (category: DailyCategory, replace?: boolean) => Promise<void>;
}>;

export type DailyRouteNavigationValue = Readonly<{
  closeArticle: (slug: string, category: DailyCategory) => Promise<void>;
  openArticle: (request: DailyOpenArticleRequest) => Promise<void>;
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
