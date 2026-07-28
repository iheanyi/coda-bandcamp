import { MAX_PLAYBACK_POSITION_SECONDS } from "./playbackClock";
import type { Track } from "./types";

export const MINI_PLAYER_STATE_EVENT = "coda://mini-player-state";
export const MINI_PLAYER_COMMAND_EVENT = "coda://mini-player-command";
export const MINI_PLAYER_REQUEST_STATE_EVENT = "coda://mini-player-request-state";

const MAX_MINI_PLAYER_TEXT_LENGTH = 512;
const MAX_ARTWORK_URL_LENGTH = 4_096;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export type MiniPlayerTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  palette: [string, string];
};

export type MiniPlayerSnapshot = {
  track?: MiniPlayerTrack;
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number;
  volume: number;
  canPrevious: boolean;
  canNext: boolean;
};

export type MiniPlayerCommand =
  | { type: "play-pause" }
  | { type: "previous" }
  | { type: "next" }
  | { type: "show-main" }
  | { type: "seek"; positionSeconds: number }
  | { type: "volume"; volume: number };

type MiniPlayerDisplay = {
  title?: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
};

type MiniPlayerSnapshotInput = Omit<
  MiniPlayerSnapshot,
  "track" | "positionSeconds" | "durationSeconds" | "volume"
> & {
  track?: Track;
  display?: MiniPlayerDisplay;
  positionSeconds: number;
  durationSeconds: number;
  volume: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value: unknown, allowEmpty = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_MINI_PLAYER_TEXT_LENGTH &&
    (allowEmpty || value.trim().length > 0) &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function boundedText(
  value: string | undefined,
  fallback: string,
  allowEmpty = false,
): string {
  const normalized = value?.trim();
  const source = normalized || fallback.trim();
  if (!source && allowEmpty) return "";
  return (source || "Unknown")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, MAX_MINI_PLAYER_TEXT_LENGTH);
}

function isArtworkUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > MAX_ARTWORK_URL_LENGTH) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function artworkUrl(value: string | undefined): string | undefined {
  return isArtworkUrl(value) ? value : undefined;
}

function boundedNumber(value: number, maximum: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(maximum, Math.max(0, value));
}

export function createMiniPlayerSnapshot(
  input: MiniPlayerSnapshotInput,
): MiniPlayerSnapshot {
  const durationSeconds = boundedNumber(
    input.durationSeconds,
    MAX_PLAYBACK_POSITION_SECONDS,
  );
  const positionSeconds = Math.min(
    durationSeconds,
    boundedNumber(input.positionSeconds, MAX_PLAYBACK_POSITION_SECONDS),
  );
  const track = input.track
    ? {
        id: boundedText(input.track.id, "unknown-track"),
        title: boundedText(input.display?.title, input.track.title),
        artist: boundedText(input.display?.artist, input.track.artist),
        album: boundedText(input.display?.album, input.track.album, true),
        artworkUrl: artworkUrl(
          input.display?.artworkUrl ?? input.track.artworkUrl,
        ),
        palette: [...input.track.palette] as [string, string],
      }
    : undefined;

  return {
    track,
    playing: Boolean(input.playing && track),
    positionSeconds,
    durationSeconds,
    volume: boundedNumber(input.volume, 1),
    canPrevious: Boolean(track && input.canPrevious),
    canNext: Boolean(track && input.canNext),
  };
}

function parseMiniPlayerTrack(value: unknown): MiniPlayerTrack | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isBoundedText(value.id) ||
    !isBoundedText(value.title) ||
    !isBoundedText(value.artist) ||
    !isBoundedText(value.album, true) ||
    (value.artworkUrl !== undefined && !isArtworkUrl(value.artworkUrl)) ||
    !Array.isArray(value.palette) ||
    value.palette.length !== 2 ||
    !value.palette.every((color) => typeof color === "string" && HEX_COLOR.test(color))
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    artist: value.artist,
    album: value.album,
    artworkUrl: value.artworkUrl,
    palette: [value.palette[0] as string, value.palette[1] as string],
  };
}

export function parseMiniPlayerSnapshot(
  value: unknown,
): MiniPlayerSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const track = value.track === undefined
    ? undefined
    : parseMiniPlayerTrack(value.track);
  if (
    (value.track !== undefined && !track) ||
    typeof value.playing !== "boolean" ||
    typeof value.positionSeconds !== "number" ||
    !Number.isFinite(value.positionSeconds) ||
    value.positionSeconds < 0 ||
    typeof value.durationSeconds !== "number" ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds < 0 ||
    value.durationSeconds > MAX_PLAYBACK_POSITION_SECONDS ||
    value.positionSeconds > value.durationSeconds ||
    typeof value.volume !== "number" ||
    !Number.isFinite(value.volume) ||
    value.volume < 0 ||
    value.volume > 1 ||
    typeof value.canPrevious !== "boolean" ||
    typeof value.canNext !== "boolean" ||
    (!track && (
      value.playing ||
      value.positionSeconds !== 0 ||
      value.canPrevious ||
      value.canNext
    ))
  ) {
    return undefined;
  }
  return {
    track,
    playing: value.playing,
    positionSeconds: value.positionSeconds,
    durationSeconds: value.durationSeconds,
    volume: value.volume,
    canPrevious: value.canPrevious,
    canNext: value.canNext,
  };
}

export function parseMiniPlayerCommand(
  value: unknown,
): MiniPlayerCommand | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (
    value.type === "play-pause" ||
    value.type === "previous" ||
    value.type === "next" ||
    value.type === "show-main"
  ) {
    return { type: value.type };
  }
  if (
    value.type === "seek" &&
    typeof value.positionSeconds === "number" &&
    Number.isFinite(value.positionSeconds) &&
    value.positionSeconds >= 0 &&
    value.positionSeconds <= MAX_PLAYBACK_POSITION_SECONDS
  ) {
    return { type: "seek", positionSeconds: value.positionSeconds };
  }
  if (
    value.type === "volume" &&
    typeof value.volume === "number" &&
    Number.isFinite(value.volume) &&
    value.volume >= 0 &&
    value.volume <= 1
  ) {
    return { type: "volume", volume: value.volume };
  }
  return undefined;
}
