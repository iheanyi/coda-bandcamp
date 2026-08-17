import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider, RouterProvider } from "@tanstack/react-router";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RadioSeriesNav } from "@/features/radio/RadioPresentation";
import { type RadioRuntimeValue } from "@/features/radio/RadioRuntimeContext";
import { RadioRuntimeProvider } from "@/features/radio/RadioRuntimeProvider";
import { CodaMotionProvider } from "@/MotionProvider";
import { createPlaybackClock } from "@/playbackClock";
import { createCodaMemoryRouter } from "@/router";
import {
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
  stringifyRadioShowIdParam,
  type RadioSeriesId,
} from "@/routing/routeContracts";
import {
  readTauriInvokeArguments,
  tauriNumber,
  tauriString,
} from "@/test/tauriInvoke";
import type { RadioShow, RadioShowsPage } from "@/types";

const mocks = {
  fetchRadioShow: vi.fn<(showId: number) => Promise<RadioShow>>(),
  fetchRadioShows:
    vi.fn<
      (request: {
        cursor?: string;
        seriesId?: number;
      }) => Promise<RadioShowsPage>
    >(),
};

function numberInvokeArgument(
  args: InvokeArgs | undefined,
  key: "seriesId" | "showId",
): number {
  const number = tauriNumber(readTauriInvokeArguments(args)[key], key);
  if (number <= 0) {
    throw new TypeError(`Radio command ${key} is invalid`);
  }
  return number;
}

function radioArchiveRequest(
  args: InvokeArgs | undefined,
): Parameters<typeof mocks.fetchRadioShows>[0] {
  const values = readTauriInvokeArguments(args);
  const request: Parameters<typeof mocks.fetchRadioShows>[0] = {};
  if (values.seriesId !== undefined) {
    request.seriesId = numberInvokeArgument(args, "seriesId");
  }
  if (values.cursor !== undefined) {
    request.cursor = tauriString(values.cursor, "cursor");
  }
  return request;
}

function installRadioBridge(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: async (command: string, args?: InvokeArgs) => {
        if (command === "radio_show") {
          return mocks.fetchRadioShow(numberInvokeArgument(args, "showId"));
        }
        if (command === "radio_shows") {
          return mocks.fetchRadioShows(radioArchiveRequest(args));
        }
        throw new Error(`Unexpected Radio command: ${command}`);
      },
    },
  });
}

const show: RadioShow = {
  id: 977,
  title: "Bandcamp Weekly",
  subtitle: "Deep Focus",
  description: "An hour of patient, independent music.",
  publishedAt: "24 Jul 2026 00:00:00 GMT",
  artworkUrl: "https://f4.bcbits.com/img/deep-focus.jpg",
  duration: 3_600,
  streamUrl: "https://bandcamp.com/radio-stream",
  chapters: [],
  series: {
    id: 5,
    title: "The Hip Hop Show",
    slug: "the-hip-hop-show",
  },
};

const runtime: RadioRuntimeValue = {
  favoriteShowIds: new Set(),
  onPlay: vi.fn(),
  onPlayAt: vi.fn(),
  onQueue: vi.fn(),
  onToggleFavorite: vi.fn(),
  onTogglePlayback: vi.fn(),
  playbackClock: createPlaybackClock(0),
  playing: false,
};

type TransitionSnapshot = {
  afterDetail?: string;
  afterReturn?: string;
  afterTitleReturn?: string;
  beforeDetail?: string;
  beforeSource?: string;
  beforeTitleSource?: string;
  className: string;
};

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);

function renderRadioRoute(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createCodaMemoryRouter(queryClient, [initialEntry]);
  const rendered = render(
    <CodaMotionProvider>
      <QueryClientProvider client={queryClient}>
        <RadioRuntimeProvider value={runtime}>
          <div
            data-coda-library-scroll
            style={{ height: 600, overflowY: "auto" }}
          >
            <RouterProvider router={router} />
          </div>
        </RadioRuntimeProvider>
      </QueryClientProvider>
    </CodaMotionProvider>,
  );
  return { ...rendered, queryClient, router };
}

type RadioSeriesNavHarnessProps = Readonly<{
  onSelect: (seriesId?: RadioSeriesId) => void;
  pending?: boolean;
  reducedMotion?: "always" | "never";
  selectedSeriesId?: RadioSeriesId;
}>;

