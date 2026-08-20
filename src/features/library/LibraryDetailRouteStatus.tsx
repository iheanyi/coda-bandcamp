import { Link } from "@tanstack/react-router";
import { DEFAULT_COLLECTION_ROUTE_SEARCH } from "@/routing/routeContracts";
import { RouteLoadingState } from "@/routes/-route-loading";
import { EmbeddedRouteStatus } from "@/routes/-embedded-route-status";
import { ROUTE_STATUS_ACTION_CLASS } from "@/routes/-route-status-action";

function CollectionLink() {
  return (
    <Link
      className={ROUTE_STATUS_ACTION_CLASS}
      search={DEFAULT_COLLECTION_ROUTE_SEARCH}
      to="/collection"
    >
      Return to Collection
    </Link>
  );
}

export function AlbumRoutePending() {
  return (
    <RouteLoadingState
      detail="Loading this release from your saved Bandcamp library."
      title="Opening album…"
    />
  );
}

export function AlbumRouteNotFound() {
  return (
    <EmbeddedRouteStatus
      action={<CollectionLink />}
      detail="This release is not in the available Bandcamp collection."
      title="Album not found"
      titleId="library-detail-route-status-title"
    />
  );
}

export function ArtistRoutePending() {
  return (
    <RouteLoadingState
      detail="Loading this artist from your saved Bandcamp library."
      title="Opening artist…"
    />
  );
}

export function ArtistRouteNotFound() {
  return (
    <EmbeddedRouteStatus
      action={<CollectionLink />}
      detail="This artist is not in the available Bandcamp collection."
      title="Artist not found"
      titleId="library-detail-route-status-title"
    />
  );
}
