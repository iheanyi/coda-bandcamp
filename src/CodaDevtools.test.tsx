import { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { describe, expect, it } from "vitest";

import {
  CODA_DEVTOOLS_CONFIG,
  createCodaDevtoolsConfiguration,
} from "@/codaDevtoolsConfig";
import { createCodaMemoryRouter } from "@/router";

describe("Coda Devtools configuration", () => {
  it("registers Router and Query inspectors with explicit app instances", () => {
    const queryClient = new QueryClient();
    const router = createCodaMemoryRouter(queryClient, ["/collection"]);
    const { config, plugins } = createCodaDevtoolsConfiguration(
      queryClient,
      router,
    );
    const [routerPlugin, queryPlugin] = plugins;

    expect(config).toBe(CODA_DEVTOOLS_CONFIG);
    expect(config).toEqual({
      defaultOpen: false,
      hideUntilHover: false,
      panelLocation: "bottom",
      position: "middle-right",
      triggerMode: "fixed",
    });
    expect(plugins.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: "tanstack-router", name: "TanStack Router" },
      { id: "tanstack-query", name: "TanStack Query" },
    ]);
    expect(routerPlugin.render.type).toBe(TanStackRouterDevtoolsPanel);
    expect(routerPlugin.render.props.router).toBe(router);
    expect(queryPlugin.render.type).toBe(ReactQueryDevtoolsPanel);
    expect(queryPlugin.render.props.client).toBe(queryClient);
  });
});
