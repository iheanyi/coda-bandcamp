import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const motionMocks = vi.hoisted(() => ({
  animate: vi.fn(),
  animateView: vi.fn(),
  spring: vi.fn(),
}));

vi.mock("motion", () => ({
  animate: motionMocks.animate,
  animateView: motionMocks.animateView,
  spring: motionMocks.spring,
}));

import {
  transitionCodaView,
  type CodaViewTransitionKind,
} from "./viewTransitions";
import { supersedeMotionViewTransition } from "./motionViewTransitions";
import {
  resetMotionProfileStoreForTests,
  selectMotionPreset,
} from "./motionProfileStore";

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);
const originalGetAnimations = Object.getOwnPropertyDescriptor(
  document,
  "getAnimations",
);
const originalActiveViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "activeViewTransition",
);
const originalMatchMedia = window.matchMedia;

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

beforeEach(() => {
  window.localStorage.clear();
  resetMotionProfileStoreForTests();
  motionMocks.animate.mockImplementation(() => ({
    finished: Promise.resolve(),
    stop: vi.fn(),
  }));
});

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
        "[data-coda-daily-artwork-source]",
        "[data-coda-daily-artwork-detail]",
        "[data-coda-daily-artwork-return]",
        "[data-coda-daily-title-source]",
        "[data-coda-daily-title-detail]",
        "[data-coda-daily-title-return]",
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
    "coda-transition--album-detail-close",
    "coda-transition--artist-detail",
    "coda-transition--artist-detail-close",
    "coda-transition--daily-detail",
    "coda-transition--daily-detail-close",
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
  if (originalGetAnimations) {
    Object.defineProperty(document, "getAnimations", originalGetAnimations);
  } else {
    Reflect.deleteProperty(document, "getAnimations");
  }
  if (originalActiveViewTransition) {
    Object.defineProperty(
      document,
      "activeViewTransition",
      originalActiveViewTransition,
    );
  } else {
    Reflect.deleteProperty(document, "activeViewTransition");
  }
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
  vi.unstubAllEnvs();
  motionMocks.animateView.mockReset();
  motionMocks.animate.mockReset();
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

  it("keeps the old pane live and animates the committed destination without a native snapshot", async () => {
    const pane = document.createElement("main");
    pane.className = "library-pane";
    document.body.append(pane);
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const routeCommit = deferred();
    const update = vi.fn((routerViewTransition?: boolean) => {
      expect(routerViewTransition).toBe(false);
      return routeCommit.promise;
    });

    const transition = transitionCodaView(update, "page-forward", {
      routerOwnedPage: true,
    });

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
    expect(motionMocks.animate).not.toHaveBeenCalled();
    routeCommit.resolve();
    await transition;
    expect(motionMocks.animate).toHaveBeenCalledOnce();
    expect(motionMocks.animate).toHaveBeenCalledWith(
      pane,
      expect.objectContaining({
        opacity: [0, 1],
        transform: [
          expect.stringMatching(/^translateX\(28px\)/),
          "translateX(0px) scale(1)",
        ],
      }),
      expect.objectContaining({ duration: 0.18, delay: 0 }),
    );
    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitioning",
      "coda-transition--page-forward",
    );
    expect(pane.style.opacity).toBe("");
    expect(pane.style.transform).toBe("");
    pane.remove();
  });

  it("animates router-owned Back in the reverse direction without a native snapshot", async () => {
    const pane = document.createElement("main");
    pane.className = "library-pane";
    document.body.append(pane);
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-back", { routerOwnedPage: true });

    expect(startViewTransition).not.toHaveBeenCalled();
    expect(motionMocks.animateView).not.toHaveBeenCalled();
    expect(motionMocks.animate).toHaveBeenCalledWith(
      pane,
      expect.objectContaining({
        opacity: [0, 1],
        transform: [
          expect.stringMatching(/^translateX\(-28px\)/),
          "translateX(0px) scale(1)",
        ],
      }),
      expect.objectContaining({ duration: 0.18, delay: 0 }),
    );
    pane.remove();
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
      ["daily-detail", "coda-transition--daily-detail"],
      ["discover-detail", "coda-transition--discover-detail"],
      ["playlist-detail", "coda-transition--playlist-detail"],
      ["radio-detail", "coda-transition--radio-detail"],
      ["now-playing-open", "coda-transition--now-playing-open"],
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

    await transitionCodaView(update, "page-crossfade", {
      routerOwnedPage: true,
    });

    expect(update).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(false);
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

  it("restores a persistent shared source after repeated supersession", async () => {
    const source = document.createElement("a");
    source.className = "player__art-link";
    source.style.setProperty("view-transition-name", "player-artwork");
    document.body.append(source);
    const transitions = Array.from({ length: 50 }, () => deferred());
    const skipTransitions = transitions.map(() => vi.fn());
    let transitionIndex = 0;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const index = transitionIndex;
        transitionIndex += 1;
        const updateCallbackDone = Promise.resolve(update());
        return {
          finished: Promise.all([
            updateCallbackDone,
            transitions[index]!.promise,
          ]).then(() => undefined),
          skipTransition: skipTransitions[index],
          updateCallbackDone,
        };
      }),
    });

    const updates = transitions.map(() => vi.fn());
    const activeTransitions: Promise<void>[] = [];
    for (let index = 0; index < transitions.length; index += 1) {
      activeTransitions.push(
        transitionCodaView(updates[index]!, "now-playing-open"),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(updates[index]).toHaveBeenCalledOnce();
      expect(source.style.viewTransitionName).toBe("none");
    }

    transitions.forEach((transition) => transition.resolve());
    await Promise.all(activeTransitions);

    skipTransitions
      .slice(0, -1)
      .forEach((skipTransition) =>
        expect(skipTransition).toHaveBeenCalledOnce(),
      );
    expect(skipTransitions.at(-1)).not.toHaveBeenCalled();
    expect(source.style.viewTransitionName).toBe("player-artwork");
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
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

  it("uses the native transition lifecycle without a timer fallback", async () => {
    vi.useFakeTimers();
    const finished = deferred();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => ({
        finished: Promise.resolve(update()).then(() => finished.promise),
        skipTransition: vi.fn(),
      })),
    });
    let settled = false;
    const transition = transitionCodaView(vi.fn(), "page-forward").then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(settled).toBe(false);

    finished.resolve();
    await transition;
    expect(settled).toBe(true);
  });
});

