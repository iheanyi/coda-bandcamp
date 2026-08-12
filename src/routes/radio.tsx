import { createFileRoute, Outlet } from "@tanstack/react-router";

import { useRadioRouteNavigationAdapter } from "@/features/navigation";
import { RadioRouteNavigationProvider } from "@/features/radio/RadioRouteNavigationContext";
import { codaRouteMeta } from "@/routing/routeMeta";
import {
  RadioArchivePending,
  RadioRouteError,
  RadioRouteNotFound,
} from "@/routes/radio/-radio-route-status";

function RadioRouteLayout() {
  const adapter = useRadioRouteNavigationAdapter();

  return (
    <RadioRouteNavigationProvider adapter={adapter}>
      <Outlet />
    </RadioRouteNavigationProvider>
  );
}

export const Route = createFileRoute("/radio")({
  component: RadioRouteLayout,
  errorComponent: RadioRouteError,
  notFoundComponent: RadioRouteNotFound,
  pendingComponent: RadioArchivePending,
  staticData: codaRouteMeta("radio", "radio"),
});
