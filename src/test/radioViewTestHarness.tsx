import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import { useLayoutEffect, useMemo, useState } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import {
  ALL_CODA_VIEW_TRANSITION_KINDS,
  codaViewTransitionClass,
  type CodaViewTransitionKind,
} from "../detailTransitionDescriptors";
import { RadioArchiveScreen } from "../features/radio/RadioArchiveScreen";
import { RadioRouteNavigationProvider, type RadioRouteNavigationAdapter } from "../features/radio/RadioRouteNavigationContext";
import { useRadioRouteNavigation } from "../features/radio/RadioRouteNavigationState";
import type { RadioPlaybackProps } from "../features/radio/radioScreenTypes";
import { RadioShowScreen } from "../features/radio/RadioShowScreen";
import { createPlaybackClock } from "../playbackClock";
import type { RadioQueryRepository } from "../queries/radioQueries";
import { createCodaMemoryRouter } from "../router";
import { parseRadioShowIdParam, type RadioSeriesId, type RadioShowId } from "../routing/routeContracts";
import type { RadioShow, RadioShowSummary, Track } from "../types";


type RadioTestServices = RadioQueryRepository &
  Readonly<{
    openBandcampUrl: (url: string) => Promise<void>;
    transitionKinds: CodaViewTransitionKind[];
  }>;

export const radioServices: RadioTestServices = {
  fetchShow: vi.fn(),
  fetchShows: vi.fn(),
  openBandcampUrl: vi.fn(),
  transitionKinds: [],
};

function recordActiveTransitionKind() {
  const kind = ALL_CODA_VIEW_TRANSITION_KINDS.find((candidate) =>
    document.documentElement.classList.contains(
      codaViewTransitionClass(candidate),
    ),
  );
  if (kind) radioServices.transitionKinds.push(kind);
}

function renderedRadioRouteCommit() {
  return { locationKey: "radio-test", outcome: "rendered" as const };
}

export const shows: RadioShowSummary[] = [
  {
    id: 979,
    subtitle: "Kinrose",
    description: "A deep listen to new independent hip-hop.",
    publishedAt: "24 Jul 2026 00:00:00 GMT",
    artworkUrl: "https://f4.bcbits.com/img/0046240870_10.jpg",
    series: {
      id: 5,
      title: "The Hip Hop Show",
      slug: "the-hip-hop-show",
    },
  },
  {
    id: 978,
    subtitle: "The Best of 2026",
    description: "Recent favorites from around the world.",
    publishedAt: "17 Jul 2026 00:00:00 GMT",
    series: {
      id: 2,
      title: "Bandcamp Selects",
      slug: "bandcamp-selects",
    },
  },
];

export const show: RadioShow = {
  ...shows[0],
  title: "The Hip Hop Show",
  duration: 4_937,
  streamUrl: "https://bandcamp.com/stream_redirect?enc=mp3-128",
  chapters: [
    {
      title: "Mirage",
      artist: "Sweeps",
      album: "Mirage",
      timecode: 120,
      itemUrl: "https://sweepsbeats.bandcamp.com/track/mirage-w-keylime",
      artistUrl: "https://sweepsbeats.bandcamp.com/",
      albumUrl: "https://sweepsbeats.bandcamp.com/album/mirage",
      artworkUrl: "https://f4.bcbits.com/img/0161226005_10.jpg",
    },
  ],
};

type CanonicalRadioRoutesProps = RadioPlaybackProps &
  Readonly<{
    initialShowId?: RadioShowId;
    openExternal: (url: string) => Promise<void>;
    repository: RadioQueryRepository;
  }>;

