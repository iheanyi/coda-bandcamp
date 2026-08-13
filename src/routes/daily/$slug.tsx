import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  type ErrorComponentProps,
  useRouter,
} from "@tanstack/react-router";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { notifyToast } from "@/components/ui/toastManager";
import { countLabel } from "@/countLabel";
import { parseDailyArticleSlug } from "@/daily";
import {
  DailyArticleScreen,
  type DailyPlaybackProps,
} from "@/features/daily/DailyScreens";
import {
  usePlaybackQueueCommands,
  usePlaybackQueueStatus,
  usePlaybackTransportCommands,
  usePlaybackTransportModel,
} from "@/features/playback-runtime";
import { dailyArticleQueryOptions } from "@/queries/dailyQueries";
import { validateDailySearch } from "@/routing/routeContracts";
import { codaRouteMeta } from "@/routing/routeMeta";
import { DailyRoutePending } from "@/routes/-route-loading";

function DailyArticleError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <section className="mx-auto grid min-h-72 max-w-xl place-items-center text-center">
      <div>
        <h1 className="m-0 text-xl font-semibold">
          Could not open this Daily story
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Bandcamp Daily may have changed the story or its music embeds.
        </p>
        <Button
          className="mt-3"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          size="compact"
        >
          Try again
        </Button>
      </div>
    </section>
  );
}

function DailyArticleRoute() {
  const { slug } = Route.useParams();
  const { articleSection, category } = validateDailySearch(Route.useSearch());
  const query = useQuery(
    dailyArticleQueryOptions(articleSection ?? category, slug),
  );
  const queue = usePlaybackQueueStatus();
  const transport = usePlaybackTransportModel();
  const queueCommands = usePlaybackQueueCommands();
  const transportCommands = usePlaybackTransportCommands();
  const playback = useMemo<DailyPlaybackProps>(
    () => ({
      currentTrackId: queue.currentTrackId,
      playing: transport.playing,
      onPlayTracks: (tracks) => {
        if (!tracks.length) return;
        queueCommands.playTracks(tracks);
        notifyToast(`Playing ${countLabel(tracks.length, "track")}`, "good");
      },
      onQueueTracks: (tracks) => {
        if (!tracks.length) return;
        queueCommands.queueTracks(tracks);
        notifyToast(
          `${countLabel(tracks.length, "track")} added to queue`,
          "good",
        );
      },
      onTogglePlayback: transportCommands.toggle,
    }),
    [
      queue.currentTrackId,
      queueCommands,
      transport.playing,
      transportCommands.toggle,
    ],
  );

  if (query.isPending) return <DailyRoutePending />;
  if (query.isError) throw query.error;
  return (
    <DailyArticleScreen
      article={query.data}
      playback={playback}
      section={category}
    />
  );
}

export const Route = createFileRoute("/daily/$slug")({
  params: {
    parse: ({ slug }) => ({ slug: parseDailyArticleSlug(slug) }),
    stringify: ({ slug }) => ({ slug: parseDailyArticleSlug(slug) }),
  },
  component: DailyArticleRoute,
  errorComponent: DailyArticleError,
  loaderDeps: ({ search }) => validateDailySearch(search),
  loader: ({ context, deps, params }) =>
    context.queryClient.ensureQueryData(
      dailyArticleQueryOptions(
        deps.articleSection ?? deps.category,
        params.slug,
      ),
    ),
  pendingComponent: DailyRoutePending,
  staticData: codaRouteMeta("daily-article", "daily"),
});
