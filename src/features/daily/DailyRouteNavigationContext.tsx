import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";

import { parseDailyArticleSlug } from "@/daily";
import {
  acquireTemporaryAttribute,
  combineMarkerReleases,
} from "@/features/navigation/temporaryDomMarkers";
import { forcePaintedReturnAncestors } from "@/features/navigation/virtualReturnEndpoint";
import {
  createNavigationTransactionState,
  replaceNavigationTransaction,
  resolveNavigationReturnFocus,
  resolveNavigationReturnScrollTop,
  settleNavigationTransaction,
} from "@/navigationTransaction";
import type { DailyCategory } from "@/types";
import { transitionCodaView } from "@/viewTransitions";

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

function findDailyReturnTrigger(slug: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>("[data-daily-article-open]"),
  ).find((candidate) => candidate.dataset.dailyArticleOpen === slug);
}

function dailyIdentityElement(
  owner: HTMLElement,
  attribute: "data-daily-article-artwork" | "data-daily-article-title",
  slug: string,
): HTMLElement | undefined {
  return Array.from(owner.querySelectorAll<HTMLElement>(`[${attribute}]`)).find(
    (candidate) => candidate.getAttribute(attribute) === slug,
  );
}

function markDailyReturnDestination(
  trigger: HTMLElement,
  slug: string,
  scrollRoot: HTMLElement | null,
): () => void {
  const owner = trigger.closest<HTMLElement>("article") ?? trigger;
  const artwork = dailyIdentityElement(
    owner,
    "data-daily-article-artwork",
    slug,
  );
  const title = dailyIdentityElement(owner, "data-daily-article-title", slug);

  return combineMarkerReleases([
    forcePaintedReturnAncestors(owner, scrollRoot),
    ...(artwork
      ? [
          acquireTemporaryAttribute(
            artwork,
            "data-coda-daily-artwork-return",
            slug,
          ),
        ]
      : []),
    ...(title
      ? [acquireTemporaryAttribute(title, "data-coda-daily-title-return", slug)]
      : []),
  ]);
}

export function DailyRouteNavigationProvider({
  adapter,
  children,
  transition = transitionCodaView,
}: Readonly<{
  adapter: DailyRouteNavigationAdapter;
  children: ReactNode;
  transition?: typeof transitionCodaView;
}>) {
  const navigationRef = useRef(createNavigationTransactionState());
  const activeSourceReleaseRef = useRef<(() => void) | undefined>(undefined);
  const closeGenerationRef = useRef(0);

  const openArticle = useCallback(
    (request: DailyOpenArticleRequest) => {
      const slug = parseDailyArticleSlug(request.slug);
      const hasSharedIdentity = Boolean(
        request.sourceArtwork || request.sourceTitle,
      );
      closeGenerationRef.current += 1;
      navigationRef.current = replaceNavigationTransaction(
        navigationRef.current,
        {
          destinationHeadingId: "daily-article-heading",
          entrance: hasSharedIdentity ? "shared-element" : "page-forward",
          intent: "forward",
          returnScrollTop: request.returnScrollTop,
          routeKey: "daily-detail",
          sharedElementOwner: hasSharedIdentity
            ? "coda-daily-article"
            : undefined,
          sourceTrigger: request.sourceTrigger,
        },
      );

      activeSourceReleaseRef.current?.();
      const releaseSourceMarkers = combineMarkerReleases([
        ...(request.sourceArtwork
          ? [
              acquireTemporaryAttribute(
                request.sourceArtwork,
                "data-coda-daily-artwork-source",
                slug,
              ),
            ]
          : []),
        ...(request.sourceTitle
          ? [
              acquireTemporaryAttribute(
                request.sourceTitle,
                "data-coda-daily-title-source",
                slug,
              ),
            ]
          : []),
      ]);
      activeSourceReleaseRef.current = releaseSourceMarkers;

      return transition(
        () =>
          adapter.goToArticle({
            articleSection: request.articleSection,
            category: request.category,
            slug,
          }),
        hasSharedIdentity ? "daily-detail" : "page-forward",
      ).finally(() => {
        releaseSourceMarkers();
        if (activeSourceReleaseRef.current === releaseSourceMarkers) {
          activeSourceReleaseRef.current = undefined;
        }
      });
    },
    [adapter, transition],
  );

  const closeArticle = useCallback(
    async (requestedSlug: string, category: DailyCategory) => {
      const slug = parseDailyArticleSlug(requestedSlug);
      const closeGeneration = ++closeGenerationRef.current;
      const transaction = navigationRef.current.active;
      const reversesSharedIdentity =
        transaction?.entrance === "shared-element" &&
        transaction.sharedElementOwner === "coda-daily-article" &&
        transaction.sourceTrigger?.dataset.dailyArticleOpen === slug;
      const returnScrollTop = transaction
        ? resolveNavigationReturnScrollTop(transaction)
        : 0;
      let replacement: HTMLElement | undefined;
      let releaseReturnDestination = () => {};

      try {
        await transition(
          async () => {
            await adapter.goBack(category);
            const scrollRoot = document.querySelector<HTMLElement>(
              "[data-coda-library-scroll]",
            );
            if (scrollRoot) scrollRoot.scrollTop = returnScrollTop;
            replacement = findDailyReturnTrigger(slug);
            if (
              reversesSharedIdentity &&
              replacement &&
              closeGenerationRef.current === closeGeneration
            ) {
              releaseReturnDestination = markDailyReturnDestination(
                replacement,
                slug,
                scrollRoot,
              );
            }
          },
          reversesSharedIdentity ? "daily-detail-close" : "page-back",
        );

        if (transaction && closeGenerationRef.current === closeGeneration) {
          const result = resolveNavigationReturnFocus(
            transaction,
            replacement ?? findDailyReturnTrigger(slug),
          );
          result.target?.focus({ preventScroll: true });
          if (navigationRef.current.active?.identity === transaction.identity) {
            navigationRef.current = settleNavigationTransaction(
              navigationRef.current,
              transaction.identity,
            );
          }
        }
      } finally {
        releaseReturnDestination();
      }
    },
    [adapter, transition],
  );

  useEffect(
    () => () => {
      activeSourceReleaseRef.current?.();
      activeSourceReleaseRef.current = undefined;
    },
    [],
  );

  const value = useMemo<DailyRouteNavigationValue>(
    () => ({ closeArticle, openArticle }),
    [closeArticle, openArticle],
  );

  return (
    <DailyRouteNavigationContext.Provider value={value}>
      {children}
    </DailyRouteNavigationContext.Provider>
  );
}
