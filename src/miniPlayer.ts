import { MAX_PLAYBACK_POSITION_SECONDS } from "./playbackClock";
import { normalizedReleaseTitle } from "./playerState";
import type { Track } from "./types";

export const MINI_PLAYER_STATE_EVENT = "coda://mini-player-state";
export const MINI_PLAYER_COMMAND_EVENT = "coda://mini-player-command";
export const MINI_PLAYER_REQUEST_STATE_EVENT = "coda://mini-player-request-state";

const MAX_MINI_PLAYER_TEXT_LENGTH = 512;
const MAX_ARTWORK_URL_LENGTH = 4_096;
const MAX_COVER_ART_ID_BYTES = 512;
const MAX_COVER_ART_REVISION_LENGTH = 128;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COVER_ART_REVISION = /^[a-z0-9_-]+$/i;
const COVER_ART_SESSION_SCOPE = /^[a-f0-9]{32}$/;

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

export type MiniPlayerWireValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | MiniPlayerWireValue[]
  | MiniPlayerWireRecord;

type MiniPlayerWireRecord = {
  [key: string]: MiniPlayerWireValue;
};

function isRecord<Value>(value: Value): value is Value & MiniPlayerWireRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isWireArray<Value>(
  value: Value,
): value is Value & MiniPlayerWireValue[] {
  return Array.isArray(value);
}

function isStringValue<Value>(value: Value): value is Value & string {
  return (
    Object.prototype.toString.call(value) === "[object String]" &&
    Object(value) !== value
  );
}

function isNumberValue<Value>(value: Value): value is Value & number {
  return (
    Object.prototype.toString.call(value) === "[object Number]" &&
    Object(value) !== value
  );
}

function isBooleanValue<Value>(value: Value): value is Value & boolean {
  return (
    Object.prototype.toString.call(value) === "[object Boolean]" &&
    Object(value) !== value
  );
}

function hasMiniPlayerControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function replaceMiniPlayerControlCharacters(value: string): string {
  let sanitized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    sanitized += code <= 0x1f || code === 0x7f ? " " : character;
  }
  return sanitized;
}

