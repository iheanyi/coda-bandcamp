import { createFileRoute, notFound } from "@tanstack/react-router";

import { radioShowsInfiniteQueryOptions } from "@/queries/radioQueries";
import {
  parseRadioSeriesIdParam,
  stringifyRadioSeriesIdParam,
} from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { RadioArchiveRoute } from "@/routes/radio/-radio-archive-route";
import {
  RadioArchivePending,
  RadioRouteError,
  RadioRouteNotFound,
} from "@/routes/radio/-radio-route-status";

function RadioSeriesRoute() {
  const seriesId = parseRadioSeriesIdParam(Route.useParams().seriesId);
  return <RadioArchiveRoute seriesId={seriesId} />;
}

export const Route = createFileRoute("/radio/series/$seriesId")({
  component: RadioSeriesRoute,
  errorComponent: RadioRouteError,
  loader: async ({ context, params }) => {
    const seriesId = parseRadioSeriesIdParam(params.seriesId);
    await context.queryClient.ensureInfiniteQueryData(
      radioShowsInfiniteQueryOptions(seriesId),
    );
  },
  notFoundComponent: RadioRouteNotFound,
  params: {
    parse: ({ seriesId }) => {
      try {
        return {
          seriesId: stringifyRadioSeriesIdParam(
            parseRadioSeriesIdParam(seriesId),
          ),
        };
      } catch {
        throw notFound();
      }
    },
    stringify: ({ seriesId }) => ({
      seriesId: stringifyRadioSeriesIdParam(parseRadioSeriesIdParam(seriesId)),
    }),
  },
  pendingComponent: RadioArchivePending,
  staticData: codaRouteMeta("radio-series", "radio"),
});