function createRadioSeriesNavHarness(
  initialEntry: string,
  initialProps: RadioSeriesNavHarnessProps,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createCodaMemoryRouter(queryClient, [initialEntry]);
  const tree = ({
    onSelect,
    pending = false,
    reducedMotion = "never",
    selectedSeriesId,
  }: RadioSeriesNavHarnessProps) => (
    <MotionConfig reducedMotion={reducedMotion}>
      <LazyMotion features={domAnimation} strict>
        <QueryClientProvider client={queryClient}>
          <RouterContextProvider router={router}>
            <RadioSeriesNav
              onSelect={onSelect}
              pending={pending}
              selectedSeriesId={selectedSeriesId}
            />
          </RouterContextProvider>
        </QueryClientProvider>
      </LazyMotion>
    </MotionConfig>
  );
  const rendered = render(tree(initialProps));
  return {
    ...rendered,
    queryClient,
    rerenderNav: (props: RadioSeriesNavHarnessProps) =>
      rendered.rerender(tree(props)),
    router,
  };
}

beforeEach(() => {
  installRadioBridge();
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  mocks.fetchRadioShow.mockReset().mockResolvedValue(show);
  mocks.fetchRadioShows.mockReset().mockResolvedValue({
    results: [show],
    hasMore: false,
  });
  vi.mocked(runtime.onPlay).mockClear();
  vi.mocked(runtime.onQueue).mockClear();
});

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  document.documentElement.classList.remove(
    "coda-transition--radio-detail",
    "coda-transition--radio-detail-close",
  );
  if (originalStartViewTransition) {
    Object.defineProperty(
      document,
      "startViewTransition",
      originalStartViewTransition,
    );
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
});

