import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const transitionMock = vi.hoisted(() => vi.fn());

vi.mock("@/viewTransitions", () => ({
  transitionCodaView: transitionMock,
}));

import { DailyRouteNavigationProvider } from "./DailyRouteNavigationContext";
import {
  type DailyRouteNavigationAdapter,
  useDailyRouteNavigation,
} from "./DailyRouteNavigationState";

const adapter: DailyRouteNavigationAdapter = {
  goBack: vi.fn(async () => undefined),
  goToArticle: vi.fn(async () => undefined),
  goToIndex: vi.fn(async () => undefined),
};

beforeEach(() => {
  vi.mocked(adapter.goBack).mockClear();
  vi.mocked(adapter.goToArticle).mockClear();
  vi.mocked(adapter.goToIndex).mockClear();
  transitionMock
    .mockReset()
    .mockImplementation(async (update: () => void | Promise<void>) => {
      await update();
    });
});

afterEach(() => {
  document.body.replaceChildren();
});

it("keeps Daily artwork and title identity through forward and focused Back navigation", async () => {
  const snapshots: Array<{
    afterArtworkReturn?: string;
    afterTitleReturn?: string;
    beforeArtworkDetail?: string;
    beforeArtworkSource?: string;
    beforeTitleSource?: string;
  }> = [];
  transitionMock.mockImplementation(
    async (
      update: () => void | Promise<void>,
      _kind: "daily-detail" | "daily-detail-close",
    ) => {
      const snapshot = {
        beforeArtworkDetail: document.querySelector<HTMLElement>(
          "[data-coda-daily-artwork-detail]",
        )?.dataset.codaDailyArtworkDetail,
        beforeArtworkSource: document.querySelector<HTMLElement>(
          "[data-coda-daily-artwork-source]",
        )?.dataset.codaDailyArtworkSource,
        beforeTitleSource: document.querySelector<HTMLElement>(
          "[data-coda-daily-title-source]",
        )?.dataset.codaDailyTitleSource,
      };
      await update();
      snapshots.push({
        ...snapshot,
        afterArtworkReturn: document.querySelector<HTMLElement>(
          "[data-coda-daily-artwork-return]",
        )?.dataset.codaDailyArtworkReturn,
        afterTitleReturn: document.querySelector<HTMLElement>(
          "[data-coda-daily-title-return]",
        )?.dataset.codaDailyTitleReturn,
      });
    },
  );

  const slug = "essential-releases-august-7-2026";
  const scrollRoot = document.createElement("div");
  scrollRoot.dataset.codaLibraryScroll = "";
  scrollRoot.scrollTop = 173;
  const card = document.createElement("article");
  const trigger = document.createElement("a");
  trigger.dataset.dailyArticleOpen = slug;
  trigger.tabIndex = 0;
  const artwork = document.createElement("span");
  artwork.dataset.dailyArticleArtwork = slug;
  const title = document.createElement("span");
  title.dataset.dailyArticleTitle = slug;
  trigger.append(artwork, title);
  card.append(trigger);
  scrollRoot.append(card);
  document.body.append(scrollRoot);

  const wrapper = ({ children }: { children: ReactNode }) => (
    <DailyRouteNavigationProvider adapter={adapter}>
      {children}
    </DailyRouteNavigationProvider>
  );
  const { result } = renderHook(() => useDailyRouteNavigation(), { wrapper });

  trigger.focus();
  await act(() =>
    result.current.openArticle({
      articleSection: "essential-releases",
      category: "genre-jazz",
      returnScrollTop: 173,
      slug,
      sourceArtwork: artwork,
      sourceTitle: title,
      sourceTrigger: trigger,
    }),
  );

  const detailArtwork = document.createElement("div");
  detailArtwork.dataset.codaDailyArtworkDetail = slug;
  const detailTitle = document.createElement("h1");
  detailTitle.dataset.codaDailyTitleDetail = slug;
  document.body.append(detailArtwork, detailTitle);
  scrollRoot.scrollTop = 0;

  await act(() => result.current.closeArticle(slug, "genre-jazz"));

  expect(adapter.goToArticle).toHaveBeenCalledWith({
    articleSection: "essential-releases",
    category: "genre-jazz",
    slug,
  });
  expect(adapter.goBack).toHaveBeenCalledWith("genre-jazz");
  expect(transitionMock.mock.calls.map((call) => call[1])).toEqual([
    "daily-detail",
    "daily-detail-close",
  ]);
  expect(snapshots).toEqual([
    expect.objectContaining({
      beforeArtworkSource: slug,
      beforeTitleSource: slug,
    }),
    expect.objectContaining({
      afterArtworkReturn: slug,
      afterTitleReturn: slug,
      beforeArtworkDetail: slug,
    }),
  ]);
  expect(scrollRoot.scrollTop).toBe(173);
  expect(trigger).toHaveFocus();
  expect(artwork).not.toHaveAttribute("data-coda-daily-artwork-return");
  expect(title).not.toHaveAttribute("data-coda-daily-title-return");
});
