import { type ReactNode, useCallback, useMemo } from "react";

import { parseDailyArticleSlug } from "@/daily";
import {
  closeIdentifiedDetail,
  openIdentifiedDetail,
} from "@/features/navigation/detailRouteNavigation";
import type { DailyCategory } from "@/types";

import {
  DailyRouteNavigationContext,
  type DailyRouteNavigationAdapter,
  type DailyRouteNavigationValue,
} from "./DailyRouteNavigationState";
import type { DailyOpenArticleRequest } from "./dailyNavigationTypes";

export type {
  DailyRouteNavigationAdapter,
  DailyRouteNavigationValue,
} from "./DailyRouteNavigationState";
export type { DailyOpenArticleRequest } from "./dailyNavigationTypes";

export function DailyRouteNavigationProvider({
  adapter,
  children,
}: Readonly<{
  adapter: DailyRouteNavigationAdapter;
  children: ReactNode;
}>) {
  const openArticle = useCallback(
    (request: DailyOpenArticleRequest) => {
      const slug = parseDailyArticleSlug(request.slug);
      return openIdentifiedDetail("daily", slug, request, () =>
        adapter.goToArticle({
          articleSection: request.articleSection,
          category: request.category,
          slug,
        }),
      );
    },
    [adapter],
  );

  const closeArticle = useCallback(
    (requestedSlug: string, category: DailyCategory) => {
      const slug = parseDailyArticleSlug(requestedSlug);
      return closeIdentifiedDetail("daily", slug, () => adapter.goBack(category));
    },
    [adapter],
  );

  const value = useMemo<DailyRouteNavigationValue>(
    () => ({ closeArticle, openArticle }),
    [closeArticle, openArticle],
  );

  return (
    <DailyRouteNavigationContext value={value}>
      {children}
    </DailyRouteNavigationContext>
  );
}
