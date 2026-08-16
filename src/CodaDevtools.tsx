import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";

import type { CodaRouter } from "@/router";

type CodaDevtoolsProps = Readonly<{
  queryClient: QueryClient;
  router: CodaRouter;
}>;

export function CodaDevtools({ queryClient, router }: CodaDevtoolsProps) {
  return (
    <TanStackDevtools
      config={{
        defaultOpen: false,
        hideUntilHover: false,
        panelLocation: "bottom",
        position: "middle-right",
        triggerMode: "fixed",
      }}
      plugins={[
        {
          id: "tanstack-router",
          name: "TanStack Router",
          render: <TanStackRouterDevtoolsPanel router={router} />,
        },
        {
          id: "tanstack-query",
          name: "TanStack Query",
          render: <ReactQueryDevtoolsPanel client={queryClient} />,
        },
      ]}
    />
  );
}
