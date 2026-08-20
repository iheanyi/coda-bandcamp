import {
  Link,
  type ErrorComponentProps,
  useRouter,
} from "@tanstack/react-router";
import { RouteLoadingState } from "@/routes/-route-loading";
import { EmbeddedRouteStatus } from "@/routes/-embedded-route-status";
import { ROUTE_STATUS_ACTION_CLASS } from "@/routes/-route-status-action";

export function RadioArchivePending() {
  return (
    <RouteLoadingState
      detail="Loading the latest anonymous Bandcamp Radio archive."
      title="Tuning Bandcamp Radio…"
    />
  );
}

export function RadioShowPending() {
  return (
    <RouteLoadingState
      detail="Fetching this episode’s audio and tracklist from Bandcamp."
      title="Opening Radio show…"
    />
  );
}

export function RadioRouteNotFound() {
  return (
    <EmbeddedRouteStatus
      action={
        <Link className={ROUTE_STATUS_ACTION_CLASS} to="/radio">
          Return to Radio
        </Link>
      }
      detail="That Bandcamp Radio destination is not available."
      title="Radio destination not found"
      titleId="radio-route-status-title"
    />
  );
}

export function RadioRouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <EmbeddedRouteStatus
      action={
        <button
          className={ROUTE_STATUS_ACTION_CLASS}
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          type="button"
        >
          Try again
        </button>
      }
      detail="Bandcamp Radio could not be loaded. Your library and current playback are unchanged."
      role="alert"
      title="Radio could not be opened"
      titleId="radio-route-status-title"
    />
  );
}
