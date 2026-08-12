import type {
  DefaultError,
  EnsureQueryDataOptions,
  QueryClient,
  QueryKey,
} from "@tanstack/react-query";
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

export type AuthenticatedQueryPreloader = Readonly<{
  ensureQueryData<
    TQueryFnData,
    TError = DefaultError,
    TData = TQueryFnData,
    TQueryKey extends QueryKey = QueryKey,
  >(
    options: EnsureQueryDataOptions<TQueryFnData, TError, TData, TQueryKey>,
  ): Promise<TData | undefined>;
}>;

export type CodaRouterContext = Readonly<{
  authenticatedQueryPreloader: AuthenticatedQueryPreloader;
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
  const authenticatedQueryPreloader =
    Object.freeze<AuthenticatedQueryPreloader>({
      async ensureQueryData(options) {
        if (!librarySession.route.getSnapshot().canPreloadAuthenticatedRoute) {
          return undefined;
        }
        return queryClient.ensureQueryData(options);
      },
    });
  return createRouter({
    context: {
      authenticatedQueryPreloader,
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
