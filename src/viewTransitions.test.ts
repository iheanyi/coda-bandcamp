import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  consumePendingPageEntrance,
  installViewTransitionMotionDriver,
  transitionCodaView,
  type CodaViewTransitionKind,
} from "./viewTransitions";
import { getMotionDiagnostic, recordMotionInput } from "./motionDiagnostics";

const motionMocks = {
  animate: vi.fn(),
};
let releaseMotionDriver = () => {};

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);
const originalGetAnimations = Object.getOwnPropertyDescriptor(
  document,
  "getAnimations",
);
const originalMatchMedia = window.matchMedia;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function installNativeTransition({
  finished = Promise.resolve(),
  onCapture = () => undefined,
  onUpdated = () => undefined,
  skipTransition = vi.fn(),
}: Readonly<{
  finished?: Promise<void>;
  onCapture?: () => void;
  onUpdated?: () => void;
  skipTransition?: ReturnType<typeof vi.fn>;
}> = {}) {
  const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
    onCapture();
    const updateCallbackDone = Promise.resolve(update()).then(onUpdated);
    return {
      finished: Promise.all([updateCallbackDone, finished]).then(
        () => undefined,
      ),
      ready: updateCallbackDone,
      skipTransition,
      updateCallbackDone,
    };
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: startViewTransition,
  });
  return { skipTransition, startViewTransition };
}

function mountLibraryPane() {
  const pane = document.createElement("main");
  pane.className = "library-pane";
  pane.textContent = "Collection";
  document.body.append(pane);
  return pane;
}

const DETAIL_CASES = [
  ["album-detail", "coda-transition--album-detail"],
  ["album-detail-close", "coda-transition--album-detail-close"],
  ["artist-detail", "coda-transition--artist-detail"],
  ["artist-detail-close", "coda-transition--artist-detail-close"],
  ["daily-detail", "coda-transition--daily-detail"],
  ["daily-detail-close", "coda-transition--daily-detail-close"],
  ["discover-detail", "coda-transition--discover-detail"],
  ["discover-detail-close", "coda-transition--discover-detail-close"],
  ["playlist-detail", "coda-transition--playlist-detail"],
  ["playlist-detail-close", "coda-transition--playlist-detail-close"],
  ["radio-detail", "coda-transition--radio-detail"],
  ["radio-detail-close", "coda-transition--radio-detail-close"],
  ["now-playing-open", "coda-transition--now-playing-open"],
  ["now-playing-close", "coda-transition--now-playing-close"],
] as const satisfies ReadonlyArray<readonly [CodaViewTransitionKind, string]>;

beforeEach(() => {
  releaseMotionDriver = installViewTransitionMotionDriver(motionMocks);
  motionMocks.animate.mockReset();
  motionMocks.animate.mockImplementation(() => ({
    finished: Promise.resolve(),
    stop: vi.fn(),
  }));
  document.body.replaceChildren();
  document.documentElement.className = "";
  document.documentElement.removeAttribute("style");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({ matches: false })),
  });
  Reflect.deleteProperty(document, "startViewTransition");
  Reflect.deleteProperty(document, "getAnimations");
});

