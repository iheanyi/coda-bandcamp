import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const motionMocks = vi.hoisted(() => ({
  animateView: vi.fn(),
}));

vi.mock("motion", () => ({
  animateView: motionMocks.animateView,
}));

import {
  transitionCodaView,
  type CodaViewTransitionKind,
} from "./viewTransitions";

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  vi.stubEnv("VITE_CODA_MOTION_VIEW_TRANSITIONS", "0");
});

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function motionBuilder(
  options: { finished?: Promise<void>; reject?: unknown } = {},
) {
  const controls = {
    finished: options.finished ?? Promise.resolve(),
    stop: vi.fn(),
  };
  const builder = {
    add: vi.fn(),
    class: vi.fn(),
    controls,
    crop: vi.fn(),
    enter: vi.fn(),
    exit: vi.fn(),
    group: vi.fn(),
    layout: vi.fn(),
    new: vi.fn(),
    old: vi.fn(),
    then: vi.fn(),
  };
  for (const method of [
    "add",
    "class",
    "crop",
    "enter",
    "exit",
    "group",
    "layout",
    "new",
    "old",
  ] as const) {
    builder[method].mockReturnValue(builder);
  }
  builder.then.mockImplementation((resolve, reject) =>
    options.reject === undefined
      ? Promise.resolve(controls).then(resolve, reject)
      : Promise.reject(options.reject).then(resolve, reject),
  );
  return builder;
}