function isBoundedText<Value>(
  value: Value,
  allowEmpty = false,
): value is Value & string {
  return (
    isStringValue(value) &&
    value.length <= MAX_MINI_PLAYER_TEXT_LENGTH &&
    (allowEmpty || value.trim().length > 0) &&
    !hasMiniPlayerControlCharacter(value)
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
  return replaceMiniPlayerControlCharacters(source || "Unknown").slice(
    0,
    MAX_MINI_PLAYER_TEXT_LENGTH,
  );
}

function isArtworkUrl<Value>(value: Value): value is Value & string {
  if (!isStringValue(value) || value.length > MAX_ARTWORK_URL_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    const allowedOrigin =
      (url.protocol === "coda-cover:" && url.hostname === "localhost") ||
      (url.protocol === "http:" && url.hostname === "coda-cover.localhost");
    if (
      !allowedOrigin ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return false;
    }
    const prefix = "/v1/600/";
    if (!url.pathname.startsWith(prefix)) return false;
    const encodedCoverArtId = url.pathname.slice(prefix.length);
    if (!encodedCoverArtId || encodedCoverArtId.includes("/")) return false;
    let coverArtId: string;
    try {
      coverArtId = decodeURIComponent(encodedCoverArtId);
    } catch {
      return false;
    }
    if (
      encodeURIComponent(coverArtId) !== encodedCoverArtId ||
      new TextEncoder().encode(coverArtId).length > MAX_COVER_ART_ID_BYTES ||
      coverArtId.trim() !== coverArtId ||
      Array.from(coverArtId).some((character) => /\p{Cc}/u.test(character))
    ) {
      return false;
    }
    const revisionValues = url.searchParams.getAll("v");
    const scopeValues = url.searchParams.getAll("s");
    return (
      [...url.searchParams.keys()].length === 2 &&
      revisionValues.length === 1 &&
      scopeValues.length === 1 &&
      revisionValues[0].length <= MAX_COVER_ART_REVISION_LENGTH &&
      COVER_ART_REVISION.test(revisionValues[0]) &&
      COVER_ART_SESSION_SCOPE.test(scopeValues[0])
    );
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
  const track: MiniPlayerTrack | undefined = input.track
    ? {
        id: boundedText(input.track.id, "unknown-track"),
        title: boundedText(input.display?.title, input.track.title),
        artist: boundedText(input.display?.artist, input.track.artist),
        album: normalizedReleaseTitle(
          boundedText(input.display?.album, input.track.album, true),
        ),
        artworkUrl: artworkUrl(
          input.display?.artworkUrl ?? input.track.artworkUrl,
        ),
        palette: [input.track.palette[0], input.track.palette[1]],
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

function parseMiniPlayerTrack<Value>(
  value: Value,
): MiniPlayerTrack | undefined {
  if (!isRecord(value)) return undefined;
  const palette = isWireArray(value.palette) && value.palette.length === 2
    ? value.palette
    : undefined;
  const firstColor = palette?.[0];
  const secondColor = palette?.[1];
  if (
    !isBoundedText(value.id) ||
    !isBoundedText(value.title) ||
    !isBoundedText(value.artist) ||
    !isBoundedText(value.album, true) ||
    (value.artworkUrl !== undefined && !isArtworkUrl(value.artworkUrl)) ||
    !isStringValue(firstColor) ||
    !HEX_COLOR.test(firstColor) ||
    !isStringValue(secondColor) ||
    !HEX_COLOR.test(secondColor)
  ) {
    return undefined;
  }
  return {
    id: value.id,
    title: value.title,
    artist: value.artist,
    album: normalizedReleaseTitle(value.album),
    artworkUrl: value.artworkUrl,
    palette: [firstColor, secondColor],
  };
}

export function parseMiniPlayerSnapshot<Value>(
  value: Value,
): MiniPlayerSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const track = value.track === undefined
    ? undefined
    : parseMiniPlayerTrack(value.track);
  if (
    (value.track !== undefined && !track) ||
    !isBooleanValue(value.playing) ||
    !isNumberValue(value.positionSeconds) ||
    !Number.isFinite(value.positionSeconds) ||
    value.positionSeconds < 0 ||
    !isNumberValue(value.durationSeconds) ||
    !Number.isFinite(value.durationSeconds) ||
    value.durationSeconds < 0 ||
    value.durationSeconds > MAX_PLAYBACK_POSITION_SECONDS ||
    value.positionSeconds > value.durationSeconds ||
    !isNumberValue(value.volume) ||
    !Number.isFinite(value.volume) ||
    value.volume < 0 ||
    value.volume > 1 ||
    !isBooleanValue(value.canPrevious) ||
    !isBooleanValue(value.canNext) ||
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

export function parseMiniPlayerCommand<Value>(
  value: Value,
): MiniPlayerCommand | undefined {
  if (!isRecord(value) || !isStringValue(value.type)) return undefined;
  if (
    value.type === "play-pause"
  ) {
    return { type: "play-pause" };
  }
  if (value.type === "previous") return { type: "previous" };
  if (value.type === "next") return { type: "next" };
  if (value.type === "show-main") return { type: "show-main" };
  if (
    value.type === "seek" &&
    isNumberValue(value.positionSeconds) &&
    Number.isFinite(value.positionSeconds) &&
    value.positionSeconds >= 0 &&
    value.positionSeconds <= MAX_PLAYBACK_POSITION_SECONDS
  ) {
    return { type: "seek", positionSeconds: value.positionSeconds };
  }
  if (
    value.type === "volume" &&
    isNumberValue(value.volume) &&
    Number.isFinite(value.volume) &&
    value.volume >= 0 &&
    value.volume <= 1
  ) {
    return { type: "volume", volume: value.volume };
  }
  return undefined;
}
