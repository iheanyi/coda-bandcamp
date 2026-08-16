import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginMotionDiagnostic,
  finishMotionDiagnostic,
  getMotionDiagnostic,
} from "@/motionDiagnostics";

import {
  awaitRouteCommit,
  MAX_ROUTE_COMMIT_MS,
} from "./routeCommit";
import type {
  RenderedNavigationRouter,
  RenderedRouterEvent,
} from "./routeNavigationAdapters";

type FakeRouter = {
  backCalls: number;
  emitRendered: (locationKey: string) => void;
  router: RenderedNavigationRouter;
  setLocationKey: (locationKey: string) => void;
  unsubscribeCount: number;
};

function createFakeRouter(locationKey: string): FakeRouter {
  let currentKey = locationKey;
  let listener: ((event: RenderedRouterEvent) => void) | undefined;
  const fake: FakeRouter = {
    backCalls: 0,
    emitRendered(nextKey) {
      currentKey = nextKey;
      listener?.({ toLocation: { state: { __TSR_key: nextKey } } });
    },
    router: {
      history: {
        back: () => {
          fake.backCalls += 1;
        },
        canGoBack: () => true,
      },
      state: {
        get location() {
          return { state: { __TSR_key: currentKey } };
        },
      },
      subscribe(_event, nextListener) {
        listener = nextListener;
        return () => {
          fake.unsubscribeCount += 1;
          if (listener === nextListener) listener = undefined;
        };
      },
    },
    setLocationKey(nextKey) {
      currentKey = nextKey;
    },
    unsubscribeCount: 0,
  };
  return fake;
}

function startActiveDiagnostic() {
  return beginMotionDiagnostic({
    configuredDurationMs: 300,
    destinationCount: 1,
    kind: "page-forward",
    sharedExpected: false,
    sourceCount: 1,
    speed: 1,
    transitionClass: "coda-transition--page-forward",
    transitionClasses: [],
    transitionNames: [],
  });
}

describe("awaitRouteCommit", () => {
  afterEach(() => {
    vi.useRealTimers();
    const diagnostic = getMotionDiagnostic();
    if (diagnostic?.status === "active") {
      finishMotionDiagnostic(diagnostic.id, "finished");
    }
  });

  it("resolves rendered when onRendered reports a different location key", async () => {
    const fake = createFakeRouter("entry-1");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");

    const outcome = awaitRouteCommit(fake.router, () => {
      fake.emitRendered("entry-2");
    });

    await expect(outcome).resolves.toBe("rendered");
    expect(fake.unsubscribeCount).toBe(1);
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();

    fake.emitRendered("entry-3");
    expect(fake.unsubscribeCount).toBe(1);
    clearTimeoutSpy.mockRestore();
  });

  it("resolves same-location when navigate settles on the current key", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = createFakeRouter("entry-1");
    let finished = false;

    const pending = awaitRouteCommit(fake.router, () => undefined).then(
      (outcome) => {
        finished = true;
        return outcome;
      },
    );

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(MAX_ROUTE_COMMIT_MS - 1);
    expect(finished).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("same-location");
    expect(fake.unsubscribeCount).toBe(1);
  });

  it("resolves failed without rejecting when navigate rejects", async () => {
    const fake = createFakeRouter("entry-1");
    const blocked = new Error("navigation blocked");

    await expect(
      awaitRouteCommit(fake.router, () => Promise.reject(blocked)),
    ).resolves.toBe("failed");
    expect(fake.unsubscribeCount).toBe(1);
  });

  it("resolves failed without rejecting when commit throws", async () => {
    const fake = createFakeRouter("entry-1");

    await expect(
      awaitRouteCommit(fake.router, () => {
        throw new Error("history unavailable");
      }),
    ).resolves.toBe("failed");
    expect(fake.unsubscribeCount).toBe(1);
  });

  it("resolves timeout within the bound when onRendered stays silent", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fake = createFakeRouter("entry-1");
    const diagnosticId = startActiveDiagnostic();
    let finished = false;

    const pending = awaitRouteCommit(
      fake.router,
      () => new Promise<void>(() => {}),
    ).then((outcome) => {
      finished = true;
      return outcome;
    });

    await vi.advanceTimersByTimeAsync(MAX_ROUTE_COMMIT_MS - 1);
    expect(finished).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("timeout");
    expect(fake.unsubscribeCount).toBe(1);
    expect(getMotionDiagnostic()?.id).toBe(diagnosticId);
    expect(getMotionDiagnostic()?.reason).toBe("router-commit-timeout");
    expect(getMotionDiagnostic()?.phaseTimings.routerReleaseMs).toEqual(
      expect.any(Number),
    );

    fake.emitRendered("entry-2");
    await vi.advanceTimersByTimeAsync(MAX_ROUTE_COMMIT_MS);
    expect(fake.unsubscribeCount).toBe(1);
  });
});
