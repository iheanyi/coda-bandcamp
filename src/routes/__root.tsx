import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  useRouter,
} from "@tanstack/react-router";
import App from "@/App";
import type { CodaRouterContext } from "@/router";
import {
  CodaRouteError,
  CodaRouteNotFound,
  CodaRoutePending,
} from "./-route-status";

function RootRouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();

  const retry = () => {
    reset();
    void router.invalidate();
  };

  return <CodaRouteError onRetry={retry} />;
}

function CodaRoot() {
  const router = useRouter();
  const LibrarySessionBoundary = router.options.context.librarySessionBoundary;

  return (
    <LibrarySessionBoundary>
      <App />
    </LibrarySessionBoundary>
  );
}

export const Route = createRootRouteWithContext<CodaRouterContext>()({
  component: CodaRoot,
  errorComponent: RootRouteError,
  notFoundComponent: CodaRouteNotFound,
  pendingComponent: CodaRoutePending,
});
