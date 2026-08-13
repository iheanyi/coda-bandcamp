import { useId } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type RouteLoadingStateProps = Readonly<{
  className?: string;
  detail: string;
  title: string;
}>;

export function RouteLoadingState({
  className,
  detail,
  title,
}: RouteLoadingStateProps) {
  const headingId = useId();
  const detailId = useId();

  return (
    <section
      aria-busy="true"
      aria-describedby={detailId}
      aria-labelledby={headingId}
      className={cn(
        "mx-auto grid min-h-72 max-w-xl place-items-center px-6 py-12 text-center motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150",
        className,
      )}
      role="status"
    >
      <div className="flex max-w-md flex-col items-center">
        <Spinner
          aria-hidden="true"
          className="mb-4 size-7 text-primary motion-reduce:animate-none"
        />
        <h1
          className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-2xl font-semibold tracking-tight"
          id={headingId}
        >
          {title}
        </h1>
        <p className="mt-2 mb-0 text-sm text-muted-foreground" id={detailId}>
          {detail}
        </p>
      </div>
    </section>
  );
}

export function CollectionRoutePending() {
  return (
    <RouteLoadingState
      detail="Preparing the releases and artists in your saved library."
      title="Loading Collection…"
    />
  );
}

export function RecentRoutePending() {
  return (
    <RouteLoadingState
      detail="Preparing the newest releases in your saved library."
      title="Loading recent additions…"
    />
  );
}

export function FavoritesRoutePending() {
  return (
    <RouteLoadingState
      detail="Preparing the albums, tracks, and Radio shows saved on this device."
      title="Loading Favorites…"
    />
  );
}

export function PlaylistsRoutePending() {
  return (
    <RouteLoadingState
      detail="Preparing your Bandcamp playlists."
      title="Loading playlists…"
    />
  );
}

export function PlaylistRoutePending() {
  return (
    <RouteLoadingState
      detail="Preparing this Bandcamp playlist and its tracks."
      title="Opening playlist…"
    />
  );
}

export function DiscoverRoutePending() {
  return (
    <RouteLoadingState
      detail="Loading releases from Bandcamp’s anonymous Discover feed."
      title="Loading Discover…"
    />
  );
}

export function DailyRoutePending() {
  return (
    <RouteLoadingState
      detail="Finding the playable releases embedded in Bandcamp Daily."
      title="Loading Bandcamp Daily…"
    />
  );
}

export function NowPlayingRoutePending() {
  return (
    <RouteLoadingState
      detail="Preparing the current track and playback details."
      title="Opening Now Playing…"
    />
  );
}
