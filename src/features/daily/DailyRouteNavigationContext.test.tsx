import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getMotionDiagnostic } from "@/motionDiagnostics";
import type { RouteCommitOutcome } from "@/features/navigation/routeCommit";
import {
  installDocumentViewTransitionHarness,
  type TestDocumentViewTransition,
  type TestDocumentViewTransitionCapture,
} from "@/test/documentViewTransitionHarness";

import { DailyRouteNavigationProvider } from "./DailyRouteNavigationContext";
import {
  type DailyRouteNavigationAdapter,
  useDailyRouteNavigation,
} from "./DailyRouteNavigationState";

const RENDERED_COMMIT = {
  locationKey: "rendered",
  outcome: "rendered" as const,
};

const adapter: DailyRouteNavigationAdapter = {
  goBack: vi.fn(async () => RENDERED_COMMIT),
  goToArticle: vi.fn(async () => RENDERED_COMMIT),
  goToIndex: vi.fn(async () => RENDERED_COMMIT),
};

let captureTransition = (_capture: TestDocumentViewTransitionCapture) => {};
let finishTransition = (_transition: TestDocumentViewTransition) => {};
let transitionHarness: ReturnType<
  typeof installDocumentViewTransitionHarness
>;

beforeEach(() => {
  vi.mocked(adapter.goBack).mockClear();
  vi.mocked(adapter.goToArticle).mockClear();
  vi.mocked(adapter.goToIndex).mockClear();
  captureTransition = () => {};
  finishTransition = () => {};
  transitionHarness = installDocumentViewTransitionHarness({
    autoFinish: true,
    onCapture: (capture) => captureTransition(capture),
    onUpdated: (transition) => finishTransition(transition),
  });
});

afterEach(() => {
  transitionHarness.restore();
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
  let pendingSnapshot: (typeof snapshots)[number] = {};
  captureTransition = () => {
    pendingSnapshot = {
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
  };
  finishTransition = () => {
    snapshots.push({
      ...pendingSnapshot,
      afterArtworkReturn: document.querySelector<HTMLElement>(
        "[data-coda-daily-artwork-return]",
      )?.dataset.codaDailyArtworkReturn,
      afterTitleReturn: document.querySelector<HTMLElement>(
        "[data-coda-daily-title-return]",
      )?.dataset.codaDailyTitleReturn,
    });
  };

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
      sharedIdentityAvailable: true,
      slug,
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
  expect(transitionHarness.transitions.map(({ kind }) => kind)).toEqual([
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

it("uses page motion when Daily has a title but no shared artwork", async () => {
  const trigger = document.createElement("a");
  trigger.dataset.dailyArticleOpen = "title-only";
  const title = document.createElement("span");
  trigger.append(title);
  document.body.append(trigger);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DailyRouteNavigationProvider adapter={adapter}>
      {children}
    </DailyRouteNavigationProvider>
  );
  const { result } = renderHook(() => useDailyRouteNavigation(), { wrapper });

  await act(() =>
    result.current.openArticle({
      articleSection: "features",
      category: "features",
      returnScrollTop: 0,
      sharedIdentityAvailable: false,
      slug: "title-only",
      sourceTrigger: trigger,
    }),
  );
  expect(getMotionDiagnostic()?.kind).toBe("page-forward");
  await act(() => result.current.closeArticle("title-only", "features"));
  expect(getMotionDiagnostic()?.kind).toBe("page-back");

  expect(title).not.toHaveAttribute("data-coda-daily-title-source");
});

it("coalesces repeated Daily Back requests", async () => {
  let releaseBack = () => {};
  vi.mocked(adapter.goBack).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseBack = () => resolve(RENDERED_COMMIT);
      }),
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <DailyRouteNavigationProvider adapter={adapter}>
      {children}
    </DailyRouteNavigationProvider>
  );
  const { result } = renderHook(() => useDailyRouteNavigation(), { wrapper });

  let first!: Promise<RouteCommitOutcome>;
  let second!: Promise<RouteCommitOutcome>;
  act(() => {
    first = result.current.closeArticle("same-story", "features");
    second = result.current.closeArticle("same-story", "features");
  });

  expect(second).toBe(first);
  expect(adapter.goBack).toHaveBeenCalledOnce();
  expect(getMotionDiagnostic()?.kind).toBe("page-back");

  releaseBack();
  await act(() => first);
});
