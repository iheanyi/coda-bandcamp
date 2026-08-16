import { MAX_PLAYBACK_POSITION_SECONDS } from "./playbackClock";
import { normalizedReleaseTitle } from "./playerState";
import {
  isBooleanValue,
  isDataArray,
  isNumberValue,
  isOwnDataRecord,
  isStringValue,
  MISSING_OWN_DATA_PROPERTY,
  ownDataProperty,
  type OwnDataPropertyResult,
  type OwnDataValue,
} from "./ownData";
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

function isBoundedText(
  value: OwnDataPropertyResult,
  allowEmpty = false,
): value is string {
  return (
    typeof value === "string" &&
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

function isArtworkUrl(value: OwnDataPropertyResult): value is string {
  if (typeof value !== "string" || value.length > MAX_ARTWORK_URL_LENGTH) {
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

function parseMiniPlayerTrack(
  value: OwnDataPropertyResult,
): MiniPlayerTrack | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const id = ownDataProperty(value, "id");
  const title = ownDataProperty(value, "title");
  const artist = ownDataProperty(value, "artist");
  const album = ownDataProperty(value, "album");
  const artworkUrlValue = ownDataProperty(value, "artworkUrl");
  const artworkUrl = artworkUrlValue === MISSING_OWN_DATA_PROPERTY
    ? undefined
    : artworkUrlValue;
  const palette = ownDataProperty(value, "palette");
  if (!isDataArray(palette)) return undefined;
  const paletteLength = ownDataProperty(palette, "length");
  if (paletteLength !== 2) return undefined;
  const firstColor = ownDataProperty(palette, "0");
  const secondColor = ownDataProperty(palette, "1");
  if (
    !isBoundedText(id) ||
    !isBoundedText(title) ||
    !isBoundedText(artist) ||
    !isBoundedText(album, true) ||
    (artworkUrl !== undefined && !isArtworkUrl(artworkUrl)) ||
    !isStringValue(firstColor) ||
    !HEX_COLOR.test(firstColor) ||
    !isStringValue(secondColor) ||
    !HEX_COLOR.test(secondColor)
  ) {
    return undefined;
  }
  return {
    id,
    title,
    artist,
    album: normalizedReleaseTitle(album),
    artworkUrl,
    palette: [firstColor, secondColor],
  };
}

export function parseMiniPlayerSnapshot(
  value: OwnDataValue,
): MiniPlayerSnapshot | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const trackValue = ownDataProperty(value, "track");
  const trackPayload = trackValue === MISSING_OWN_DATA_PROPERTY
    ? undefined
    : trackValue;
  const track = trackPayload === undefined
    ? undefined
    : parseMiniPlayerTrack(trackPayload);
  const playing = ownDataProperty(value, "playing");
  const positionSeconds = ownDataProperty(value, "positionSeconds");
  const durationSeconds = ownDataProperty(value, "durationSeconds");
  const volume = ownDataProperty(value, "volume");
  const canPrevious = ownDataProperty(value, "canPrevious");
  const canNext = ownDataProperty(value, "canNext");
  if (
    (trackPayload !== undefined && !track) ||
    !isBooleanValue(playing) ||
    !isNumberValue(positionSeconds) ||
    !Number.isFinite(positionSeconds) ||
    positionSeconds < 0 ||
    !isNumberValue(durationSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0 ||
    durationSeconds > MAX_PLAYBACK_POSITION_SECONDS ||
    positionSeconds > durationSeconds ||
    !isNumberValue(volume) ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1 ||
    !isBooleanValue(canPrevious) ||
    !isBooleanValue(canNext) ||
    (!track && (
      playing ||
      positionSeconds !== 0 ||
      canPrevious ||
      canNext
    ))
  ) {
    return undefined;
  }
  return {
    track,
    playing,
    positionSeconds,
    durationSeconds,
    volume,
    canPrevious,
    canNext,
  };
}

export function parseMiniPlayerCommand(
  value: OwnDataValue,
): MiniPlayerCommand | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const type = ownDataProperty(value, "type");
  if (!isStringValue(type)) return undefined;
  if (type === "play-pause") return { type: "play-pause" };
  if (type === "previous") return { type: "previous" };
  if (type === "next") return { type: "next" };
  if (type === "show-main") return { type: "show-main" };
  const positionSeconds = ownDataProperty(value, "positionSeconds");
  if (
    type === "seek" &&
    isNumberValue(positionSeconds) &&
    Number.isFinite(positionSeconds) &&
    positionSeconds >= 0 &&
    positionSeconds <= MAX_PLAYBACK_POSITION_SECONDS
  ) {
    return { type: "seek", positionSeconds };
  }
  const volume = ownDataProperty(value, "volume");
  if (
    type === "volume" &&
    isNumberValue(volume) &&
    Number.isFinite(volume) &&
    volume >= 0 &&
    volume <= 1
  ) {
    return { type: "volume", volume };
  }
  return undefined;
}
