import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import {
  createHashHistory,
  createMemoryHistory,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import {
  LibrarySessionProvider,
  createLibrarySessionController,
  type LibrarySessionController,
  type LibrarySessionRouteReader,
} from "@/features/library-session";
import { notifyToast } from "@/components/ui/toastManager";
import { routeTree } from "./routeTree.gen";

export type CodaRouterContext = Readonly<{
  librarySession: LibrarySessionRouteReader;
  librarySessionBoundary: (
    props: Readonly<{ children: ReactNode }>,
  ) => ReactNode;
  queryClient: QueryClient;
}>;

type CreateCodaRouterOptions = Readonly<{
  history: RouterHistory;
  librarySession?: LibrarySessionController;
  queryClient: QueryClient;
}>;

function createCodaRouterWithHistory({
  history,
  librarySession: providedLibrarySession,
  queryClient,
}: CreateCodaRouterOptions) {
  const librarySession =
    providedLibrarySession ??
    createLibrarySessionController({ notify: notifyToast, queryClient });
  const LibrarySessionBoundary = ({
    children,
  }: Readonly<{ children: ReactNode }>) => (
    <LibrarySessionProvider controller={librarySession}>
      {children}
    </LibrarySessionProvider>
  );
  return createRouter({
    context: {
      librarySession: librarySession.route,
      librarySessionBoundary: LibrarySessionBoundary,
      queryClient,
    },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    history,
    routeTree,
    scrollRestoration: true,
    scrollRestorationBehavior: "instant",
    scrollToTopSelectors: ["[data-coda-library-scroll]"],
  });
}

export function createCodaRouter(
  queryClient: QueryClient,
  librarySession?: LibrarySessionController,
) {
  return createCodaRouterWithHistory({
    history: createHashHistory(),
    librarySession,
    queryClient,
  });
}

export function createCodaMemoryRouter(
  queryClient: QueryClient,
  initialEntries: readonly string[] = ["/"],
  librarySession?: LibrarySessionController,
) {
  return createCodaRouterWithHistory({
    history: createMemoryHistory({ initialEntries: [...initialEntries] }),
    librarySession,
    queryClient,
  });
}

export type CodaRouter = ReturnType<typeof createCodaRouter>;

declare module "@tanstack/react-router" {
  interface Register {
    router: CodaRouter;
  }
}
