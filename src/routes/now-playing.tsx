import { createFileRoute } from "@tanstack/react-router";
import { NowPlayingScreen } from "@/features/now-playing/NowPlayingRuntimeContext";
import { codaRouteMeta } from "@/routing/routeMeta";
import { NowPlayingRoutePending } from "@/routes/-route-loading";

export const Route = createFileRoute("/now-playing")({
  component: NowPlayingScreen,
  pendingComponent: NowPlayingRoutePending,
  staticData: codaRouteMeta("now-playing"),
});
