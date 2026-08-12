import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { DEFAULT_COLLECTION_ROUTE_SEARCH } from "@/routing/routeContracts";
import { RouteLoadingState } from "@/routes/-route-loading";

type LibraryDetailRouteStatusProps = Readonly<{
  action?: ReactNode;
  className?: string;
  detail: string;
  role?: "status";
  title: string;
}>;

function LibraryDetailRouteStatus({
  action,
  className,
  detail,
  role,
  title,
}: LibraryDetailRouteStatusProps) {
  return (
    <section
      aria-labelledby="library-detail-route-status-title"
      className={cn(
        "mx-auto grid min-h-72 max-w-xl place-items-center px-6 py-12 text-center",
        className,
      )}
      role={role}
    >
      <div>
        <h1
          className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-2xl font-semibold tracking-tight"
          id="library-detail-route-status-title"
        >
          {title}
        </h1>
        <p className="mt-2 mb-0 text-sm text-muted-foreground">{detail}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </section>
  );
}

const actionClassName =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function CollectionLink() {
  return (
    <Link
      className={actionClassName}
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
    <LibraryDetailRouteStatus
      action={<CollectionLink />}
      detail="This release is not in the available Bandcamp collection."
      title="Album not found"
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
    <LibraryDetailRouteStatus
      action={<CollectionLink />}
      detail="This artist is not in the available Bandcamp collection."
      title="Artist not found"
    />
  );
}
