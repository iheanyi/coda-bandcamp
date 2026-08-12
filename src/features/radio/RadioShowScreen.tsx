import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Radio, RefreshCw } from "lucide-react";
import { useCallback, useLayoutEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { openBandcampUrl } from "@/lib";
import { radioShowQueryOptions } from "@/queries/radioQueries";
import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";

import { RadioDetail } from "./RadioPresentation";
import type { RadioPlaybackProps } from "./radioScreenTypes";

export type RadioShowScreenProps = RadioPlaybackProps &
  Readonly<{
    showId: RadioShowId;
    onBack: () => void;
    onBrowseSeries: (seriesId?: RadioSeriesId) => void;
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
}: RadioShowScreenProps) {
  const showQuery = useQuery(radioShowQueryOptions(showId));
  const [actionError, setActionError] = useState("");

  useLayoutEffect(() => {
    if (!showQuery.data) return;
    document
      .getElementById("radio-detail-title")
      ?.focus({ preventScroll: true });
  }, [showQuery.data]);

  const openItem = useCallback((url: string) => {
    setActionError("");
    void openBandcampUrl(url).catch((cause) => {
      setActionError(String(cause).replace(/^Error:\s*/, ""));
    });
  }, []);

  if (showQuery.isPending) {
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

  if (showQuery.isError) {
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
            {String(showQuery.error).replace(/^Error:\s*/, "")}
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
      show={showQuery.data}
      actionError={actionError}
      onBack={onBack}
      onPlay={onPlay}
      onQueue={onQueue}
      onPlayAt={onPlayAt}
      currentTrackId={currentTrackId}
      playbackClock={playbackClock}
      playing={playing}
      onTogglePlayback={onTogglePlayback}
      onOpenItem={openItem}
      favorite={favoriteShowIds.has(showQuery.data.id)}
      onToggleFavorite={onToggleFavorite}
      onBrowseSeries={onBrowseSeries}
    />
  );
}