afterEach(() => {
  releaseMotionDriver();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  if (originalStartViewTransition) {
    Object.defineProperty(
      document,
      "startViewTransition",
      originalStartViewTransition,
    );
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
  if (originalGetAnimations) {
    Object.defineProperty(document, "getAnimations", originalGetAnimations);
  } else {
    Reflect.deleteProperty(document, "getAnimations");
  }
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("detail view transitions", () => {
  it("paints immediate shared-source feedback before native capture", async () => {
    const source = document.createElement("div");
    source.className = "coda-album-artwork-source";
    const cancel = vi.fn();
    const animateSource = vi.fn(() => ({ cancel }));
    Object.defineProperty(source, "animate", {
      configurable: true,
      value: animateSource,
    });
    document.body.append(source);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { startViewTransition } = installNativeTransition();
    recordMotionInput("pointer");

    await transitionCodaView(vi.fn(), "album-detail");

    expect(animateSource).toHaveBeenCalledOnce();
    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(getMotionDiagnostic()).toMatchObject({
      firstVisualMs: expect.any(Number),
      phaseTimings: {
        sourceFeedbackMs: expect.any(Number),
        sourceFeedbackPaintMs: expect.any(Number),
      },
    });
  });

  it("commits immediately when the platform API is unavailable", async () => {
    const update = vi.fn();

    await transitionCodaView(update, "album-detail");

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(false);
    expect(getMotionDiagnostic()).toMatchObject({
      configuredDurationMs: 460,
      firstVisualMs: expect.any(Number),
      phaseTimings: {
        finishedMs: expect.any(Number),
        readyMs: expect.any(Number),
        updateMs: expect.any(Number),
        updateStartMs: expect.any(Number),
      },
      speed: 1,
      status: "bypassed",
    });
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");

    await transitionCodaView(vi.fn(), "now-playing-open");
    expect(getMotionDiagnostic()).toMatchObject({
      configuredDurationMs: 440,
      speed: 1,
      status: "bypassed",
    });
  });

  it("uses the same native coordinator in product and test modes", async () => {
    vi.stubEnv("MODE", "coda-dev");
    let classDuringCapture = "";
    const { startViewTransition } = installNativeTransition({
      onCapture: () => {
        classDuringCapture = document.documentElement.className;
      },
    });
    const update = vi.fn();

    await transitionCodaView(update, "album-detail");

    expect(startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(classDuringCapture).toContain("coda-transition--album-detail");
  });

  it.each(DETAIL_CASES)(
    "exposes and cleans the %s lifecycle",
    async (kind, className) => {
      let classDuringCapture = "";
      installNativeTransition({
        onCapture: () => {
          classDuringCapture = document.documentElement.className;
        },
      });

      await transitionCodaView(vi.fn(), kind);

      expect(classDuringCapture).toContain("coda-view-transitioning");
      expect(classDuringCapture).toContain(className);
      expect(document.documentElement).not.toHaveClass(className);
    },
  );

  it("holds the destination capture until an async route commit finishes", async () => {
    const routeCommit = deferred();
    const destinationCaptured = vi.fn();
    installNativeTransition({ onUpdated: destinationCaptured });

    const transition = transitionCodaView(
      () => routeCommit.promise,
      "album-detail",
    );

    expect(destinationCaptured).not.toHaveBeenCalled();
    routeCommit.resolve();
    await transition;
    expect(destinationCaptured).toHaveBeenCalledOnce();
  });

  it("waits for the browser lifecycle instead of a timer", async () => {
    const finished = deferred();
    installNativeTransition({ finished: finished.promise });
    let settled = false;

    const transition = transitionCodaView(vi.fn(), "now-playing-open").then(
      () => {
        settled = true;
      },
    );
    await Promise.resolve();

    expect(settled).toBe(false);
    finished.resolve();
    await transition;
    expect(settled).toBe(true);
  });

  it("skips an owned snapshot when the host cannot make it compositor-only", async () => {
    const skipTransition = vi.fn();
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [
        {
          effect: {
            pseudoElement: "::view-transition-group(coda-album-artwork)",
            getKeyframes: () => [
              { width: "80px", height: "80px" },
              { width: "160px", height: "160px" },
            ],
            getComputedTiming: () => ({ endTime: 180 }),
          },
        },
      ],
    });
    installNativeTransition({ skipTransition });

    await transitionCodaView(vi.fn(), "album-detail");

    expect(skipTransition).toHaveBeenCalledOnce();
    expect(getMotionDiagnostic()).toMatchObject({
      reason: "unsafe-compositor",
      status: "bypassed",
    });
  });

  it("reports fixed native timing and paired destination endpoints", async () => {
    const source = document.createElement("div");
    source.className = "coda-album-artwork-source";
    const sourceRect = vi.spyOn(source, "getBoundingClientRect");
    document.body.append(source);
    const destination = document.createElement("div");
    destination.dataset.codaAlbumArtworkDetail = "album-1";
    const destinationRect = vi.spyOn(destination, "getBoundingClientRect");
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () =>
        ["coda-album-artwork", "coda-detail-surface"].map((name) => ({
          playState: "running",
          effect: {
            pseudoElement: `::view-transition-group(${name})`,
            getKeyframes: () => [{ opacity: 1 }, { opacity: 1 }],
            getComputedTiming: () => ({
              endTime: name === "coda-album-artwork" ? 460 : 220,
            }),
          },
        })),
    });
    installNativeTransition();

    await transitionCodaView(() => {
      source.remove();
      document.body.append(destination);
    }, "album-detail");

    expect(getMotionDiagnostic()).toMatchObject({
      actualDurationMs: 460,
      configuredDurationMs: 460,
      destinationCount: 1,
      duplicateEndpoints: [],
      firstVisualMs: expect.any(Number),
      kind: "album-detail",
      missingEndpoints: [],
      sharedPaired: true,
      sourceCount: 1,
      speed: 1,
      status: "finished",
      phaseTimings: {
        compositorMs: expect.any(Number),
        finishedMs: expect.any(Number),
        readyMs: expect.any(Number),
        updateMs: expect.any(Number),
        updateStartMs: expect.any(Number),
      },
      totalFromInputMs: expect.any(Number),
    });
    expect(sourceRect).not.toHaveBeenCalled();
    expect(destinationRect).not.toHaveBeenCalled();
  });

  it("does not reject committed navigation when pseudo diagnostics fail", async () => {
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => {
        throw new Error("animation inspection unavailable");
      },
    });
    const { skipTransition } = installNativeTransition();
    const update = vi.fn();

    await expect(
      transitionCodaView(update, "album-detail"),
    ).resolves.toBeUndefined();

    expect(update).toHaveBeenCalledOnce();
    expect(skipTransition).toHaveBeenCalledOnce();
  });

  it("suppresses only a surviving artwork endpoint, not its title", async () => {
    const artwork = document.createElement("div");
    artwork.className = "coda-album-artwork-source";
    const title = document.createElement("span");
    title.dataset.codaAlbumTitleSource = "album-1";
    document.body.append(artwork, title);
    let artworkNameDuringCapture = "";
    let titleNameDuringCapture = "";
    installNativeTransition({
      onUpdated: () => {
        artworkNameDuringCapture = artwork.style.getPropertyValue(
          "view-transition-name",
        );
        titleNameDuringCapture = title.style.getPropertyValue(
          "view-transition-name",
        );
      },
    });

    await transitionCodaView(vi.fn(), "album-detail");

    expect(artworkNameDuringCapture).toBe("none");
    expect(titleNameDuringCapture).toBe("");
    expect(artwork.style.getPropertyValue("view-transition-name")).toBe("");
  });

  it("skips a stale native transition before starting the newest detail", async () => {
    const firstFinished = deferred();
    const skipFirst = vi.fn(firstFinished.resolve);
    let callCount = 0;
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      callCount += 1;
      const updateCallbackDone = Promise.resolve(update());
      return {
        finished:
          callCount === 1
            ? Promise.all([updateCallbackDone, firstFinished.promise]).then(
                () => undefined,
              )
            : updateCallbackDone,
        ready: updateCallbackDone,
        skipTransition: callCount === 1 ? skipFirst : vi.fn(),
        updateCallbackDone,
      };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    const first = transitionCodaView(vi.fn(), "album-detail");
    await Promise.resolve();
    const second = transitionCodaView(vi.fn(), "artist-detail");

    expect(skipFirst).toHaveBeenCalledOnce();
    expect(document.documentElement).toHaveClass(
      "coda-transition--artist-detail",
    );
    await Promise.all([first, second]);
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("falls back once and clears native support after a lifecycle failure", async () => {
    const update = vi.fn();
    const error = new Error("snapshot failed");
    installNativeTransition({ finished: Promise.reject(error) });

    await transitionCodaView(update, "radio-detail");

    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
    );
  });

  it("propagates a rejected native route update", async () => {
    const failure = new Error("route commit failed");
    installNativeTransition();

    await expect(
      transitionCodaView(() => Promise.reject(failure), "album-detail"),
    ).rejects.toBe(failure);
  });

  it("awaits a fallback update when native startup throws", async () => {
    const routeCommit = deferred();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(() => {
        throw new Error("native startup failed");
      }),
    });
    const update = vi.fn(() => routeCommit.promise);
    let settled = false;

    const transition = transitionCodaView(update, "album-detail").then(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(update).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    routeCommit.resolve();
    await transition;
    expect(settled).toBe(true);
  });
});

