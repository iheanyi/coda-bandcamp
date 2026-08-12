import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";

import { useRadioRouteNavigation } from "@/features/radio/RadioRouteNavigationState";
import { useRadioRuntime } from "@/features/radio/RadioRuntimeContext";
import { RadioShowScreen } from "@/features/radio/RadioShowScreen";
import { radioShowQueryOptions } from "@/queries/radioQueries";
import {
  parseRadioShowIdParam,
  stringifyRadioShowIdParam,
} from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import {
  RadioRouteError,
  RadioRouteNotFound,
  RadioShowPending,
} from "@/routes/radio/-radio-route-status";

function RadioShowRoute() {
  const runtime = useRadioRuntime();
  const navigation = useRadioRouteNavigation();
  const { showId } = Route.useLoaderData();

  // Signed Radio streams are intentionally activation-only. Keeping this
  // query in the route component lets intent preload validate the destination
  // and load its code without contacting Bandcamp for signed media.
  useSuspenseQuery(radioShowQueryOptions(showId));

  return (
    <RadioShowScreen
      {...runtime}
      showId={showId}
      onBack={() => navigation.closeShow(showId)}
      onBrowseSeries={navigation.browseSeriesFromShow}
    />
  );
}

export const Route = createFileRoute("/radio/shows/$showId")({
  component: RadioShowRoute,
  errorComponent: RadioRouteError,
  loader: ({ params }) => ({
    showId: parseRadioShowIdParam(params.showId),
  }),
  notFoundComponent: RadioRouteNotFound,
  params: {
    parse: ({ showId }) => {
      try {
        return {
          showId: stringifyRadioShowIdParam(parseRadioShowIdParam(showId)),
        };
      } catch {
        throw notFound();
      }
    },
    stringify: ({ showId }) => ({
      showId: stringifyRadioShowIdParam(parseRadioShowIdParam(showId)),
    }),
  },
  pendingComponent: RadioShowPending,
  staticData: codaRouteMeta("radio-show", "radio"),
});
