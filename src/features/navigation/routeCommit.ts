import {
  getMotionDiagnostic,
  type MotionPhaseTimings,
  updateMotionDiagnostic,
} from "@/motionDiagnostics";

import type {
  RenderedNavigationRouter,
  RenderedRouterLocation,
} from "./routeNavigationAdapters";

export type RouteCommitOutcome =
  | "rendered"
  | "same-location"
  | "timeout"
  | "failed";

export type RouteCommitResult = Readonly<{
  locationKey: string;
  outcome: RouteCommitOutcome;
}>;

/**
 * Deadline for a route commit to render, no-op, or fail. Native open/Back
 * sequences in output/verify-coda SUMMARY evidence complete in 270–1,100ms
 * (Now Playing Back 1,062.8ms in 20260816T190158Z-definitive; typical Back
 * 251–690ms in 20260816T2020Z-full-integration), and route renders are ~18ms.
 * Five seconds sits comfortably above the worst legitimate observation,
 * including colder loads. Provisional pending p99 in-app diagnostics.
 */
export const MAX_ROUTE_COMMIT_MS = 5_000;

export function renderedLocationKey(location: RenderedRouterLocation) {
  return location.state.__TSR_key ?? location.href ?? "";
}

export function routeCommitResult(
  router: RenderedNavigationRouter,
  outcome: RouteCommitOutcome,
): RouteCommitResult {
  return {
    locationKey: renderedLocationKey(router.state.location),
    outcome,
  };
}

function activeMotionDiagnosticId(): number | undefined {
  const diagnostic = getMotionDiagnostic();
  return diagnostic?.status === "active" ? diagnostic.id : undefined;
}

function recordRouterPhases(
  diagnosticId: number | undefined,
  phaseTimings: Partial<MotionPhaseTimings>,
): void {
  if (diagnosticId === undefined) return;
  updateMotionDiagnostic(diagnosticId, { phaseTimings });
}

function assertNever(value: never): never {
  throw new TypeError(`Unsupported exhaustive variant: ${String(value)}`);
}

function recordCommitDiagnostics(
  diagnosticId: number | undefined,
  navigationStartedAt: number,
  outcome: RouteCommitOutcome,
): void {
  recordRouterPhases(diagnosticId, {
    routerReleaseMs: performance.now() - navigationStartedAt,
  });
  switch (outcome) {
    case "rendered":
    case "same-location":
    case "failed":
      return;
    case "timeout":
      if (diagnosticId === undefined) return;
      updateMotionDiagnostic(diagnosticId, {
        reason: "router-commit-timeout",
      });
      return;
    default:
      return assertNever(outcome);
  }
}

/**
 * Subscribe before running `commit` so a View Transition update can release
 * as soon as React acknowledges a different route entry. The promise never
 * rejects: a thrown or rejected commit finishes `"failed"` so callers do not
 * trip a second recovery commit. Cleanup of the render subscription and
 * deadline timer runs exactly once.
 *
 * An unchanged location after `commit` settles is not released on a microtask.
 * TanStack's navigate() promise can resolve before `onRendered`, and that
 * microtask is also drained by React `act()`. Releasing then would skip
 * destination DOM for focus/scroll. `"same-location"` is confirmed at the
 * deadline if the key is still unchanged; a changed key without `onRendered`
 * is `"timeout"`.
 */
export function awaitRouteCommit(
  router: RenderedNavigationRouter,
  commit: () => void | Promise<void>,
): Promise<RouteCommitOutcome> {
  const navigationStartedAt = performance.now();
  const fromLocationKey = renderedLocationKey(router.state.location);
  const diagnosticId = activeMotionDiagnosticId();

  return new Promise((resolve) => {
    let settled = false;
    let commitSettled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    const finish = (outcome: RouteCommitOutcome) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      recordCommitDiagnostics(diagnosticId, navigationStartedAt, outcome);
      resolve(outcome);
    };

    unsubscribe = router.subscribe("onRendered", (event) => {
      if (renderedLocationKey(event.toLocation) === fromLocationKey) return;
      recordRouterPhases(diagnosticId, {
        routerRenderMs: performance.now() - navigationStartedAt,
      });
      finish("rendered");
    });
    timeoutId = setTimeout(() => {
      const sameLocation =
        commitSettled &&
        renderedLocationKey(router.state.location) === fromLocationKey;
      finish(sameLocation ? "same-location" : "timeout");
    }, MAX_ROUTE_COMMIT_MS);

    let navigation: void | Promise<void>;
    try {
      navigation = commit();
    } catch {
      finish("failed");
      return;
    }
    void Promise.resolve(navigation).then(
      () => {
        commitSettled = true;
        recordRouterPhases(diagnosticId, {
          routerNavigationMs: performance.now() - navigationStartedAt,
        });
      },
      () => {
        finish("failed");
      },
    );
  });
}
