import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import type { TanStackDevtoolsReactInit } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { createElement } from "react";

import type { CodaRouter } from "@/router";

type DevtoolsPlugin = NonNullable<
  TanStackDevtoolsReactInit["plugins"]
>[number];

export const CODA_DEVTOOLS_CONFIG = {
  defaultOpen: false,
  hideUntilHover: false,
  panelLocation: "bottom",
  position: "middle-right",
  triggerMode: "fixed",
} satisfies NonNullable<TanStackDevtoolsReactInit["config"]>;

export function createCodaDevtoolsConfiguration(
  queryClient: QueryClient,
  router: CodaRouter,
) {
  const routerPlugin = {
    id: "tanstack-router",
    name: "TanStack Router",
    render: createElement(TanStackRouterDevtoolsPanel, { router }),
  } satisfies DevtoolsPlugin;
  const queryPlugin = {
    id: "tanstack-query",
    name: "TanStack Query",
    render: createElement(ReactQueryDevtoolsPanel, { client: queryClient }),
  } satisfies DevtoolsPlugin;
  const plugins: [typeof routerPlugin, typeof queryPlugin] = [
    routerPlugin,
    queryPlugin,
  ];

  return {
    config: CODA_DEVTOOLS_CONFIG,
    plugins,
  };
}
