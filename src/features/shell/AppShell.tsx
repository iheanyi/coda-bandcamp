import {
  Profiler,
  type ReactNode,
  type Ref,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";

import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { recordActiveMotionRender } from "@/motionDiagnostics";
import { consumePendingPageEntrance } from "@/viewTransitions";

export type AppShellRoute = Readonly<{
  sidebar: ReactNode;
  chrome?: ReactNode;
  outlet: ReactNode;
  libraryPaneRef?: Ref<HTMLElement>;
  transitionKey: string;
}>;

export type AppShellQueue = Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: ReactNode;
}>;

export type AppShellPlayback = Readonly<{
  dock?: ReactNode;
}>;

export type AppShellProps = Readonly<{
  route: AppShellRoute;
  queue: AppShellQueue;
  playback: AppShellPlayback;
  nowPlayingOpen: boolean;
  persistentServices?: ReactNode;
  overlays?: ReactNode;
  className?: string;
}>;

function isRefCallback(
  ref: Ref<HTMLElement> | undefined,
): ref is (instance: HTMLElement | null) => void {
  return Object.prototype.toString.call(ref) === "[object Function]";
}

function recordRouteRender(
  id: string,
  _phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
) {
  recordActiveMotionRender(id, actualDuration, baseDuration);
}

/**
 * Owns Coda's persistent desktop layout while feature controllers retain their
 * state and behavior. Route changes replace only the main-pane outlet; the
 * queue, player dock, native bridges, and overlays remain mounted at the root.
 */
export function AppShell({
  route,
  queue,
  playback,
  nowPlayingOpen,
  persistentServices,
  overlays,
  className,
}: AppShellProps) {
  const mainRef = useRef<HTMLElement | null>(null);
  const setMainRef = useCallback(
    (element: HTMLElement | null) => {
      mainRef.current = element;
      if (isRefCallback(route.libraryPaneRef)) {
        route.libraryPaneRef(element);
      } else if (route.libraryPaneRef) {
        route.libraryPaneRef.current = element;
      }
    },
    [route.libraryPaneRef],
  );
  useLayoutEffect(() => {
    if (mainRef.current) {
      consumePendingPageEntrance(mainRef.current, route.transitionKey);
    }
  }, [route.transitionKey]);

  return (
    <Drawer
      disablePointerDismissal
      modal={false}
      onOpenChange={queue.onOpenChange}
      open={queue.open}
      swipeDirection="right"
    >
      <div
        className={cn(
          "grid h-full w-full min-w-[760px] bg-background",
          nowPlayingOpen
            ? "grid-rows-[minmax(0,1fr)]"
            : "grid-rows-[minmax(0,1fr)_--spacing(23)]",
          className,
        )}
        data-slot="app-shell"
      >
        <div
          className="relative isolate grid min-h-0 grid-cols-[9rem_minmax(22rem,1fr)] overflow-hidden lg:grid-cols-[12rem_minmax(32rem,1fr)] xl:grid-cols-[14rem_minmax(32rem,1fr)]"
          data-queue-open={queue.open}
          data-slot="app-shell-workspace"
        >
          {route.sidebar}
          <main
            className={cn(
              "library-pane min-w-0 overflow-auto [scrollbar-color:#393c3d_transparent] scrollbar-thin",
              nowPlayingOpen
                ? "p-0"
                : "px-4 pt-6 pb-10 lg:px-6 lg:pt-8 lg:pb-12 xl:px-8",
            )}
            data-coda-library-scroll
            data-coda-transition-key={route.transitionKey}
            data-slot="app-shell-main"
            ref={setMainRef}
          >
            <Profiler id="coda-route" onRender={recordRouteRender}>
              <Profiler id="coda-route-chrome" onRender={recordRouteRender}>
                {route.chrome}
              </Profiler>
              <Profiler id="coda-route-outlet" onRender={recordRouteRender}>
                {route.outlet}
              </Profiler>
            </Profiler>
          </main>
          {queue.panel}
        </div>
        {playback.dock}
        {persistentServices}
        {overlays}
      </div>
    </Drawer>
  );
}
