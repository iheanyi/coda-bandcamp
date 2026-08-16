import type { PlaybackClock } from "@/playbackClock";
import type { RadioQueryRepository } from "@/queries/radioQueries";
import type { RadioSeriesId, RadioShowId } from "@/routing/routeContracts";
import type { RadioShowSummary, Track } from "@/types";

export type RadioPlaybackProps = Readonly<{
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onPlayAt?: (track: Track, position: number) => void;
  currentTrackId?: string;
  playbackClock: PlaybackClock;
  playing: boolean;
  onTogglePlayback: () => void;
  favoriteShowIds: ReadonlySet<number>;
  onToggleFavorite: (show: RadioShowSummary) => void;
}>;

export type RadioArchivePlaybackProps = Pick<
  RadioPlaybackProps,
  | "onPlay"
  | "onQueue"
  | "currentTrackId"
  | "playing"
  | "onTogglePlayback"
  | "favoriteShowIds"
  | "onToggleFavorite"
>;

export type RadioOpenShowRequest = Readonly<{
  showId: RadioShowId;
  sourceTrigger?: HTMLElement;
  sourceArtwork?: HTMLElement;
  sourceTitle?: HTMLElement;
  returnScrollTop: number;
}>;

export type RadioArchiveScreenProps = RadioArchivePlaybackProps &
  Readonly<{
    seriesId?: RadioSeriesId;
    onSelectSeries: (seriesId?: RadioSeriesId) => void | Promise<void>;
    onOpenShow: (request: RadioOpenShowRequest) => void | Promise<void>;
    openExternal?: (url: string) => Promise<void>;
    repository?: RadioQueryRepository;
    returningArtworkId?: RadioShowId;
    seriesTravelSteps?: number;
  }>;
