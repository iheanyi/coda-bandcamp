import type { QueryClient } from "@tanstack/react-query";
import { TanStackDevtools } from "@tanstack/react-devtools";

import { createCodaDevtoolsConfiguration } from "@/codaDevtoolsConfig";
import type { CodaRouter } from "@/router";

type CodaDevtoolsProps = Readonly<{
  queryClient: QueryClient;
  router: CodaRouter;
}>;

export function CodaDevtools({ queryClient, router }: CodaDevtoolsProps) {
  return (
    <TanStackDevtools
      {...createCodaDevtoolsConfiguration(queryClient, router)}
    />
  );
}