afterEach(() => {
  vi.useRealTimers();
  document.querySelector(".player__art-link")?.remove();
  document.querySelector(".album-detail__artwork")?.remove();
  document
    .querySelectorAll(
      [
        "[data-coda-artist-artwork-source]",
        "[data-coda-artist-name-source]",
        "[data-coda-artist-name-detail]",
        "[data-coda-album-artwork-detail]",
        "[data-coda-album-artwork-return]",
        "[data-coda-album-title-source]",
        "[data-coda-album-title-detail]",
        "[data-coda-discover-artwork-source]",
        "[data-coda-discover-artwork-detail]",
        "[data-coda-discover-artwork-return]",
        "[data-coda-discover-title-source]",
        "[data-coda-discover-title-detail]",
        "[data-coda-discover-title-return]",
        "[data-coda-playlist-identity-source]",
        "[data-coda-playlist-identity-detail]",
        "[data-coda-playlist-title-source]",
        "[data-coda-playlist-title-detail]",
        "[data-coda-playlist-title-return]",
        "[data-coda-radio-artwork-source]",
        "[data-coda-radio-artwork-detail]",
        "[data-coda-radio-title-source]",
        "[data-coda-radio-title-detail]",
        "[data-coda-radio-title-return]",
        "[data-coda-now-playing-title-compact]",
        "[data-coda-now-playing-title-detail]",
      ].join(","),
    )
    .forEach((element) => element.remove());
  document.documentElement.classList.remove(
    "coda-view-transitioning",
    "coda-view-transitions-supported",
    "coda-transition--album-detail",
    "coda-transition--artist-detail",
    "coda-transition--discover-detail",
    "coda-transition--discover-detail-close",
    "coda-transition--playlist-detail",
    "coda-transition--playlist-detail-close",
    "coda-transition--radio-detail",
    "coda-transition--radio-detail-close",
    "coda-transition--now-playing-open",
    "coda-transition--now-playing-close",
    "coda-transition--page-forward",
    "coda-transition--page-back",
    "coda-transition--page-crossfade",
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
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
  vi.unstubAllEnvs();
  motionMocks.animateView.mockReset();
});

describe("transitionCodaView", () => {
  it("updates immediately when the View Transitions API is unavailable", async () => {
    const update = vi.fn();

    await transitionCodaView(update, "page-forward");

    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("keeps the destination snapshot pending until an async route commit finishes", async () => {
    const routeCommit = deferred();
    const destinationSnapshot = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const updateCallbackDone =
          Promise.resolve(update()).then(destinationSnapshot);
        return { finished: updateCallbackDone, updateCallbackDone };
      }),
    });

    const transition = transitionCodaView(
      () => routeCommit.promise,
      "page-forward",
    );

    expect(destinationSnapshot).not.toHaveBeenCalled();
    routeCommit.resolve();
    await transition;
    expect(destinationSnapshot).toHaveBeenCalledOnce();
  });

  it("excludes a root-owned shared source that remains mounted in the incoming snapshot", async () => {
    const source = document.createElement("a");
    source.className = "player__art-link";
    document.body.append(source);
    const transitionFinished = deferred();
    const incomingSnapshot = vi.fn();
    let incomingName = "";
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          incomingName = source.style.getPropertyValue("view-transition-name");
          incomingSnapshot();
        });
        return {
          finished: Promise.all([
            updateCallbackDone,
            transitionFinished.promise,
          ]).then(() => undefined),
          updateCallbackDone,
        };
      }),
    });

    const transition = transitionCodaView(
      () => Promise.resolve(),
      "now-playing-open",
    );

    await vi.waitFor(() => expect(incomingSnapshot).toHaveBeenCalledOnce());
    expect(incomingName).toBe("none");
    transitionFinished.resolve();
    await transition;
    expect(source.style.getPropertyValue("view-transition-name")).toBe("");
  });

  it("exposes every transition kind while the browser captures and cleans it afterward", async () => {
    const capturedClasses: string[] = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        capturedClasses.push(document.documentElement.className);
        update();
        return { finished: Promise.resolve() };
      }),
    });

    const cases: Array<[CodaViewTransitionKind, string]> = [
      ["album-detail", "coda-transition--album-detail"],
      ["artist-detail", "coda-transition--artist-detail"],
      ["discover-detail", "coda-transition--discover-detail"],
      ["discover-detail-close", "coda-transition--discover-detail-close"],
      ["playlist-detail", "coda-transition--playlist-detail"],
      ["playlist-detail-close", "coda-transition--playlist-detail-close"],
      ["radio-detail", "coda-transition--radio-detail"],
      ["radio-detail-close", "coda-transition--radio-detail-close"],
      ["now-playing-open", "coda-transition--now-playing-open"],
      ["now-playing-close", "coda-transition--now-playing-close"],
      ["page-forward", "coda-transition--page-forward"],
      ["page-back", "coda-transition--page-back"],
      ["page-crossfade", "coda-transition--page-crossfade"],
    ];
    for (const [kind, className] of cases) {
      await transitionCodaView(vi.fn(), kind);

      expect(capturedClasses.at(-1)).toContain(className);
      expect(document.documentElement).toHaveClass(
        "coda-view-transitions-supported",
      );
      expect(document.documentElement).not.toHaveClass(className);
    }
  });

  it("captures a directional Back snapshot unless the caller explicitly opts out", async () => {
    const startViewTransition = vi.fn((update: () => void) => {
      update();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-back");

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).toHaveBeenCalledOnce();
  });

  it("bypasses automatic motion when reduced motion is requested", async () => {
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-crossfade");

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it("keeps only the newest transition active during rapid navigation", async () => {
    const first = deferred();
    const second = deferred();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        update();
        return {
          finished: document.documentElement.classList.contains(
            "coda-transition--page-forward",
          )
            ? first.promise
            : second.promise,
        };
      }),
    });

    const firstTransition = transitionCodaView(vi.fn(), "page-forward");
    const secondTransition = transitionCodaView(vi.fn(), "page-crossfade");

    expect(document.documentElement).not.toHaveClass(
      "coda-transition--page-forward",
    );
    expect(document.documentElement).toHaveClass(
      "coda-view-transitioning",
      "coda-transition--page-crossfade",
    );

    first.resolve();
    await firstTransition;

    expect(document.documentElement).toHaveClass(
      "coda-view-transitioning",
      "coda-transition--page-crossfade",
    );

    second.resolve();
    await secondTransition;

    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitioning",
      "coda-transition--page-crossfade",
    );
  });

  it("commits once and clears support when browser lifecycle promises reject", async () => {
    const cases = [
      {
        lifecycle: "ready",
        kind: "page-forward",
        className: "coda-transition--page-forward",
        cause: new DOMException("Snapshot failed", "InvalidStateError"),
      },
      {
        lifecycle: "updateCallbackDone",
        kind: "page-crossfade",
        className: "coda-transition--page-crossfade",
        cause: new Error("Update callback failed"),
      },
    ] as const;

    for (const { lifecycle, kind, className, cause } of cases) {
      const rejectedLifecycle = deferred();
      const finished = deferred();
      const update = vi.fn();
      let capturedUpdate: (() => void) | undefined;
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: vi.fn((nextUpdate: () => void) => {
          capturedUpdate = nextUpdate;
          return {
            finished: finished.promise,
            ready:
              lifecycle === "ready"
                ? rejectedLifecycle.promise
                : Promise.resolve(),
            updateCallbackDone:
              lifecycle === "updateCallbackDone"
                ? rejectedLifecycle.promise
                : Promise.resolve(),
          };
        }),
      });

      const activeTransition = transitionCodaView(update, kind);
      expect(document.documentElement).toHaveClass(
        "coda-view-transitions-supported",
        "coda-view-transitioning",
        className,
      );

      rejectedLifecycle.reject(cause);
      await vi.waitFor(() => {
        expect(update).toHaveBeenCalledOnce();
        expect(document.documentElement).not.toHaveClass(
          "coda-view-transitions-supported",
          "coda-view-transitioning",
          className,
        );
      });

      capturedUpdate?.();
      expect(update).toHaveBeenCalledOnce();

      finished.resolve();
      await activeTransition;
    }
  });

  it("does not let a superseded readiness failure clear the newest transition", async () => {
    const firstReady = deferred();
    const secondReady = deferred();
    const firstFinished = deferred();
    const secondFinished = deferred();
    const transitions = [
      { finished: firstFinished, ready: firstReady },
      { finished: secondFinished, ready: secondReady },
    ];
    const skipTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        const transition = transitions.shift()!;
        update();
        return {
          finished: transition.finished.promise,
          ready: transition.ready.promise,
          updateCallbackDone: Promise.resolve(),
          skipTransition,
        };
      }),
    });

    const firstTransition = transitionCodaView(vi.fn(), "page-forward");
    const secondTransition = transitionCodaView(vi.fn(), "page-crossfade");

    firstReady.reject(new DOMException("Skipped", "AbortError"));
    await Promise.resolve();

    expect(skipTransition).toHaveBeenCalledOnce();
    expect(document.documentElement).toHaveClass(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
      "coda-transition--page-crossfade",
    );

    firstFinished.resolve();
    secondReady.resolve();
    secondFinished.resolve();
    await Promise.all([firstTransition, secondTransition]);
  });

  it("ignores a superseded transition update that arrives late", async () => {
    const callbacks: Array<() => void> = [];
    const transitions = [deferred(), deferred()];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        const transition = transitions[callbacks.length];
        callbacks.push(update);
        return { finished: transition.promise };
      }),
    });
    const firstUpdate = vi.fn();
    const secondUpdate = vi.fn();

    const firstTransition = transitionCodaView(firstUpdate, "page-forward");
    const secondTransition = transitionCodaView(secondUpdate, "page-crossfade");

    callbacks[1]();
    callbacks[0]();

    expect(secondUpdate).toHaveBeenCalledOnce();
    expect(firstUpdate).not.toHaveBeenCalled();

    transitions[0].resolve();
    transitions[1].resolve();
    await Promise.all([firstTransition, secondTransition]);
  });

  it("cancels an active snapshot before immediate navigation", async () => {
    const active = deferred();
    const skipTransition = vi.fn(() => active.resolve());
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        update();
        return { finished: active.promise, skipTransition };
      }),
    });
    const immediateUpdate = vi.fn();

    const activeTransition = transitionCodaView(vi.fn(), "page-forward");
    await transitionCodaView(immediateUpdate, "page-crossfade", {
      skipSnapshot: true,
    });

    expect(immediateUpdate).toHaveBeenCalledOnce();
    expect(skipTransition).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitioning",
      "coda-transition--page-forward",
    );

    await activeTransition;
  });

  it("skips a stalled native snapshot and restores surviving live content", async () => {
    vi.useFakeTimers();
    const source = document.createElement("a");
    source.className = "player__art-link";
    document.body.append(source);
    const skipTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const updateCallbackDone = Promise.resolve(update());
        return {
          finished: new Promise<void>(() => undefined),
          skipTransition,
          updateCallbackDone,
        };
      }),
    });

    const transition = transitionCodaView(vi.fn(), "now-playing-open");
    await Promise.resolve();
    await Promise.resolve();
    expect(source.style.viewTransitionName).toBe("none");

    await vi.advanceTimersByTimeAsync(2_499);
    expect(skipTransition).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await transition;

    expect(skipTransition).toHaveBeenCalledOnce();
    expect(source.style.viewTransitionName).toBe("");
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("commits once if the platform never invokes its update callback", async () => {
    vi.useFakeTimers();
    const skipTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(() => ({
        finished: new Promise<void>(() => undefined),
        skipTransition,
      })),
    });
    const update = vi.fn();

    const transition = transitionCodaView(update, "page-forward");
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_500);
    await transition;

    expect(skipTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("does not suppress surviving content after a timed-out update settles late", async () => {
    vi.useFakeTimers();
    const update = deferred();
    const source = document.createElement("a");
    source.className = "player__art-link";
    document.body.append(source);
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((commit: () => void | Promise<void>) => ({
        finished: new Promise<void>(() => undefined),
        skipTransition: vi.fn(),
        updateCallbackDone: Promise.resolve(commit()),
      })),
    });

    const transition = transitionCodaView(
      () => update.promise,
      "now-playing-open",
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_500);
    await transition;

    expect(source.style.viewTransitionName).toBe("");
    update.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(source.style.viewTransitionName).toBe("");
  });
});