describe("primary page transitions", () => {
  it("commits without a snapshot when no persistent pane is mounted", async () => {
    const { startViewTransition } = installNativeTransition();
    const update = vi.fn();

    await transitionCodaView(update, "page-forward");

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(false);
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(motionMocks.animate).not.toHaveBeenCalled();
  });

  it("moves old and new panes without a zero-opacity frame", async () => {
    const pane = mountLibraryPane();
    const paneRect = vi.spyOn(pane, "getBoundingClientRect");
    const { startViewTransition } = installNativeTransition();
    const exitFinished = deferred();
    const enterFinished = deferred();
    motionMocks.animate
      .mockImplementationOnce(() => ({
        finished: exitFinished.promise,
        stop: vi.fn(),
      }))
      .mockImplementationOnce(() => ({
        finished: enterFinished.promise,
        stop: vi.fn(),
      }));
    const routeCommit = deferred();
    const update = vi.fn(async (routerViewTransition?: boolean) => {
      expect(routerViewTransition).toBe(false);
      await routeCommit.promise;
      pane.textContent = "Discover";
      expect(consumePendingPageEntrance(pane)).toBe(true);
    });

    const transition = transitionCodaView(update, "page-forward");

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(motionMocks.animate).toHaveBeenLastCalledWith(
      pane,
      {
        transform: ["translateX(0px) scale(1)", "translateX(-6px) scale(1)"],
      },
      expect.objectContaining({ duration: 0.12 }),
    );
    exitFinished.resolve();
    await vi.waitFor(() => expect(update).toHaveBeenCalledOnce());
    routeCommit.resolve();
    await vi.waitFor(() =>
      expect(motionMocks.animate).toHaveBeenCalledTimes(2),
    );
    expect(motionMocks.animate).toHaveBeenLastCalledWith(
      pane,
      {
        transform: ["translateX(10px) scale(1)", "translateX(0px) scale(1)"],
      },
      expect.objectContaining({ delay: 0.015, duration: 0.18 }),
    );
    expect(pane.style.opacity).not.toBe("0");
    enterFinished.resolve();
    await transition;
    expect(pane.style.opacity).toBe("");
    expect(pane.style.transform).toBe("");
    expect(pane.style.willChange).toBe("");
    expect(paneRect).not.toHaveBeenCalled();
    expect(getMotionDiagnostic()).toMatchObject({
      configuredDurationMs: 315,
      destinationCount: 1,
      firstVisualMs: expect.any(Number),
      phaseTimings: {
        entranceMs: expect.any(Number),
        entranceStartMs: expect.any(Number),
        exitMs: expect.any(Number),
        finishedMs: expect.any(Number),
        updateMs: expect.any(Number),
        updateStartMs: expect.any(Number),
      },
      status: "finished",
      totalFromInputMs: expect.any(Number),
    });
  });

  it("binds a page entrance to a different destination commit", async () => {
    const pane = mountLibraryPane();
    pane.dataset.codaTransitionKey = "collection";
    const update = vi.fn(() => {
      expect(consumePendingPageEntrance(pane, "collection")).toBe(false);
      pane.dataset.codaTransitionKey = "discover";
      expect(consumePendingPageEntrance(pane, "discover")).toBe(true);
    });

    await transitionCodaView(update, "page-forward");

    expect(motionMocks.animate).toHaveBeenCalledTimes(2);
  });

  it("commits and propagates route failures even when Motion setup fails", async () => {
    const routeFailure = new Error("route failed");
    mountLibraryPane();
    motionMocks.animate.mockImplementationOnce(() => {
      throw new Error("motion unavailable");
    });
    const update = vi.fn(() => Promise.reject(routeFailure));

    await expect(transitionCodaView(update, "page-forward")).rejects.toBe(
      routeFailure,
    );
    expect(update).toHaveBeenCalledOnce();
  });

  it("reverses the page direction for Back", async () => {
    const pane = mountLibraryPane();
    const update = vi.fn(() => {
      expect(consumePendingPageEntrance(pane)).toBe(true);
    });

    await transitionCodaView(update, "page-back");

    expect(motionMocks.animate).toHaveBeenNthCalledWith(
      1,
      pane,
      {
        transform: ["translateX(0px) scale(1)", "translateX(6px) scale(1)"],
      },
      expect.any(Object),
    );
    expect(motionMocks.animate).toHaveBeenNthCalledWith(
      2,
      pane,
      {
        transform: ["translateX(-10px) scale(1)", "translateX(0px) scale(1)"],
      },
      expect.any(Object),
    );
  });

  it("keeps crossfades paintable on both sides of the commit", async () => {
    const pane = mountLibraryPane();
    const update = vi.fn(() => {
      expect(consumePendingPageEntrance(pane)).toBe(true);
    });

    await transitionCodaView(update, "page-crossfade");

    expect(motionMocks.animate).toHaveBeenNthCalledWith(
      1,
      pane,
      { opacity: [1, 0.94] },
      expect.any(Object),
    );
    expect(motionMocks.animate).toHaveBeenNthCalledWith(
      2,
      pane,
      {
        opacity: [0.94, 1],
        transform: ["translateX(0px) scale(1)", "translateX(0px) scale(1)"],
      },
      expect.any(Object),
    );
  });

  it("cancels stale page motion while newer navigation takes ownership", async () => {
    const pane = mountLibraryPane();
    const firstFinished = deferred();
    const stopFirst = vi.fn(firstFinished.resolve);
    motionMocks.animate
      .mockImplementationOnce(() => ({
        finished: firstFinished.promise,
        stop: stopFirst,
      }))
      .mockImplementation(() => ({
        finished: Promise.resolve(),
        stop: vi.fn(),
      }));
    const firstUpdate = vi.fn();
    const secondUpdate = vi.fn(() => {
      consumePendingPageEntrance(pane);
    });

    const first = transitionCodaView(firstUpdate, "page-forward");
    const second = transitionCodaView(secondUpdate, "page-back");

    await Promise.all([first, second]);
    expect(stopFirst).toHaveBeenCalledOnce();
    expect(firstUpdate).toHaveBeenCalledOnce();
    expect(secondUpdate).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("bypasses both motion systems when reduced motion is requested", async () => {
    mountLibraryPane();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    const { startViewTransition } = installNativeTransition();
    const update = vi.fn();

    await transitionCodaView(update, "page-forward");

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(false);
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(motionMocks.animate).not.toHaveBeenCalled();
  });
});