describe("Radio series Smooth Tabs navigation", () => {
  it("keeps typed Links, keyboard activation, and intent preload intact", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const hipHopSeriesId = parseRadioSeriesIdParam(5);
    const metalSeriesId = parseRadioSeriesIdParam(7);
    const { container, router } = createRadioSeriesNavHarness(
      "/radio/series/5",
      {
        onSelect,
        selectedSeriesId: hipHopSeriesId,
      },
    );
    const preloadRoute = vi.spyOn(router, "preloadRoute");

    const activeLink = screen.getByRole("link", {
      name: "The Hip Hop Show",
    });
    expect(activeLink).toHaveAttribute("href", "/radio/series/5");
    expect(activeLink).toHaveAttribute("aria-current", "page");
    expect(
      activeLink.querySelector("[data-radio-series-active-indicator]"),
    ).toHaveAttribute("data-radio-series-indicator-motion", "spring");
    expect(screen.getByRole("link", { name: "All shows" })).toHaveAttribute(
      "href",
      "/radio",
    );

    const metalLink = screen.getByRole("link", { name: "The Metal Show" });
    expect(metalLink).toHaveAttribute("href", "/radio/series/7");
    await user.hover(metalLink);
    await waitFor(() => expect(preloadRoute).toHaveBeenCalled());

    metalLink.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith(metalSeriesId);
    expect(
      container.querySelector(
        "a a, a button, a input, a select, a textarea, button a",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps rapid controlled changes latest-wins while navigation is pending", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const electronicSeriesId = parseRadioSeriesIdParam(1);
    const indieSeriesId = parseRadioSeriesIdParam(6);
    const metalSeriesId = parseRadioSeriesIdParam(7);
    const { container, rerenderNav } = createRadioSeriesNavHarness("/radio", {
      onSelect,
    });

    rerenderNav({ onSelect, selectedSeriesId: electronicSeriesId });
    rerenderNav({
      onSelect,
      pending: true,
      selectedSeriesId: metalSeriesId,
    });

    const group = container.querySelector("[data-radio-series-layout-group]");
    expect(group).toHaveAttribute("aria-busy", "true");
    expect(
      container
        .querySelector("[data-radio-series-active-indicator]")
        ?.closest("a"),
    ).toHaveAccessibleName("The Metal Show");

    await user.click(screen.getByRole("link", { name: "The Indie Show" }));
    expect(onSelect).toHaveBeenLastCalledWith(indieSeriesId);
  });

  it("uses a Radio-specific layout group and snaps for reduced motion", () => {
    const onSelect = vi.fn();
    const electronicSeriesId = parseRadioSeriesIdParam(1);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const router = createCodaMemoryRouter(queryClient, ["/radio"]);
    const { container } = render(
      <MotionConfig reducedMotion="always">
        <LazyMotion features={domAnimation} strict>
          <QueryClientProvider client={queryClient}>
            <RouterContextProvider router={router}>
              <RadioSeriesNav
                onSelect={onSelect}
                pending={false}
                selectedSeriesId={electronicSeriesId}
              />
            </RouterContextProvider>
          </QueryClientProvider>
        </LazyMotion>
      </MotionConfig>,
    );

    expect(
      container.querySelector("[data-radio-series-layout-group]"),
    ).toHaveAttribute(
      "data-radio-series-layout-group",
      "coda-radio-series-navigation",
    );
    expect(
      container.querySelectorAll('[data-radio-series-indicator-motion="snap"]'),
    ).toHaveLength(1);
  });
});

describe("Radio file routes", () => {
  it("exposes typed Radio links without nesting actions or preloading signed media", async () => {
    const user = userEvent.setup();
    const { container, router } = renderRadioRoute("/radio/series/5");
    const preloadRoute = vi.spyOn(router, "preloadRoute");

    await screen.findByRole("heading", { name: show.subtitle });

    const selectedSeries = screen.getByRole("link", {
      name: "The Hip Hop Show",
    });
    const artwork = screen.getByRole("link", {
      name: `Open ${show.subtitle}`,
    });
    const title = screen.getByRole("link", { name: show.subtitle });
    const tracklist = screen.getByRole("link", { name: "View tracklist" });

    expect(selectedSeries).toHaveAttribute("href", "/radio/series/5");
    expect(selectedSeries).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All shows" })).toHaveAttribute(
      "href",
      "/radio",
    );
    expect(artwork).toHaveAttribute("href", "/radio/shows/977");
    expect(title).toHaveAttribute("href", "/radio/shows/977");
    expect(tracklist).toHaveAttribute("href", "/radio/shows/977");
    expect(
      container.querySelector(
        "a a, a button, a input, a select, a textarea, button a",
      ),
    ).not.toBeInTheDocument();

    await user.hover(tracklist);
    await waitFor(() => expect(preloadRoute).toHaveBeenCalled());
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();

    title.focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("heading", { name: "Songs in this show" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/radio/shows/977");
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
    expect(runtime.onPlay).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Browse all episodes" }),
    ).toHaveAttribute("href", "/radio/series/5");
    expect(
      container.querySelector(
        "a a, a button, a input, a select, a textarea, button a",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("commits the summary route shell before signed media resolves", async () => {
    let resolveShow: ((value: RadioShow) => void) | undefined;
    mocks.fetchRadioShow.mockReturnValueOnce(
      new Promise<RadioShow>((resolve) => {
        resolveShow = resolve;
      }),
    );
    const { router } = renderRadioRoute("/radio");

    await screen.findByRole("heading", { name: show.subtitle });
    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/radio/shows/977");
    });
    expect(
      screen.getByRole("heading", { name: show.subtitle, level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(
      document
        .querySelector('[data-coda-radio-artwork-detail="977"]')
        ?.querySelector("img"),
    ).toHaveAttribute("src", show.artworkUrl);
    expect(
      screen.getByRole("status", {
        name: "Loading Radio show tracklist",
      }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Loading show audio" }),
    ).toBeDisabled();
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveShow?.(show);
    });

    expect(
      await screen.findByRole("button", { name: "Play show" }),
    ).toBeEnabled();
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
  });

  it("keeps rapid series choices URL-backed without invoking a major view transition", async () => {
    vi.stubEnv("MODE", "coda-dev");
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      const updateCallbackDone = Promise.resolve(update());
      return {
        finished: updateCallbackDone,
        updateCallbackDone,
      };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const user = userEvent.setup();
    const { container, router } = renderRadioRoute("/radio");
    const preloadRoute = vi.spyOn(router, "preloadRoute");

    await screen.findByRole("heading", { name: show.subtitle });
    const appShell = container.querySelector('[data-slot="app-shell"]');
    const layoutGroupId = container.querySelector<HTMLElement>(
      "[data-radio-series-layout-group]",
    )?.dataset.radioSeriesLayoutGroup;
    expect(appShell).not.toBeNull();
    expect(layoutGroupId).toBe("coda-radio-series-navigation");
    const electronicLink = screen.getByRole("link", {
      name: "Bandcamp Electronic",
    });
    const metalLink = screen.getByRole("link", { name: "The Metal Show" });

    await user.hover(metalLink);
    await waitFor(() => expect(preloadRoute).toHaveBeenCalled());
    fireEvent.click(electronicLink);
    fireEvent.click(metalLink);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/radio/series/7");
    });
    await waitFor(() => {
      const selectedLink = screen.getByRole("link", {
        name: "The Metal Show",
      });
      expect(selectedLink).toHaveAttribute("aria-current", "page");
      expect(
        selectedLink.querySelector("[data-radio-series-active-indicator]"),
      ).toHaveAttribute("data-selection-travel-steps", "6");
    });
    expect(
      container.querySelector<HTMLElement>("[data-radio-series-layout-group]")
        ?.dataset.radioSeriesLayoutGroup,
    ).toBe(layoutGroupId);
    expect(container.querySelector('[data-slot="app-shell"]')).toBe(appShell);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("keeps show intent preload free of signed media and reuses the activation query", async () => {
    const { queryClient, router } = renderRadioRoute("/radio");
    const showId = stringifyRadioShowIdParam(parseRadioShowIdParam(show.id));

    await screen.findByRole("heading", { name: show.subtitle });
    await act(async () => {
      await router.preloadRoute({
        to: "/radio/shows/$showId",
        params: { showId },
      });
    });

    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();
    expect(
      queryClient.getQueryData(["bandcamp-radio-show", show.id]),
    ).toBeUndefined();

    await act(async () => {
      await router.navigate({
        to: "/radio/shows/$showId",
        params: { showId },
      });
    });
    expect(
      await screen.findByRole("heading", { name: "Songs in this show" }),
    ).toBeInTheDocument();
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
    expect(mocks.fetchRadioShow).toHaveBeenCalledWith(show.id);

    await act(async () => {
      await router.navigate({ to: "/radio" });
    });
    await screen.findByRole("heading", { name: show.subtitle });

    await act(async () => {
      await router.navigate({
        to: "/radio/shows/$showId",
        params: { showId },
      });
    });
    expect(
      await screen.findByRole("heading", { name: "Songs in this show" }),
    ).toBeInTheDocument();
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
  });

  it("loads a direct show by its bounded ID without fetching the archive", async () => {
    const { router } = renderRadioRoute("/radio/shows/977");

    expect(
      await screen.findByRole("heading", { name: show.subtitle }),
    ).toBeInTheDocument();
    expect(mocks.fetchRadioShow).toHaveBeenCalledWith(show.id);
    expect(mocks.fetchRadioShows).not.toHaveBeenCalled();

    const showMatch = router.state.matches.find(
      (match) => match.routeId === "/radio/shows/$showId",
    );
    expect(showMatch?.loaderData).toEqual({ showId: show.id });
  });

  it("renders the Radio archive spinner while its first page is pending", async () => {
    let resolveArchive:
      ((value: { results: RadioShow[]; hasMore: boolean }) => void) | undefined;
    mocks.fetchRadioShows.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveArchive = resolve;
      }),
    );

    renderRadioRoute("/radio");

    const pending = await screen.findByRole(
      "status",
      { name: "Tuning Bandcamp Radio…" },
      { timeout: 2_000 },
    );
    expect(pending).toHaveAttribute("aria-busy", "true");
    expect(pending.querySelector('[data-slot="spinner"]')).toBeInTheDocument();

    await act(async () => {
      resolveArchive?.({ hasMore: false, results: [show] });
    });
    expect(
      await screen.findByRole("heading", { name: show.subtitle }),
    ).toBeInTheDocument();
  });

  it("renders an honest show pending state on a summary-free deep link", async () => {
    let resolveShow: ((value: RadioShow) => void) | undefined;
    mocks.fetchRadioShow.mockReturnValueOnce(
      new Promise<RadioShow>((resolve) => {
        resolveShow = resolve;
      }),
    );

    const { router } = renderRadioRoute("/radio/shows/977");

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/radio/shows/977");
      expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
    });
    const pending = await screen.findByRole("status", {
      name: "Loading Radio show details",
    });
    expect(pending).toBeInTheDocument();

    await act(async () => {
      resolveShow?.(show);
    });
    expect(
      await screen.findByRole("heading", { name: "Songs in this show" }),
    ).toBeInTheDocument();
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
  });

  it("shows an honest error when a summary-free deep link fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let rejectShow: ((reason?: Error) => void) | undefined;
    mocks.fetchRadioShow.mockReturnValueOnce(
      new Promise<RadioShow>((_, reject) => {
        rejectShow = (reason) => reject(reason);
      }),
    );

    const { router } = renderRadioRoute("/radio/shows/977");

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe("/radio/shows/977");
        expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
      },
      { timeout: 1_000 },
    );
    await screen.findByRole(
      "status",
      {
        name: "Loading Radio show details",
      },
      { timeout: 1_000 },
    );
    rejectShow?.(new Error("The signed Radio stream expired"));
    await waitFor(
      () => {
        expect(document.body).toHaveTextContent(
          "This Radio show is off the air",
        );
      },
      { timeout: 1_000 },
    );
    expect(mocks.fetchRadioShow).toHaveBeenCalledTimes(1);
    expect(mocks.fetchRadioShows).not.toHaveBeenCalled();
  });

  it("loads only the selected supported series archive", async () => {
    const { router } = renderRadioRoute("/radio/series/5");

    expect(
      await screen.findByRole("heading", { name: show.subtitle }),
    ).toBeInTheDocument();
    expect(mocks.fetchRadioShows).toHaveBeenCalledWith({
      cursor: undefined,
      seriesId: 5,
    });
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();

    const seriesMatch = router.state.matches.find(
      (match) => match.routeId === "/radio/series/$seriesId",
    );
    expect(seriesMatch?.loaderData).toBeUndefined();
  });

  it("restores archive scroll and trigger focus after route-backed show navigation", async () => {
    const snapshots: TransitionSnapshot[] = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const snapshot: TransitionSnapshot = {
          beforeDetail: document.querySelector<HTMLElement>(
            "[data-coda-radio-artwork-detail]",
          )?.dataset.codaRadioArtworkDetail,
          beforeSource: document.querySelector<HTMLElement>(
            "[data-coda-radio-artwork-source]",
          )?.dataset.codaRadioArtworkSource,
          beforeTitleSource: document.querySelector<HTMLElement>(
            "[data-coda-radio-title-source]",
          )?.dataset.codaRadioTitleSource,
          className: document.documentElement.className,
        };
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          snapshot.afterDetail = document.querySelector<HTMLElement>(
            "[data-coda-radio-artwork-detail]",
          )?.dataset.codaRadioArtworkDetail;
          snapshot.afterReturn = document.querySelector<HTMLElement>(
            "[data-coda-radio-artwork-return]",
          )?.dataset.codaRadioArtworkReturn;
          snapshot.afterTitleReturn = document.querySelector<HTMLElement>(
            "[data-coda-radio-title-return]",
          )?.dataset.codaRadioTitleReturn;
          snapshots.push(snapshot);
        });
        return {
          finished: updateCallbackDone,
          updateCallbackDone,
        };
      }),
    });

    const { router } = renderRadioRoute("/radio");

    await screen.findByRole("heading", { name: show.subtitle });
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    expect(scrollRoot).not.toBeNull();
    if (scrollRoot) scrollRoot.scrollTop = 173;
    const openShow = screen.getByRole("link", { name: "View tracklist" });
    openShow.focus();
    fireEvent.click(openShow);

    expect(
      await screen.findByRole("heading", { name: "Songs in this show" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/radio/shows/977");
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const restoredTrigger = await screen.findByRole("link", {
      name: "View tracklist",
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/radio");
      expect(restoredTrigger).toHaveFocus();
      expect(scrollRoot?.scrollTop).toBe(173);
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          afterDetail: String(show.id),
          beforeSource: String(show.id),
          beforeTitleSource: String(show.id),
          className: expect.stringContaining("coda-transition--radio-detail"),
        }),
        expect.objectContaining({
          afterReturn: String(show.id),
          afterTitleReturn: String(show.id),
          beforeDetail: String(show.id),
          className: expect.stringContaining(
            "coda-transition--radio-detail-close",
          ),
        }),
      ]),
    );
  });

  it("renders the Radio not-found boundary for an unsupported series ID", async () => {
    const { router } = renderRadioRoute("/radio/series/3");

    expect(
      await screen.findByRole("heading", {
        name: "Radio destination not found",
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/radio/series/3");
    });
    expect(mocks.fetchRadioShows).not.toHaveBeenCalled();
    expect(mocks.fetchRadioShow).not.toHaveBeenCalled();
  });
});