function CanonicalRadioScreen({
  favoriteShowIds,
  currentTrackId,
  onPlay,
  onPlayAt,
  onQueue,
  onToggleFavorite,
  onTogglePlayback,
  openExternal,
  playbackClock,
  playing,
  repository,
  seriesId,
  showId,
}: Omit<
  CanonicalRadioRoutesProps,
  "initialShowId"
> &
  Readonly<{
    seriesId?: RadioSeriesId;
    showId?: RadioShowId;
  }>) {
  const navigation = useRadioRouteNavigation();
  useLayoutEffect(() => {
    if (showId === undefined) navigation.restoreArchiveContext(seriesId);
  }, [navigation.restoreArchiveContext, seriesId, showId]);

  const playbackProps = {
    currentTrackId,
    favoriteShowIds,
    onPlay,
    onPlayAt,
    onQueue,
    onToggleFavorite,
    onTogglePlayback,
    playbackClock,
    playing,
  };
  if (showId !== undefined) {
    return (
      <RadioShowScreen
        {...playbackProps}
        onBack={() => navigation.closeShow(showId)}
        onBrowseSeries={navigation.browseSeriesFromShow}
        openExternal={openExternal}
        preferredSummaryScope={seriesId ?? "all"}
        repository={repository}
        showId={showId}
      />
    );
  }

  const archiveProps = {
    ...playbackProps,
    onOpenShow: navigation.openShow,
    onSelectSeries: navigation.selectSeries,
    openExternal,
    repository,
    seriesTravelSteps: navigation.seriesTravelSteps,
  };
  return (
    <RadioArchiveScreen {...archiveProps} seriesId={seriesId} />
  );
}

function CanonicalRadioRoutes({
  initialShowId,
  ...props
}: CanonicalRadioRoutesProps) {
  const [seriesId, setSeriesId] = useState<RadioSeriesId>();
  const [showId, setShowId] = useState<RadioShowId | undefined>(initialShowId);
  const adapter = useMemo<RadioRouteNavigationAdapter>(
    () => ({
      goBack: async () => {
        recordActiveTransitionKind();
        setShowId(undefined);
        return renderedRadioRouteCommit();
      },
      goToIndex: async () => {
        recordActiveTransitionKind();
        setShowId(undefined);
        setSeriesId(undefined);
        return renderedRadioRouteCommit();
      },
      goToSeries: async (nextSeriesId) => {
        recordActiveTransitionKind();
        setShowId(undefined);
        setSeriesId(nextSeriesId);
        return renderedRadioRouteCommit();
      },
      goToShow: async (nextShowId) => {
        recordActiveTransitionKind();
        setShowId(nextShowId);
        return renderedRadioRouteCommit();
      },
    }),
    [],
  );

  return (
    <RadioRouteNavigationProvider adapter={adapter}>
      <CanonicalRadioScreen
        {...props}
        seriesId={seriesId}
        showId={showId}
      />
    </RadioRouteNavigationProvider>
  );
}

export function renderRadio(
  onPlay = vi.fn<(track: Track) => void>(),
  onQueue = vi.fn<(track: Track) => void>(),
  onPlayAt = vi.fn<(track: Track, position: number) => void>(),
  playback: {
    currentTrackId?: string;
    currentTime?: number;
    playing?: boolean;
    onTogglePlayback?: () => void;
    requestedShowId?: number;
    warmArchive?: boolean;
  } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (playback.warmArchive) {
    client.setQueryData(["bandcamp-radio", "all"], {
      pages: [{ results: shows, hasMore: false }],
      pageParams: [null],
    });
  }
  const onTogglePlayback = playback.onTogglePlayback ?? vi.fn();
  const onToggleFavorite = vi.fn();
  const router = createCodaMemoryRouter(client, ["/radio"]);
  render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <div
          data-coda-library-scroll
          style={{ height: 600, overflowY: "auto" }}
        >
          <CanonicalRadioRoutes
            currentTrackId={playback.currentTrackId}
            favoriteShowIds={new Set()}
            initialShowId={
              playback.requestedShowId === undefined
                ? undefined
                : parseRadioShowIdParam(playback.requestedShowId)
            }
            onPlay={onPlay}
            onPlayAt={onPlayAt}
            onQueue={onQueue}
            onToggleFavorite={onToggleFavorite}
            onTogglePlayback={onTogglePlayback}
            openExternal={radioServices.openBandcampUrl}
            playbackClock={createPlaybackClock(playback.currentTime ?? 0)}
            playing={playback.playing ?? false}
            repository={radioServices}
          />
        </div>
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return {
    onPlay,
    onQueue,
    onPlayAt,
    onTogglePlayback,
    onToggleFavorite,
  };
}

beforeEach(() => {
  vi.mocked(radioServices.fetchShow).mockReset().mockResolvedValue(show);
  vi.mocked(radioServices.fetchShows).mockReset().mockResolvedValue({
    results: shows,
    hasMore: false,
  });
  vi.mocked(radioServices.openBandcampUrl)
    .mockReset()
    .mockResolvedValue(undefined);
  radioServices.transitionKinds.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
