import { createFileRoute, redirect } from "@tanstack/react-router";
import { DEFAULT_COLLECTION_ROUTE_SEARCH } from "@/routing/routeContracts";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({
      replace: true,
      search: DEFAULT_COLLECTION_ROUTE_SEARCH,
      to: "/collection",
    });
  },
});