describe("transitionCodaView with Motion view transitions", () => {
  function enableMotionViewTransitions() {
    vi.stubEnv("MODE", "coda-dev");
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn(),
    });
  }

  function installNativePageTransition(
    onCapture: () => void = () => undefined,
  ) {
    const startViewTransition = vi.fn((update: () => void | Promise<void>) => {
      onCapture();
      const updateCallbackDone = Promise.resolve(update());
      return {
        finished: updateCallbackDone,
        ready: updateCallbackDone,
        skipTransition: vi.fn(),
        updateCallbackDone,
      };
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    return startViewTransition;
  }

  it("uses the native page lifecycle with the snapshotted forward profile", async () => {
    enableMotionViewTransitions();
    let transitionClasses = "";
    let oldX = "";
    let newX = "";
    let enterDuration = "";
    let totalDuration = "";
    installNativePageTransition(() => {
      transitionClasses = document.documentElement.className;
      oldX = document.documentElement.style.getPropertyValue(
        "--coda-motion-page-old-x",
      );
      newX = document.documentElement.style.getPropertyValue(
        "--coda-motion-page-new-x",
      );
      enterDuration = document.documentElement.style.getPropertyValue(
        "--coda-motion-page-enter-duration",
      );
      totalDuration = document.documentElement.style.getPropertyValue(
        "--coda-motion-page-total-duration",
      );
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-forward");

    expect(update).toHaveBeenCalledOnce();
    expect(motionMocks.animateView).not.toHaveBeenCalled();
    expect(transitionClasses).toContain("coda-view-transitioning");
    expect(transitionClasses).toContain("coda-transition--page-forward");
    expect(oldX).toBe("-6px");
    expect(newX).toBe("10px");
    expect(enterDuration).toBe("180ms");
    expect(totalDuration).toBe("195ms");
    expect(document.documentElement).toHaveClass(
      "coda-view-transitions-supported",
    );
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("skips the prior native page snapshot before starting the next page", async () => {
    enableMotionViewTransitions();
    const firstFinished = deferred();
    const skipFirst = vi.fn(() => firstFinished.resolve());
    let callCount = 0;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        callCount += 1;
        const updateCallbackDone = Promise.resolve(update());
        return {
          finished:
            callCount === 1 ? firstFinished.promise : updateCallbackDone,
          ready: updateCallbackDone,
          skipTransition: callCount === 1 ? skipFirst : vi.fn(),
          updateCallbackDone,
        };
      }),
    });

    const first = transitionCodaView(vi.fn(), "page-forward");
    await Promise.resolve();
    const second = transitionCodaView(vi.fn(), "page-crossfade");

    await Promise.all([first, second]);
    expect(skipFirst).toHaveBeenCalledOnce();
    expect(motionMocks.animateView).not.toHaveBeenCalled();
  });

  it("uses the reverse native profile values for Back navigation", async () => {
    enableMotionViewTransitions();
    let oldX = "";
    let newX = "";
    installNativePageTransition(() => {
      oldX = document.documentElement.style.getPropertyValue(
        "--coda-motion-page-old-x",
      );
      newX = document.documentElement.style.getPropertyValue(
        "--coda-motion-page-new-x",
      );
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-back");

    expect(update).toHaveBeenCalledOnce();
    expect(oldX).toBe("6px");
    expect(newX).toBe("-10px");
  });

  it("passes an async route commit through the native snapshot callback", async () => {
    enableMotionViewTransitions();
    const routeCommit = deferred();
    let capturedCommit: void | Promise<void>;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        capturedCommit = update();
        const updateCallbackDone = Promise.resolve(capturedCommit);
        return {
          finished: updateCallbackDone,
          ready: updateCallbackDone,
          updateCallbackDone,
        };
      }),
    });

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

  it.each([
    ["album-detail", "coda-transition--album-detail"],
    ["artist-detail", "coda-transition--artist-detail"],
    ["now-playing-open", "coda-transition--now-playing-open"],
  ] as const)(
    "applies %s on the document before Motion snapshots",
    async (kind, transitionClass) => {
      enableMotionViewTransitions();
      let classesDuringSnapshot = "";
      motionMocks.animateView.mockImplementation((update: () => void) => {
        classesDuringSnapshot = document.documentElement.className;
        update();
        return motionBuilder();
      });

      await transitionCodaView(vi.fn(), kind);

      expect(classesDuringSnapshot).toContain(transitionClass);
      expect(classesDuringSnapshot).toContain("coda-view-transitioning");
      expect(document.documentElement).not.toHaveClass(transitionClass);
      expect(document.documentElement).not.toHaveClass(
        "coda-view-transitioning",
      );
    },
  );

  it("uses the native crossfade class for major destination changes", async () => {
    enableMotionViewTransitions();
    let transitionClasses = "";
    let exitDuration = "";
    installNativePageTransition(() => {
      transitionClasses = document.documentElement.className;
      exitDuration = document.documentElement.style.getPropertyValue(
        "--coda-motion-page-exit-duration",
      );
    });

    await transitionCodaView(vi.fn(), "page-crossfade");

    expect(transitionClasses).toContain("coda-transition--page-crossfade");
    expect(exitDuration).toBe("120ms");
    expect(motionMocks.animateView).not.toHaveBeenCalled();
  });

  it("pairs compact and full artwork while leaving the ephemeral name to Motion", async () => {
    enableMotionViewTransitions();
    const staleMotionTarget = document.createElement("div");
    staleMotionTarget.style.setProperty(
      "view-transition-name",
      "motion-view-42",
    );
    staleMotionTarget.style.setProperty(
      "view-transition-class",
      "coda-motion-shared-artwork",
    );
    staleMotionTarget.style.setProperty("view-transition-group", "none");
    document.body.append(staleMotionTarget);
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

    expect(motionMocks.animateView).toHaveBeenCalledWith(expect.any(Function), {
      interrupt: "wait",
      type: motionMocks.spring,
      visualDuration: 0.38,
      bounce: 0.12,
    });
    expect(builder.add).toHaveBeenCalledWith(
      source,
      '.now-playing__artwork[data-coda-track-id="track-1"]',
    );
    expect(capturedName).toBe("");
    expect(source.style.getPropertyValue("view-transition-name")).toBe("");
    expect(
      staleMotionTarget.style.getPropertyValue("view-transition-name"),
    ).toBe("");
    expect(
      staleMotionTarget.style.getPropertyValue("view-transition-class"),
    ).toBe("");
    expect(
      staleMotionTarget.style.getPropertyValue("view-transition-group"),
    ).toBe("");
    expect(builder.class).toHaveBeenCalledWith("coda-motion-shared-artwork");
    expect(builder.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        type: motionMocks.spring,
        visualDuration: 0.38,
        bounce: 0.12,
      }),
    );
    expect(builder.new).not.toHaveBeenCalled();
  });

  it("morphs compact artwork instead of the whole player bar", async () => {
    enableMotionViewTransitions();
    const footer = document.createElement("footer");
    footer.dataset.playerMode = "full";
    const art = document.createElement("a");
    art.className = "player__art-link";
    art.dataset.codaTrackId = "track-1";
    footer.append(art);
    document.body.append(footer);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "now-playing-open");

    expect(builder.add).not.toHaveBeenCalledWith(
      footer,
      "[data-coda-now-playing-surface]",
    );
    expect(builder.add).toHaveBeenCalledWith(
      art,
      '.now-playing__artwork[data-coda-track-id="track-1"]',
    );
    expect(builder.add).not.toHaveBeenCalledWith(
      "[data-coda-player-transport]",
    );
  });

  it("returns now-playing artwork on a bounce-free diagonal without sliding the dock", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("div");
    source.className = "now-playing__artwork";
    source.dataset.codaTrackId = "track-1";
    document.body.append(source);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "now-playing-close");

    expect(motionMocks.animateView).toHaveBeenCalledWith(expect.any(Function), {
      interrupt: "wait",
      type: motionMocks.spring,
      visualDuration: 0.38,
      bounce: 0,
    });
    expect(builder.add).toHaveBeenCalledWith(
      source,
      '.player__art-link[data-coda-track-id="track-1"]',
    );
    expect(builder.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        type: motionMocks.spring,
        visualDuration: 0.38,
        bounce: 0,
      }),
    );
    expect(builder.new).not.toHaveBeenCalled();
  });

  it("morphs Now Playing artwork back to the compact cover", async () => {
    enableMotionViewTransitions();
    const art = document.createElement("div");
    art.className = "now-playing__artwork";
    art.dataset.codaTrackId = "track-1";
    document.body.append(art);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "now-playing-close");

    expect(builder.add).toHaveBeenCalledWith(
      art,
      '.player__art-link[data-coda-track-id="track-1"]',
    );
    expect(builder.add).not.toHaveBeenCalledWith(
      expect.anything(),
      "footer[data-player-mode]",
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
      "daily-detail",
      "data-coda-daily-artwork-source",
      "[data-coda-daily-artwork-detail]",
      "coda-motion-shared-artwork",
    ],
    [
      "discover-detail",
      "data-coda-discover-artwork-source",
      "[data-coda-discover-artwork-detail]",
      "coda-motion-shared-artwork",
    ],
    [
      "radio-detail",
      "data-coda-radio-artwork-source",
      "[data-coda-radio-artwork-detail]",
      "coda-motion-shared-artwork",
    ],
    [
      "playlist-detail",
      "data-coda-playlist-identity-source",
      "[data-coda-playlist-identity-detail]",
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
          type: motionMocks.spring,
          visualDuration: kind.endsWith("close") ? 0.13 : 0.22,
          bounce: kind.endsWith("close") ? 0 : 0.08,
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

  it("keeps now-playing-open on shared-element animateView", async () => {
    enableMotionViewTransitions();
    const pane = document.createElement("main");
    pane.className = "library-pane";
    document.body.append(pane);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "now-playing-open");

    expect(motionMocks.animateView).toHaveBeenCalledOnce();
    expect(motionMocks.animate).not.toHaveBeenCalled();
    pane.remove();
  });

  it.each([
    "album-detail-close",
    "artist-detail-close",
    "playlist-detail-close",
    "radio-detail-close",
    "discover-detail-close",
    "daily-detail-close",
    "now-playing-close",
  ] as const)(
    "reverses %s with shared-element animateView instead of a Collection snapshot",
    async (kind) => {
      enableMotionViewTransitions();
      const builder = motionBuilder();
      motionMocks.animateView.mockImplementation((update: () => void) => {
        update();
        return builder;
      });

      await transitionCodaView(vi.fn(), kind);

      expect(motionMocks.animateView).toHaveBeenCalledOnce();
      expect(motionMocks.animate).not.toHaveBeenCalled();
      expect(builder.add).not.toHaveBeenCalledWith(".library-pane");
    },
  );

  it("lets album Back resolve after the reverse morph snapshot, not a live-pane spring", async () => {
    enableMotionViewTransitions();
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });
    const update = vi.fn();

    await transitionCodaView(update, "album-detail-close");

    expect(update).toHaveBeenCalledOnce();
    expect(motionMocks.animateView).toHaveBeenCalledOnce();
    expect(motionMocks.animate).not.toHaveBeenCalled();
  });

  it("does not snapshot Discover, Daily, or Now Playing panes on detail Back", async () => {
    enableMotionViewTransitions();
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "discover-detail-close");
    await transitionCodaView(vi.fn(), "daily-detail-close");
    await transitionCodaView(vi.fn(), "now-playing-close");

    expect(motionMocks.animateView).toHaveBeenCalledTimes(3);
    expect(motionMocks.animate).not.toHaveBeenCalled();
    expect(builder.add).not.toHaveBeenCalledWith(".library-pane");
  });

  it("does not snapshot the Collection pane for album or artist detail morphs", async () => {
    enableMotionViewTransitions();
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "album-detail");
    await transitionCodaView(vi.fn(), "artist-detail");

    expect(motionMocks.animateView).toHaveBeenCalledTimes(2);
    expect(motionMocks.animate).not.toHaveBeenCalled();
    expect(builder.add).not.toHaveBeenCalledWith(".library-pane");
  });

  it("finishes view-transition animations that are not rooted on html", () => {
    const finish = vi.fn();
    const target = document.createElement("div");
    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [
        {
          finish,
          cancel: vi.fn(),
          effect: {
            target,
            pseudoElement: "::view-transition-group(motion-view-1)",
          },
        },
      ],
    });

    supersedeMotionViewTransition();

    expect(finish).toHaveBeenCalledOnce();
  });

  it("skips the active native view transition so a leftover overlay cannot eat clicks", () => {
    const skipTransition = vi.fn();
    Object.defineProperty(document, "activeViewTransition", {
      configurable: true,
      value: { skipTransition },
    });

    supersedeMotionViewTransition();

    expect(skipTransition).toHaveBeenCalledOnce();
  });

  it("does not skip the incoming artist transition after animateView starts", async () => {
    enableMotionViewTransitions();
    const hung = deferred();
    const nested = {
      animation: {
        cancel: vi.fn(),
        finish: vi.fn(),
        onfinish: null as ((this: Animation, event: Event) => void) | null,
      },
      finished: hung.promise,
      notifyFinished: vi.fn(() => hung.resolve()),
      stop: vi.fn(),
    };
    const firstBuilder = motionBuilder({ finished: hung.promise });
    Object.assign(firstBuilder.controls, {
      animations: [nested],
      complete: vi.fn(),
    });
    const secondBuilder = motionBuilder();
    const staleSkip = vi.fn();
    let incomingAborted = false;
    const incomingSkip = vi.fn(() => {
      incomingAborted = true;
    });
    let active = { skipTransition: staleSkip };
    Object.defineProperty(document, "activeViewTransition", {
      configurable: true,
      get: () => active,
    });
    let phase = 0;
    motionMocks.animateView.mockImplementation((update: () => void) => {
      phase += 1;
      if (phase === 1) {
        active = { skipTransition: staleSkip };
        update();
        return firstBuilder;
      }
      active = { skipTransition: incomingSkip };
      queueMicrotask(() => {
        if (!incomingAborted) update();
      });
      return secondBuilder;
    });

    const first = transitionCodaView(vi.fn(), "album-detail");
    const secondUpdate = vi.fn();
    const second = transitionCodaView(secondUpdate, "artist-detail");
    await Promise.all([first, second]);

    expect(staleSkip).toHaveBeenCalled();
    expect(incomingSkip).not.toHaveBeenCalled();
    expect(secondUpdate).toHaveBeenCalledOnce();
  });

  it("stops a hung now-playing-open animation so the next open can commit", async () => {
    enableMotionViewTransitions();
    const hung = deferred();
    const firstBuilder = motionBuilder({ finished: hung.promise });
    firstBuilder.controls.stop.mockImplementation(() => hung.resolve());
    const secondBuilder = motionBuilder();
    const builders = [firstBuilder, secondBuilder];
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builders.shift()!;
    });

    const first = transitionCodaView(vi.fn(), "now-playing-open");
    const secondUpdate = vi.fn();
    const second = transitionCodaView(secondUpdate, "album-detail");

    expect(firstBuilder.controls.stop).toHaveBeenCalledOnce();
    await Promise.all([first, second]);
    expect(secondUpdate).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("notifies a hung close finished when stop() does not, so interrupt:wait can start", async () => {
    enableMotionViewTransitions();
    const hung = deferred();
    const nested = {
      animation: {
        cancel: vi.fn(),
        finish: vi.fn(() => {
          throw new Error("skipped view transition");
        }),
        onfinish: null as ((this: Animation, event: Event) => void) | null,
      },
      finished: hung.promise,
      notifyFinished: vi.fn(() => hung.resolve()),
      stop: vi.fn(),
    };
    const firstBuilder = motionBuilder({ finished: hung.promise });
    Object.assign(firstBuilder.controls, {
      animations: [nested],
      complete: vi.fn(() => {
        throw new Error("finish after skip");
      }),
    });
    firstBuilder.controls.stop.mockImplementation(() => {
      // Real Motion NativeAnimation.stop() for view-transition pseudos does
      // not resolve `finished`. NativeAnimationWrapper.stop() cancels WAAPI
      // without notifyFinished, which would leave interrupt:wait queued.
    });
    const secondBuilder = motionBuilder();
    let currentFinished: Promise<unknown> | undefined;
    const queuedStarts: Array<() => void> = [];
    const builders = [firstBuilder, secondBuilder];
    motionMocks.animateView.mockImplementation((update: () => void) => {
      const builder = builders.shift()!;
      const start = () => {
        update();
        currentFinished = Promise.resolve(builder.controls.finished).finally(
          () => {
            currentFinished = undefined;
            queuedStarts.shift()?.();
          },
        );
      };
      if (currentFinished) {
        queuedStarts.push(start);
      } else {
        start();
      }
      return builder;
    });

    const first = transitionCodaView(vi.fn(), "now-playing-open");
    const secondUpdate = vi.fn();
    const second = transitionCodaView(secondUpdate, "album-detail");

    expect(firstBuilder.controls.stop).toHaveBeenCalledOnce();
    expect(nested.notifyFinished).toHaveBeenCalledOnce();
    await Promise.all([first, second]);
    expect(secondUpdate).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("settles a timed-out morph so a later open can commit after handles drop", async () => {
    enableMotionViewTransitions();
    vi.useFakeTimers();
    const skipTransition = vi.fn();
    Object.defineProperty(document, "activeViewTransition", {
      configurable: true,
      value: { skipTransition },
    });
    const hung = deferred();
    const nested = {
      animation: {
        cancel: vi.fn(),
        finish: vi.fn(),
        onfinish: null as ((this: Animation, event: Event) => void) | null,
      },
      finished: hung.promise,
      notifyFinished: vi.fn(() => hung.resolve()),
      stop: vi.fn(),
    };
    const firstControls = {
      animations: [nested],
      complete: vi.fn(),
      finished: hung.promise,
      stop: vi.fn(),
    };
    const firstBuilder = {
      add: vi.fn().mockReturnThis(),
      class: vi.fn().mockReturnThis(),
      crop: vi.fn().mockReturnThis(),
      enter: vi.fn().mockReturnThis(),
      exit: vi.fn().mockReturnThis(),
      group: vi.fn().mockReturnThis(),
      layout: vi.fn().mockReturnThis(),
      new: vi.fn().mockReturnThis(),
      old: vi.fn().mockReturnThis(),
      then: (
        resolve?: (value: typeof firstControls) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(firstControls).then(resolve, reject),
    };
    const secondBuilder = motionBuilder();
    let currentFinished: Promise<unknown> | undefined;
    const queuedStarts: Array<() => void> = [];
    const finishedQueue = [hung.promise, Promise.resolve()];
    const builders: unknown[] = [firstBuilder, secondBuilder];
    motionMocks.animateView.mockImplementation((update: () => void) => {
      const builder = builders.shift()!;
      const start = () => {
        update();
        currentFinished = Promise.resolve(finishedQueue.shift()).finally(() => {
          currentFinished = undefined;
          queuedStarts.shift()?.();
        });
      };
      if (currentFinished) {
        queuedStarts.push(start);
      } else {
        start();
      }
      return builder;
    });

    const first = transitionCodaView(vi.fn(), "album-detail");
    await vi.advanceTimersByTimeAsync(400);
    await first;
    expect(nested.notifyFinished).toHaveBeenCalledOnce();
    expect(skipTransition).toHaveBeenCalled();
    expect(firstBuilder).not.toHaveProperty("controls");

    const secondUpdate = vi.fn();
    const second = transitionCodaView(secondUpdate, "album-detail");
    await second;
    expect(secondUpdate).toHaveBeenCalledOnce();
    expect(motionMocks.animateView).toHaveBeenNthCalledWith(
      2,
      expect.any(Function),
      expect.objectContaining({ interrupt: "wait" }),
    );
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
      "artist-detail",
      "data-coda-artist-name-source",
      "[data-coda-artist-name-detail]",
    ],
    [
      "daily-detail",
      "data-coda-daily-title-source",
      "[data-coda-daily-title-detail]",
    ],
    [
      "discover-detail",
      "data-coda-discover-title-source",
      "[data-coda-discover-title-detail]",
    ],
    [
      "radio-detail",
      "data-coda-radio-title-source",
      "[data-coda-radio-title-detail]",
    ],
    [
      "playlist-detail",
      "data-coda-playlist-title-source",
      "[data-coda-playlist-title-detail]",
    ],
    [
      "now-playing-open",
      "data-coda-now-playing-title-compact",
      "[data-coda-now-playing-title-detail]",
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
      if (kind.startsWith("now-playing")) {
        expect(builder.layout).toHaveBeenCalledWith(
          expect.objectContaining({
            type: motionMocks.spring,
            visualDuration: 0.28,
            bounce: 0.05,
          }),
        );
        expect(builder.old).toHaveBeenCalledWith(
          { opacity: [1, 0] },
          expect.objectContaining({
            duration: 0.16,
            ease: [0.22, 1, 0.36, 1],
          }),
        );
        expect(builder.new).toHaveBeenCalledWith(
          { opacity: [0, 1] },
          expect.objectContaining({
            duration: 0.16,
            ease: [0.22, 1, 0.36, 1],
          }),
        );
      } else {
        expect(builder.layout).toHaveBeenCalledWith(
          expect.objectContaining({
            type: motionMocks.spring,
            visualDuration: kind.endsWith("close") ? 0.11 : 0.19,
            bounce: kind.endsWith("close") ? 0 : 0.04,
          }),
        );
        expect(builder.old).toHaveBeenCalledWith(
          { opacity: [1, 0] },
          expect.objectContaining({
            duration: 0.13,
            ease: [0.22, 1, 0.36, 1],
          }),
        );
        expect(builder.new).toHaveBeenCalledWith(
          { opacity: [0, 1] },
          expect.objectContaining({
            duration: 0.13,
            ease: [0.22, 1, 0.36, 1],
          }),
        );
      }
    },
  );

  it.each([
    ["artist-detail", "[data-coda-artist-detail-surface]"],
    ["daily-detail", "[data-coda-daily-detail-surface]"],
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
          duration: 0.13,
          ease: [0.22, 1, 0.36, 1],
        }),
      );
    },
  );

  it("does not snapshot the album tracklist as a detail surface", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("div");
    source.className = "coda-album-artwork-source";
    document.body.append(source);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "album-detail");

    expect(builder.add).not.toHaveBeenCalledWith(
      "[data-coda-album-detail-surface]",
    );
    expect(builder.layout).toHaveBeenCalledWith(
      expect.objectContaining({
        type: motionMocks.spring,
        visualDuration: 0.22,
        bounce: 0.08,
      }),
    );
  });

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
        type: motionMocks.spring,
        visualDuration: 0.22,
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

  it.each([
    "album-detail",
    "album-detail-close",
    "artist-detail",
    "artist-detail-close",
    "daily-detail",
    "daily-detail-close",
    "discover-detail",
    "discover-detail-close",
    "playlist-detail",
    "playlist-detail-close",
    "radio-detail",
    "radio-detail-close",
    "now-playing-open",
    "now-playing-close",
    "page-forward",
    "page-back",
    "page-crossfade",
  ] as const satisfies readonly CodaViewTransitionKind[])(
    "skips animateView for %s when reduced motion is requested",
    async (kind) => {
      enableMotionViewTransitions();
      const startViewTransition = vi.fn();
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: startViewTransition,
      });
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: vi.fn((query: string) => ({
          matches: query.includes("prefers-reduced-motion"),
        })),
      });
      const update = vi.fn();

      await transitionCodaView(update, kind);

      expect(update).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith(false);
      expect(motionMocks.animateView).not.toHaveBeenCalled();
      expect(motionMocks.animate).not.toHaveBeenCalled();
      expect(startViewTransition).not.toHaveBeenCalled();
    },
  );

  it("zeros CSS motion duration under prefers-reduced-motion", () => {
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.01ms\s*!important/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration:\s*0\.01ms\s*!important/,
    );
    expect(css).toMatch(
      /html:is\(\s*\n\s*\.coda-transition--album-detail,[\s\S]*\.coda-transition--now-playing-open,[\s\S]*view-transition-name:\s*none;/,
    );
    expect(css).toMatch(/--duration-coda-shared-detail-close:\s*130ms;/);
    expect(css).toMatch(/--duration-coda-shared-title-close:\s*110ms;/);
    expect(css).toMatch(
      /animation:\s*coda-detail-surface-in var\(--duration-coda-view\)/,
    );
    expect(css).not.toMatch(/coda-detail-surface-in 300ms/);
    expect(css).toMatch(
      /::view-transition,\s*\n::view-transition-group\(\*\),\s*\n::view-transition-old\(\*\),\s*\n::view-transition-new\(\*\)\s*\{[\s\S]*pointer-events:\s*none;/,
    );
    const drawer = readFileSync(
      join(process.cwd(), "src/components/ui/drawer.tsx"),
      "utf8",
    );
    expect(drawer).toMatch(/transition-\[transform,opacity\]/);
    expect(drawer).not.toMatch(/transition-\[transform,height/);
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
