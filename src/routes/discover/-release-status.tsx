import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { DEFAULT_DISCOVER_ROUTE_SEARCH } from "@/routing/routeContracts";
import { RouteLoadingState } from "@/routes/-route-loading";

const actionClassName =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function DiscoverReleaseStatus({
  action,
  detail,
  role,
  title,
}: Readonly<{
  action?: ReactNode;
  detail: string;
  role?: "alert" | "status";
  title: string;
}>) {
  return (
    <section
      aria-labelledby="discover-release-route-status-title"
      className="mx-auto grid min-h-72 max-w-xl place-items-center px-6 py-12 text-center"
      role={role}
    >
      <div>
        <h1
          className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-2xl font-semibold tracking-tight"
          id="discover-release-route-status-title"
        >
          {title}
        </h1>
        <p className="mt-2 mb-0 text-sm text-muted-foreground">{detail}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </section>
  );
}

export function DiscoverReleasePending() {
  return (
    <RouteLoadingState
      detail="Loading the release from the anonymous Discover feed."
      title="Opening release…"
    />
  );
}

export function DiscoverReleaseNotFound() {
  return (
    <DiscoverReleaseStatus
      action={
        <Link
          className={actionClassName}
          search={DEFAULT_DISCOVER_ROUTE_SEARCH}
          to="/discover"
        >
          Return to Discover
        </Link>
      }
      detail="The release is not in the currently available Discover pages. Open Discover and load more results before trying again."
      title="Release not found"
    />
  );
}

export function DiscoverReleaseError({
  onRetry,
}: Readonly<{
  onRetry: () => void;
}>) {
  return (
    <DiscoverReleaseStatus
      action={
        <button className={actionClassName} onClick={onRetry} type="button">
          Try again
        </button>
      }
      detail="Discover could not load this release. Your library and player data are unchanged."
      role="alert"
      title="Release could not be opened"
    />
  );
}
