import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { DEFAULT_COLLECTION_ROUTE_SEARCH } from "@/routing/routeContracts";
import { ROUTE_STATUS_ACTION_CLASS } from "@/routes/-route-status-action";
import { RouteLoadingState } from "@/routes/-route-loading";

function RouteStatus({
  action,
  detail,
  role,
  title,
}: {
  action?: ReactNode;
  detail: string;
  role?: "alert" | "status";
  title: string;
}) {
  return (
    <main
      className="grid min-h-full place-items-center bg-background px-6 py-12 text-foreground"
      role={role}
    >
      <section
        className="max-w-md text-center"
        aria-labelledby="route-status-title"
      >
        <h1
          className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-2xl font-semibold tracking-tight"
          id="route-status-title"
        >
          {title}
        </h1>
        <p className="mt-2 mb-0 text-sm text-muted-foreground">{detail}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </section>
    </main>
  );
}

export function CodaRoutePending() {
  return (
    <RouteLoadingState
      className="min-h-full"
      detail="Preparing your music library."
      title="Opening Coda…"
    />
  );
}

export function CodaRouteError({
  cause,
  onRetry,
}: {
  cause?: unknown;
  onRetry: () => void;
}) {
  const diagnostic =
    import.meta.env.DEV && cause instanceof Error
      ? cause.message
      : undefined;
  return (
    <RouteStatus
      action={
        <button className={ROUTE_STATUS_ACTION_CLASS} onClick={onRetry} type="button">
          Try again
        </button>
      }
      detail={
        diagnostic ??
        "The requested page could not be opened. Your library and player data are unchanged."
      }
      role="alert"
      title="Coda couldn’t open this page"
    />
  );
}

export function CodaRouteNotFound() {
  return (
    <RouteStatus
      action={
        <Link
          className={ROUTE_STATUS_ACTION_CLASS}
          search={DEFAULT_COLLECTION_ROUTE_SEARCH}
          to="/collection"
        >
          Return to Collection
        </Link>
      }
      detail="That destination does not exist in this version of Coda."
      title="Page not found"
    />
  );
}
