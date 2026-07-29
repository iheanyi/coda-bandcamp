import { afterEach, describe, expect, it, vi } from "vitest";
import {
  transitionCodaView,
  type CodaViewTransitionKind,
} from "./viewTransitions";

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
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

afterEach(() => {
  document.documentElement.classList.remove(
    "coda-view-transitioning",
    "coda-view-transitions-supported",
    "coda-transition--album-detail",
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
    const secondTransition = transitionCodaView(vi.fn(), "page-back");

    expect(document.documentElement).not.toHaveClass(
      "coda-transition--page-forward",
    );
    expect(document.documentElement).toHaveClass(
      "coda-view-transitioning",
      "coda-transition--page-back",
    );

    first.resolve();
    await firstTransition;

    expect(document.documentElement).toHaveClass(
      "coda-view-transitioning",
      "coda-transition--page-back",
    );

    second.resolve();
    await secondTransition;

    expect(document.documentElement).not.toHaveClass(
      "coda-view-transitioning",
      "coda-transition--page-back",
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
        kind: "page-back",
        className: "coda-transition--page-back",
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
    const secondTransition = transitionCodaView(vi.fn(), "page-back");

    firstReady.reject(new DOMException("Skipped", "AbortError"));
    await Promise.resolve();

    expect(skipTransition).toHaveBeenCalledOnce();
    expect(document.documentElement).toHaveClass(
      "coda-view-transitions-supported",
      "coda-view-transitioning",
      "coda-transition--page-back",
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
    const secondTransition = transitionCodaView(secondUpdate, "page-back");

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
