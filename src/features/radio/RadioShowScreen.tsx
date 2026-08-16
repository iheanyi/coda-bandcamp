import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Radio, RefreshCw } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RouteCommitOutcome } from "@/features/navigation/routeCommit";
import { useActivateDetailDestination } from "@/features/navigation/useActivateDetailDestination";
import { openBandcampUrl } from "@/lib";
import {
  type RadioArchiveScope,
  radioShowSummaryCandidatesInCache,
  radioShowSummaryObserverOptions,
  radioShowQueryOptions,
  selectRadioShowSummary,
  type RadioQueryRepository,
} from "@/queries/radioQueries";
import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";

import { RadioDetail } from "./RadioPresentation";
import type { RadioPlaybackProps } from "./radioScreenTypes";

export type RadioShowScreenProps = RadioPlaybackProps &
  Readonly<{
    showId: RadioShowId;
    onBack: () => Promise<RouteCommitOutcome>;
    onBrowseSeries: (seriesId?: RadioSeriesId) => void;
    openExternal?: (url: string) => Promise<void>;
    preferredSummaryScope?: RadioArchiveScope;
    repository?: RadioQueryRepository;
  }>;

export function RadioShowScreen({
  showId,
  onBack,
  onBrowseSeries,
  onPlay,
  onQueue,
  onPlayAt,
  currentTrackId,
  playbackClock,
  playing,
  onTogglePlayback,
  favoriteShowIds,
  onToggleFavorite,
  openExternal = openBandcampUrl,
  preferredSummaryScope,
  repository,
}: RadioShowScreenProps) {
  const queryClient = useQueryClient();
  const summaryScopes = useMemo(
    () =>
      radioShowSummaryCandidatesInCache(queryClient, showId).map(
        (candidate) => candidate.scope,
      ),
    [queryClient, showId],
  );
  const summaryQueries = useQueries({
    queries: summaryScopes.map((scope) =>
      radioShowSummaryObserverOptions(scope, showId),
    ),
  });
  const cachedSummary = selectRadioShowSummary(
    summaryQueries.flatMap((query, index) => {
      const summary = query.data;
      const scope = summaryScopes[index];
      return summary && scope !== undefined
        ? [{ dataUpdatedAt: query.dataUpdatedAt, scope, summary }]
        : [];
    }),
    preferredSummaryScope,
  );
  const showQuery = useQuery(radioShowQueryOptions(showId, repository));
  const details = useMemo(() => {
    if (!showQuery.data || showQuery.data.series || !cachedSummary?.series) {
      return showQuery.data;
    }
    return { ...showQuery.data, series: cachedSummary.series };
  }, [cachedSummary?.series, showQuery.data]);
  const summary = details ?? cachedSummary;
  const [actionError, setActionError] = useState("");

  useActivateDetailDestination(
    "radio",
    `radio:${String(showId)}`,
    Boolean(summary),
  );

  const openItem = useCallback((url: string) => {
    setActionError("");
    void openExternal(url).catch((cause) => {
      setActionError(String(cause).replace(/^Error:\s*/, ""));
    });
  }, [openExternal]);

  if (!summary && showQuery.isPending) {
    return (
      <section
        className="min-h-full pb-2.5"
        aria-busy="true"
        aria-live="polite"
      >
        <Button
          variant="text"
          size="compact"
          className="mb-3.5 -ml-1 h-auto gap-1.5 p-1 text-xs text-[#969994] hover:bg-transparent hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          Back
        </Button>
        <div className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]">
          <Spinner
            className="size-7 motion-reduce:animate-none"
            aria-label="Loading Radio show details"
          />
          <strong className="mt-3 text-base text-[#cac9c3]">
            Loading show details…
          </strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-coda-subtle-foreground">
            Fetching the episode audio and tracklist from Bandcamp.
          </span>
        </div>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="min-h-full pb-2.5">
        <Button
          variant="text"
          size="compact"
          className="mb-3.5 -ml-1 h-auto gap-1.5 p-1 text-xs text-[#969994] hover:bg-transparent hover:text-foreground"
          onClick={onBack}
        >
          <ArrowLeft size={16} />
          Back
        </Button>
        <div
          className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]"
          role="alert"
        >
          <Radio size={30} />
          <strong className="mt-3 text-base text-[#cac9c3]">
            This Radio show is off the air
          </strong>
          <span className="mt-1.5 max-w-md text-xs/normal text-coda-subtle-foreground">
            {showQuery.isError
              ? String(showQuery.error).replace(/^Error:\s*/, "")
              : "Bandcamp did not return this Radio show."}
          </span>
          <Button
            variant="secondary"
            size="compact"
            className="mt-4 text-xs text-[#dd8973]"
            onClick={() => void showQuery.refetch()}
            disabled={showQuery.isFetching}
          >
            {showQuery.isFetching ? (
              <Spinner
                aria-hidden="true"
                className="size-3.5 text-current motion-reduce:animate-none"
              />
            ) : (
              <RefreshCw size={14} />
            )}
            {showQuery.isFetching ? "Loading again…" : "Try again"}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <RadioDetail
      show={summary}
      details={details}
      loading={!details && showQuery.isPending}
      loadError={
        !details && showQuery.isError
          ? String(showQuery.error).replace(/^Error:\s*/, "")
          : undefined
      }
      retrying={!details && showQuery.isFetching}
      actionError={actionError}
      onBack={onBack}
      onRetry={() => void showQuery.refetch()}
      onPlay={onPlay}
      onQueue={onQueue}
      onPlayAt={onPlayAt}
      currentTrackId={currentTrackId}
      playbackClock={playbackClock}
      playing={playing}
      onTogglePlayback={onTogglePlayback}
      onOpenItem={openItem}
      favorite={favoriteShowIds.has(summary.id)}
      onToggleFavorite={onToggleFavorite}
      onBrowseSeries={onBrowseSeries}
    />
  );
}
