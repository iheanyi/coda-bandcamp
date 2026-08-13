import { createFileRoute } from "@tanstack/react-router";

import { codaRouteMeta } from "@/routing/routeMeta";
import { DailyRoutePending } from "@/routes/-route-loading";

export const Route = createFileRoute("/daily/")({
  component: () => null,
  pendingComponent: DailyRoutePending,
  staticData: codaRouteMeta("daily", "daily"),
});
