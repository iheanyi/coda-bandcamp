import { Link } from "@tanstack/react-router";
import { DEFAULT_DISCOVER_ROUTE_SEARCH } from "@/routing/routeContracts";
import { RouteLoadingState } from "@/routes/-route-loading";
import { EmbeddedRouteStatus } from "@/routes/-embedded-route-status";
import { ROUTE_STATUS_ACTION_CLASS } from "@/routes/-route-status-action";

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
    <EmbeddedRouteStatus
      action={
        <Link
          className={ROUTE_STATUS_ACTION_CLASS}
          search={DEFAULT_DISCOVER_ROUTE_SEARCH}
          to="/discover"
        >
          Return to Discover
        </Link>
      }
      detail="The release is not in the currently available Discover pages. Open Discover and load more results before trying again."
      title="Release not found"
      titleId="discover-release-route-status-title"
    />
  );
}

export function DiscoverReleaseError({
  onRetry,
}: Readonly<{
  onRetry: () => void;
}>) {
  return (
    <EmbeddedRouteStatus
      action={
        <button
          className={ROUTE_STATUS_ACTION_CLASS}
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      }
      detail="Discover could not load this release. Your library and player data are unchanged."
      role="alert"
      title="Release could not be opened"
      titleId="discover-release-route-status-title"
    />
  );
}
