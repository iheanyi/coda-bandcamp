import type { ReactNode, Ref } from "react";

import { Drawer } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";

export type AppShellRoute = Readonly<{
  sidebar: ReactNode;
  chrome?: ReactNode;
  outlet: ReactNode;
  libraryPaneRef?: Ref<HTMLElement>;
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
            data-slot="app-shell-main"
            ref={route.libraryPaneRef}
          >
            {route.chrome}
            {route.outlet}
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
