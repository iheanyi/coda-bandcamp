import {
  Link,
  type ErrorComponentProps,
  useRouter,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { RouteLoadingState } from "@/routes/-route-loading";

const actionClassName =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

function RadioRouteStatus({
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
      aria-labelledby="radio-route-status-title"
      className="mx-auto grid min-h-72 max-w-xl place-items-center px-6 py-12 text-center"
      role={role}
    >
      <div>
        <h1
          className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-2xl font-semibold tracking-tight"
          id="radio-route-status-title"
        >
          {title}
        </h1>
        <p className="mt-2 mb-0 text-sm text-muted-foreground">{detail}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </section>
  );
}

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
    <RadioRouteStatus
      action={
        <Link className={actionClassName} to="/radio">
          Return to Radio
        </Link>
      }
      detail="That Bandcamp Radio destination is not available."
      title="Radio destination not found"
    />
  );
}

export function RadioRouteError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <RadioRouteStatus
      action={
        <button
          className={actionClassName}
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
    />
  );
}
