import { useMatches } from "@tanstack/react-router";
import type { CodaRouteMeta } from "@/routing/routeMeta";

export function useCodaRouteMeta(): CodaRouteMeta | undefined {
  return useMatches({
    select: (matches) => {
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const metadata = matches[index]?.staticData.coda;
        if (metadata) return metadata;
      }
      return undefined;
    },
  });
}
