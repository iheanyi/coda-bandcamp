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

function motionBuilder(options: { reject?: unknown } = {}) {
  const controls = {
    finished: Promise.resolve(),
    stop: vi.fn(),
  };
  const builder = {
    add: vi.fn(),
    class: vi.fn(),
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
  builder.then.mockImplementation((resolve, reject) => (
    options.reject === undefined
      ? Promise.resolve(controls).then(resolve, reject)
      : Promise.reject(options.reject).then(resolve, reject)
  ));
  return builder;
}

afterEach(() => {
  document.querySelector(".player__art-link")?.remove();
  document.querySelector(".album-detail__artwork")?.remove();
  document.querySelectorAll(
    [
      "[data-coda-artist-artwork-source]",
      "[data-coda-artist-name-source]",
      "[data-coda-artist-name-detail]",
      "[data-coda-album-title-source]",
      "[data-coda-album-title-detail]",
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
  ).forEach((element) => element.remove());
  document.documentElement.classList.remove(
    "coda-view-transitioning",
    "coda-view-transitions-supported",
    "coda-transition--album-detail",
    "coda-transition--artist-detail",
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
      ["playlist-detail", "coda-transition--playlist-detail"],
      ["playlist-detail-close", "coda-transition--playlist-detail-close"],
      ["radio-detail", "coda-transition--radio-detail"],
      ["radio-detail-close", "coda-transition--radio-detail-close"],
      ["now-playing-open", "coda-transition--now-playing-open"],
      ["now-playing-close", "coda-transition--now-playing-close"],
      ["page-forward", "coda-transition--page-forward"],
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

  it("returns from unpaired destinations without taking a snapshot", async () => {
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-back");

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
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
            ready: lifecycle === "ready"
              ? rejectedLifecycle.promise
              : Promise.resolve(),
            updateCallbackDone: lifecycle === "updateCallbackDone"
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
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-forward");

    expect(update).toHaveBeenCalledOnce();
    expect(motionMocks.animateView).toHaveBeenCalledWith(
      expect.any(Function),
      { interrupt: "immediate" },
    );
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
    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitioning",
    );
  });

  it("restores unpaired Back navigation immediately", async () => {
    enableMotionViewTransitions();
    const update = vi.fn();

    await transitionCodaView(update, "page-back");

    expect(update).toHaveBeenCalledOnce();
    expect(motionMocks.animateView).not.toHaveBeenCalled();
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

  it("pairs the compact and full artwork without requiring stable CSS names", async () => {
    enableMotionViewTransitions();
    const source = document.createElement("button");
    source.className = "player__art-link";
    document.body.append(source);
    const builder = motionBuilder();
    motionMocks.animateView.mockImplementation((update: () => void) => {
      update();
      return builder;
    });

    await transitionCodaView(vi.fn(), "now-playing-open");

    expect(builder.add).toHaveBeenCalledWith(
      source,
      ".now-playing__artwork",
    );
    expect(builder.class).toHaveBeenCalledWith(
      "coda-motion-shared-artwork",
    );
    expect(builder.layout).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 0.44 }),
    );
    expect(builder.old).not.toHaveBeenCalled();
    expect(builder.new).not.toHaveBeenCalled();
    expect(builder.exit).toHaveBeenCalledWith(
      {
        opacity: 0,
        transform: "translateY(6px)",
      },
      expect.objectContaining({ duration: 0.14 }),
    );
  });

  it.each([
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
          bounce: transitionClass === "coda-motion-shared-artwork"
            ? 0.08
            : 0.04,
        }),
      );
    },
  );

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
      expect(builder.class).toHaveBeenCalledWith(
        "coda-motion-shared-title",
      );
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
        { opacity: [0, 0] },
      );
      expect(builder.new).toHaveBeenCalledWith(
        { opacity: [1, 1] },
      );
    },
  );

  it.each([
    ["album-detail", "[data-coda-album-detail-surface]"],
    ["artist-detail", "[data-coda-artist-detail-surface]"],
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
      expect(builder.class).toHaveBeenCalledWith(
        "coda-motion-detail-surface",
      );
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

  it("pairs artist artwork only for the forward drill-in", async () => {
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
    expect(builder.class).toHaveBeenCalledWith(
      "coda-motion-shared-artwork",
    );
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
    const update = vi.fn();

    await transitionCodaView(update, "page-crossfade");

    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitioning",
    );
  });
});