describe("transitionCodaView with Motion view transitions", () => {
  function enableMotionViewTransitions() {
    vi.stubEnv("VITE_CODA_MOTION_VIEW_TRANSITIONS", "1");
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(),
    });
  }

  it("uses Motion to animate only the page pane with forward direction", async () => {
    enableMotionViewTransitions();
    const builder = motionBuilder();
    let transitionClasses = "";
    motionMocks.animateView.mockImplementation((update: () => void) => {
      transitionClasses = document.documentElement.className;
      update();
      return builder;
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-forward");

    expect(update).toHaveBeenCalledOnce();
    expect(motionMocks.animateView).toHaveBeenCalledWith(expect.any(Function), {
      interrupt: "wait",
    });
    expect(transitionClasses).toContain("coda-view-transitioning");
    expect(transitionClasses).not.toContain("coda-transition--page-forward");
    expect(builder.add).toHaveBeenCalledWith(".library-pane");
    expect(builder.group).toHaveBeenCalledWith(false);
    expect(builder.old).toHaveBeenCalledWith(
      {
        opacity: 0,
        transform: "translateX(-6px)",
      },
      expect.objectContaining({ duration: 0.12 }),
    );
    expect(builder.new).toHaveBeenCalledWith(
      {
        opacity: [0, 1],
        transform: ["translateX(10px)", "translateX(0px)"],
      },
      expect.objectContaining({ delay: 0.015, duration: 0.18 }),
    );
    expect(document.documentElement).toHaveClass(
      "coda-view-transitions-supported",
    );
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("releases a stalled platform snapshot without leaking transition ownership", async () => {
    vi.useFakeTimers();
    enableMotionViewTransitions();
    const neverFinishes = new Promise<void>(() => undefined);
    const builder = motionBuilder({ finished: neverFinishes });
    const source = document.createElement("span");
    source.dataset.codaArtistNameSource = "artist-stalled";
    source.dataset.codaArtistNameTarget = "artist-stalled";
    document.body.append(source);
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    let settled = false;
    const transition = transitionCodaView(vi.fn(), "artist-detail").then(() => {
      settled = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(source.style.viewTransitionName).toBe("");
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_499);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await transition;
    expect(settled).toBe(true);
    expect(builder.controls.stop).toHaveBeenCalledOnce();
    expect(source.style.viewTransitionName).toBe("");
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("commits navigation if Motion never produces animation controls", async () => {
    vi.useFakeTimers();
    enableMotionViewTransitions();
    const builder = motionBuilder();
    builder.then.mockImplementation(() => undefined);
    motionMocks.animateView.mockReturnValue(builder);
    const update = vi.fn();

    let settled = false;
    const transition = transitionCodaView(update, "album-detail").then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(update).not.toHaveBeenCalled();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await transition;

    expect(update).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("releases visual ownership when Motion and the fallback commit both stall", async () => {
    vi.useFakeTimers();
    enableMotionViewTransitions();
    const builder = motionBuilder();
    builder.then.mockImplementation(() => undefined);
    motionMocks.animateView.mockReturnValue(builder);
    const update = vi.fn(() => new Promise<void>(() => undefined));

    let settled = false;
    const transition = transitionCodaView(update, "album-detail").then(() => {
      settled = true;
    });
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5_000);
    await transition;

    expect(update).toHaveBeenCalledOnce();
    expect(settled).toBe(true);
    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
    );
  });

  it("uses the reverse direction for Back navigation", async () => {
    enableMotionViewTransitions();
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-back");

    expect(update).toHaveBeenCalledOnce();
    expect(builder.add).toHaveBeenCalledWith(".library-pane");
    expect(builder.old).toHaveBeenCalledWith(
      {
        opacity: 0,
        transform: "translateX(6px)",
      },
      expect.objectContaining({ duration: 0.12 }),
    );
    expect(builder.new).toHaveBeenCalledWith(
      {
        opacity: [0, 1],
        transform: ["translateX(-10px)", "translateX(0px)"],
      },
      expect.objectContaining({ delay: 0.015, duration: 0.18 }),
    );
  });

  it("passes an async route commit through Motion before the new snapshot", async () => {
    enableMotionViewTransitions();
    const routeCommit = deferred();
    const builder = motionBuilder();
    let capturedCommit: void | Promise<void>;
    motionMocks.animateView.mockImplementation(
      (update: () => void | Promise<void>) => {
        capturedCommit = update();
        return builder;
      },
    );

    const transition = transitionCodaView(
      () => routeCommit.promise,
      "page-forward",
    );

    let commitSettled = false;
    void capturedCommit!.then(() => {
      commitSettled = true;
    });
    await Promise.resolve();
    expect(commitSettled).toBe(false);
    routeCommit.resolve();
    await Promise.all([capturedCommit!, transition]);
    expect(commitSettled).toBe(true);
  });

  it("waits for remounted shared artwork to decode before the new snapshot", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("div");
    source.dataset.codaAlbumArtworkDetail = "album-1";
    source.append(document.createElement("img"));
    document.body.append(source);
    const imageMounted = deferred();
    const imageDecoded = deferred();
    const builder = motionBuilder();
    let capturedCommit: void | Promise<void>;
    motionMocks.animateView.mockImplementation(
      (update: () => void | Promise<void>) => {
        capturedCommit = update();
        return builder;
      },
    );

    const transition = transitionCodaView(() => {
      const destination = document.createElement("div");
      destination.dataset.codaAlbumArtworkReturn = "album-1";
      const image = document.createElement("img");
      image.decode = vi.fn(() => imageDecoded.promise);
      document.body.append(destination);
      void imageMounted.promise.then(() => destination.append(image));
    }, "album-detail-close");

    let commitSettled = false;
    void capturedCommit!.then(() => {
      commitSettled = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(commitSettled).toBe(false);

    imageMounted.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(commitSettled).toBe(false);

    imageDecoded.resolve();
    await Promise.all([capturedCommit!, transition]);
    expect(commitSettled).toBe(true);
    document.querySelector("[data-coda-album-artwork-return]")?.remove();
  });

  it("uses a quick dissolve for major destination changes", async () => {
    enableMotionViewTransitions();
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "page-crossfade");

    expect(builder.old).toHaveBeenCalledWith(
      { opacity: 0 },
      expect.objectContaining({ duration: 0.12 }),
    );
    expect(builder.new).toHaveBeenCalledWith(
      { opacity: [0, 1] },
      expect.objectContaining({ duration: 0.18 }),
    );
  });

  it("pairs compact and full artwork while leaving the ephemeral name to Motion", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("button");
    source.id = "compact-cover";
    source.className = "player__art-link";
    source.dataset.codaTrackId = "track-1";
    document.body.append(source);
    const builder = motionBuilder();
    let capturedName = "";
    motionMocks.animateView.mockImplementation((update: () => void) => {
      capturedName = source.style.getPropertyValue("view-transition-name");
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "now-playing-open");

    expect(builder.add).toHaveBeenCalledWith(
      source,
      '.now-playing__artwork[data-coda-track-id="track-1"]',
    );
    expect(capturedName).toBe("");
    expect(source.style.getPropertyValue("view-transition-name")).toBe("");
    expect(builder.class).toHaveBeenCalledWith("coda-motion-shared-artwork");
    expect(builder.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spring",
        visualDuration: 0.46,
        bounce: 0.08,
      }),
    );
    expect(builder.new).not.toHaveBeenCalled();
    expect(builder.old).toHaveBeenCalledWith(
      {
        opacity: 0,
        transform: "translateY(6px)",
      },
      expect.objectContaining({ duration: 0.14 }),
    );
  });

  it("does not expose a long artist key through an author transition name", async () => {
    enableMotionViewTransitions();
    const artistKey = "a".repeat(1_024);
    const source = document.createElement("span");
    source.dataset.codaArtistNameSource = artistKey;
    source.dataset.codaArtistNameTarget = artistKey;
    document.body.append(source);
    const builder = motionBuilder();
    let capturedName = "";
    motionMocks.animateView.mockImplementation((update: () => void) => {
      capturedName = source.style.getPropertyValue("view-transition-name");
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "artist-detail");

    expect(capturedName).toBe("");
    expect(builder.add).toHaveBeenCalledWith(
      source,
      "[data-coda-artist-name-detail]",
    );
    expect(source.style.getPropertyValue("view-transition-name")).toBe("");
  });

  it.each([
    [
      "discover-detail",
      "data-coda-discover-artwork-source",
      "[data-coda-discover-artwork-detail]",
      "coda-motion-shared-artwork",
    ],
    [
      "discover-detail-close",
      "data-coda-discover-artwork-detail",
      "[data-coda-discover-artwork-return]",
      "coda-motion-shared-artwork",
    ],
    [
      "radio-detail",
      "data-coda-radio-artwork-source",
      "[data-coda-radio-artwork-detail]",
      "coda-motion-shared-artwork",
    ],
    [
      "radio-detail-close",
      "data-coda-radio-artwork-detail",
      "[data-coda-radio-artwork-return]",
      "coda-motion-shared-artwork",
    ],
    [
      "playlist-detail",
      "data-coda-playlist-identity-source",
      "[data-coda-playlist-identity-detail]",
      "coda-motion-shared-identity",
    ],
    [
      "playlist-detail-close",
      "data-coda-playlist-identity-detail",
      "[data-coda-playlist-identity-return]",
      "coda-motion-shared-identity",
    ],
  ] as const)(
    "pairs stable identity layers for %s",
    async (kind, sourceAttribute, destination, transitionClass) => {
      enableMotionViewTransitions();
      const source = document.createElement("div");
      source.setAttribute(sourceAttribute, "");
      document.body.append(source);
      const builder = motionBuilder();
      motionMocks.animateView.mockImplementation((update: () => void) => {
        update();
        return builder;
      });

      await transitionCodaView(vi.fn(), kind);

      expect(builder.add).toHaveBeenCalledWith(source, destination);
      expect(builder.class).toHaveBeenCalledWith(transitionClass);
      expect(builder.layout).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "spring",
          bounce:
            transitionClass === "coda-motion-shared-artwork" ? 0.08 : 0.04,
        }),
      );
    },
  );

  it("pairs the persistent Discover source by validated identity without author names", async () => {
    enableMotionViewTransitions();
    const sourceArtwork = document.createElement("div");
    sourceArtwork.dataset.codaDiscoverArtworkSource = "";
    sourceArtwork.dataset.codaDiscoverArtwork = 'discover:release-"one"';
    const sourceTitle = document.createElement("span");
    sourceTitle.dataset.codaDiscoverTitleSource = "";
    sourceTitle.dataset.codaDiscoverTitle = 'discover:release-"one"';
    document.body.append(sourceArtwork, sourceTitle);
    const builder = motionBuilder();
    const capturedNames: string[][] = [];
    motionMocks.animateView.mockImplementation((update: () => void) => {
      capturedNames.push([
        sourceArtwork.style.getPropertyValue("view-transition-name"),
        sourceTitle.style.getPropertyValue("view-transition-name"),
      ]);
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "discover-detail");
    await transitionCodaView(vi.fn(), "discover-detail");

    expect(builder.add).toHaveBeenCalledWith(
      sourceArtwork,
      '[data-coda-discover-artwork-detail="discover:release-\\"one\\""]',
    );
    expect(builder.add).toHaveBeenCalledWith(
      sourceTitle,
      '[data-coda-discover-title-detail="discover:release-\\"one\\""]',
    );
    expect(capturedNames).toEqual([
      ["", ""],
      ["", ""],
    ]);
    expect(sourceArtwork.style.getPropertyValue("view-transition-name")).toBe(
      "",
    );
    expect(sourceTitle.style.getPropertyValue("view-transition-name")).toBe("");
  });

  it("pairs Discover detail artwork and title back to one validated release", async () => {
    enableMotionViewTransitions();
    const releaseId = 'discover:release-"one"';
    const detailArtwork = document.createElement("div");
    detailArtwork.dataset.codaDiscoverArtworkDetail = releaseId;
    const detailTitle = document.createElement("span");
    detailTitle.dataset.codaDiscoverTitleDetail = releaseId;
    document.body.append(detailArtwork, detailTitle);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "discover-detail-close");

    expect(builder.add).toHaveBeenCalledWith(
      detailArtwork,
      '[data-coda-discover-artwork-return="discover:release-\\"one\\""]',
    );
    expect(builder.add).toHaveBeenCalledWith(
      detailTitle,
      '[data-coda-discover-title-return="discover:release-\\"one\\""]',
    );
    expect(builder.class).toHaveBeenCalledWith("coda-motion-shared-artwork");
    expect(builder.class).toHaveBeenCalledWith("coda-motion-shared-title");
    expect(builder.add).not.toHaveBeenCalledWith(".library-pane");
  });

  it("resolves a superseded transition against the latest validated identity", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("div");
    source.dataset.codaDiscoverArtworkSource = "";
    source.dataset.codaDiscoverArtwork = "discover:first";
    document.body.append(source);
    const firstFinished = deferred();
    const secondFinished = deferred();
    const firstBuilder = motionBuilder({ finished: firstFinished.promise });
    const secondBuilder = motionBuilder({ finished: secondFinished.promise });
    const builders = [firstBuilder, secondBuilder];
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builders.shift()!;
    });

    const first = transitionCodaView(vi.fn(), "discover-detail");
    source.dataset.codaDiscoverArtwork = "discover:second";
    const second = transitionCodaView(vi.fn(), "discover-detail");

    expect(firstBuilder.add).toHaveBeenCalledWith(
      source,
      '[data-coda-discover-artwork-detail="discover:first"]',
    );
    expect(secondBuilder.add).toHaveBeenCalledWith(
      source,
      '[data-coda-discover-artwork-detail="discover:second"]',
    );
    firstFinished.resolve();
    await first;
    expect(document.documentElement).toHaveClass("coda-view-transitioning");
    secondFinished.resolve();
    await second;
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
    expect(source.style.getPropertyValue("view-transition-name")).toBe("");
  });

  it("does not let superseded cleanup end the current transition lifecycle", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("div");
    source.dataset.codaDiscoverArtworkSource = "";
    source.dataset.codaDiscoverArtwork = "discover:same-release";
    document.body.append(source);
    const firstFinished = deferred();
    const secondFinished = deferred();
    const builders = [
      motionBuilder({ finished: firstFinished.promise }),
      motionBuilder({ finished: secondFinished.promise }),
    ];
    const capturedNames: string[] = [];
    motionMocks.animateView.mockImplementation((update: () => void) => {
      capturedNames.push(source.style.getPropertyValue("view-transition-name"));
      update();
      return builders.shift()!;
    });

    const first = transitionCodaView(vi.fn(), "discover-detail");
    const second = transitionCodaView(vi.fn(), "discover-detail");

    expect(capturedNames).toEqual(["", ""]);
    firstFinished.resolve();
    await first;
    expect(source.style.getPropertyValue("view-transition-name")).toBe(
      capturedNames[1],
    );
    secondFinished.resolve();
    await second;
    expect(source.style.getPropertyValue("view-transition-name")).toBe("");
  });

  it.each([
    [
      "album-detail",
      "data-coda-album-title-source",
      "[data-coda-album-title-detail]",
    ],
    [
      "album-detail-close",
      "data-coda-album-title-detail",
      "[data-coda-album-title-return]",
    ],
    [
      "artist-detail",
      "data-coda-artist-name-source",
      "[data-coda-artist-name-detail]",
    ],
    [
      "artist-detail-close",
      "data-coda-artist-name-detail",
      "[data-coda-artist-name-return]",
    ],
    [
      "discover-detail",
      "data-coda-discover-title-source",
      "[data-coda-discover-title-detail]",
    ],
    [
      "discover-detail-close",
      "data-coda-discover-title-detail",
      "[data-coda-discover-title-return]",
    ],
    [
      "radio-detail",
      "data-coda-radio-title-source",
      "[data-coda-radio-title-detail]",
    ],
    [
      "radio-detail-close",
      "data-coda-radio-title-detail",
      "[data-coda-radio-title-return]",
    ],
    [
      "playlist-detail",
      "data-coda-playlist-title-source",
      "[data-coda-playlist-title-detail]",
    ],
    [
      "playlist-detail-close",
      "data-coda-playlist-title-detail",
      "[data-coda-playlist-title-return]",
    ],
    [
      "now-playing-open",
      "data-coda-now-playing-title-compact",
      "[data-coda-now-playing-title-detail]",
    ],
    [
      "now-playing-close",
      "data-coda-now-playing-title-detail",
      "[data-coda-now-playing-title-compact]",
    ],
  ] as const)(
    "pairs the identity title separately for %s",
    async (kind, sourceAttribute, destination) => {
      enableMotionViewTransitions();
      const source = document.createElement("span");
      source.setAttribute(sourceAttribute, "");
      document.body.append(source);
      const builder = motionBuilder();
      motionMocks.animateView.mockImplementation((update: () => void) => {
        update();
        return builder;
      });

      await transitionCodaView(vi.fn(), kind);

      expect(builder.add).toHaveBeenCalledWith(source, destination);
      expect(builder.class).toHaveBeenCalledWith("coda-motion-shared-title");
      expect(builder.group).toHaveBeenCalledWith(false);
      expect(builder.crop).toHaveBeenCalledWith(false);
      expect(builder.layout).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "spring",
          visualDuration: 0.44,
          bounce: 0,
        }),
      );
      expect(builder.old).toHaveBeenCalledWith(
        { opacity: [1, 0] },
        expect.objectContaining({
          duration: 0.2,
          ease: "linear",
        }),
      );
      expect(builder.new).toHaveBeenCalledWith(
        { opacity: [0, 1] },
        expect.objectContaining({
          duration: 0.2,
          ease: "linear",
        }),
      );
    },
  );

  it.each([
    ["album-detail", "[data-coda-album-detail-surface]"],
    ["artist-detail", "[data-coda-artist-detail-surface]"],
    ["discover-detail", "[data-coda-discover-detail-surface]"],
    ["radio-detail", "[data-coda-radio-detail-surface]"],
    ["playlist-detail", "[data-coda-playlist-detail-surface]"],
  ] as const)(
    "keeps the incoming detail surface opaque for %s",
    async (kind, selector) => {
      enableMotionViewTransitions();
      const builder = motionBuilder();
      motionMocks.animateView.mockImplementation((update: () => void) => {
        update();
        return builder;
      });

      await transitionCodaView(vi.fn(), kind);

      expect(builder.add).toHaveBeenCalledWith(selector);
      expect(builder.class).toHaveBeenCalledWith("coda-motion-detail-surface");
      expect(builder.group).toHaveBeenCalledWith(false);
      expect(builder.enter).toHaveBeenCalledWith(
        {
          transform: ["translateY(8px)", "translateY(0px)"],
        },
        expect.objectContaining({
          duration: 0.3,
          ease: [0.22, 1, 0.36, 1],
        }),
      );
    },
  );

  it("pairs artist artwork for the forward drill-in", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("div");
    source.dataset.codaArtistArtworkSource = "";
    const cover = document.createElement("div");
    cover.dataset.slot = "cover";
    source.append(cover);
    document.body.append(source);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "artist-detail");

    expect(builder.add).toHaveBeenCalledWith(
      cover,
      ":is([data-coda-artist-artwork-detail][data-slot='cover'], [data-coda-artist-artwork-detail] [data-slot='cover'])",
    );
    expect(builder.class).toHaveBeenCalledWith("coda-motion-shared-artwork");
    expect(builder.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spring",
        visualDuration: 0.46,
        bounce: 0.08,
      }),
    );
  });

  it("pairs album artwork back to its exact return target", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("div");
    source.dataset.codaAlbumArtworkDetail = "album-1";
    source.dataset.slot = "cover";
    document.body.append(source);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "album-detail-close");

    expect(builder.add).toHaveBeenCalledWith(
      source,
      '[data-coda-album-artwork-return="album-1"]',
    );
    expect(builder.class).toHaveBeenCalledWith("coda-motion-shared-artwork");
    expect(builder.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spring",
        visualDuration: 0.46,
        bounce: 0.08,
      }),
    );
  });

  it("pairs artist artwork back to its exact return target", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("div");
    source.dataset.codaArtistArtworkDetail = "night-archive";
    source.dataset.slot = "cover";
    document.body.append(source);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "artist-detail-close");

    expect(builder.add).toHaveBeenCalledWith(
      source,
      '[data-coda-artist-artwork-return="night-archive"]',
    );
    expect(builder.class).toHaveBeenCalledWith("coda-motion-shared-artwork");
    expect(builder.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "spring",
        visualDuration: 0.46,
        bounce: 0.08,
      }),
    );
  });

  it("commits without Motion when reduced motion is requested", async () => {
    enableMotionViewTransitions();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-back");

    expect(update).toHaveBeenCalledOnce();
    expect(motionMocks.animateView).not.toHaveBeenCalled();
  });

  it("falls back to the requested state when Motion cannot start", async () => {
    enableMotionViewTransitions();
    motionMocks.animateView.mockReturnValue(
      motionBuilder({ reject: new DOMException("Snapshot failed") }),
    );
    let supportEnabledDuringFallback = true;
    const update = vi.fn(() => {
      supportEnabledDuringFallback =
        document.documentElement.classList.contains(
          "coda-view-transitions-supported",
        );
    });

    await transitionCodaView(update, "page-crossfade");

    expect(update).toHaveBeenCalledOnce();
    expect(supportEnabledDuringFallback).toBe(false);
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("restores shared names and commits once when Motion throws synchronously", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("button");
    source.className = "player__art-link";
    source.dataset.codaTrackId = "track-throw";
    document.body.append(source);
    motionMocks.animateView.mockImplementation(() => {
      throw new DOMException("Motion failed", "InvalidStateError");
    });
    const update = vi.fn();

    await transitionCodaView(update, "now-playing-open");

    expect(update).toHaveBeenCalledOnce();
    expect(source.style.getPropertyValue("view-transition-name")).toBe("");
    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
    );
  });
});
