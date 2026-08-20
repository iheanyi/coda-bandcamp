import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { RetryButton } from "@/components/ui/retry-button";
import { Spinner } from "@/components/ui/spinner";
import type { RouteCommitOutcome } from "@/features/navigation/routeCommit";
import { useActivateDetailDestination } from "@/features/navigation/useActivateDetailDestination";
import { formatErrorMessage } from "@/formatError";
import { openBandcampUrl } from "@/lib";
import {
  type RadioArchiveScope,
  mergeRadioShowSeries,
  radioShowSummaryCandidatesInCache,
  radioShowSummaryObserverOptions,
  radioShowQueryOptions,
  selectRadioShowSummary,
  type RadioQueryRepository,
} from "@/queries/radioQueries";
import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";

import { RadioFeedStatus } from "./RadioFeedStatus";
import { RadioDetail } from "./RadioDetail";
import { RadioShowBackButton } from "./RadioShowBackButton";
import type { RadioPlaybackProps } from "./radioScreenTypes";
import { useOpenExternalBandcampItem } from "./useOpenExternalBandcampItem";

export type RadioShowScreenProps = RadioPlaybackProps &
  Readonly<{
    showId: RadioShowId;
    onBack: () => Promise<RouteCommitOutcome>;
    onBrowseSeries: (seriesId?: RadioSeriesId) => void;
    openExternal?: (url: string) => Promise<void>;
    preferredSummaryScope?: RadioArchiveScope;
    repository?: RadioQueryRepository;
  }>;

function RadioShowStatusShell({
  onBack,
  busy,
  action,
  detail,
  icon,
  role,
  title,
}: {
  onBack: () => Promise<RouteCommitOutcome>;
  busy?: boolean;
  action?: ReactNode;
  detail: string;
  icon: ReactNode;
  role?: "alert" | "status";
  title: string;
}) {
  return (
    <section
      className="min-h-full pb-2.5"
      aria-busy={busy ? "true" : undefined}
      aria-live={busy ? "polite" : undefined}
    >
      <RadioShowBackButton onBack={onBack} />
      <RadioFeedStatus
        action={action}
        detail={detail}
        icon={icon}
        role={role}
        title={title}
      />
    </section>
  );
}

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
  const details = useMemo(
    () =>
      showQuery.data
        ? mergeRadioShowSeries(showQuery.data, cachedSummary)
        : showQuery.data,
    [cachedSummary, showQuery.data],
  );
  const summary = details ?? cachedSummary;
  const [actionError, setActionError] = useState("");

  useActivateDetailDestination(
    "radio",
    `radio:${String(showId)}`,
    Boolean(summary),
  );

  const openItem = useOpenExternalBandcampItem(openExternal, setActionError);

  if (!summary && showQuery.isPending) {
    return (
      <RadioShowStatusShell
        busy
        detail="Fetching the episode audio and tracklist from Bandcamp."
        icon={
          <Spinner
            className="size-7 motion-reduce:animate-none"
            aria-label="Loading Radio show details"
          />
        }
        onBack={onBack}
        title="Loading show details…"
      />
    );
  }

  if (!summary) {
    return (
      <RadioShowStatusShell
        action={
          <RetryButton
            busy={showQuery.isFetching}
            busyLabel="Loading again…"
            className="mt-4 text-xs text-[#dd8973]"
            label="Try again"
            onClick={() => void showQuery.refetch()}
          />
        }
        detail={
          showQuery.isError
            ? formatErrorMessage(showQuery.error)
            : "Bandcamp did not return this Radio show."
        }
        icon={<Radio size={30} />}
        onBack={onBack}
        role="alert"
        title="This Radio show is off the air"
      />
    );
  }

  return (
    <RadioDetail
      show={summary}
      details={details}
      loading={!details && showQuery.isPending}
      loadError={
        !details && showQuery.isError
          ? formatErrorMessage(showQuery.error)
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
