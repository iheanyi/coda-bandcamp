import type {
  LastFmPlaybackProgress,
  PlayerStateCheckpoint,
  PlayerStateInput,
  PlayerStateSnapshot,
  PlayerStateTrack,
  RadioScrobbleProgress,
  RepeatMode,
  ScrobbleState,
  Track,
} from "./types";

export const PLAYER_STATE_VERSION = 1 as const;
// Increment this when the native IPC shape gains fields while the persisted
// snapshot version remains backward compatible. The renderer uses it to avoid
// sending a newer shape to an older Rust process during Tauri dev rebuilds.
export const PLAYER_STATE_CONTRACT_VERSION = 2 as const;
export const MAX_PERSISTED_QUEUE_LENGTH = 25_000;
const PLAYER_STATE_VALIDATION_CHUNK_SIZE = 256;

const MAX_TEXT_LENGTH = 1_024;
const MAX_TRACK_SECONDS = 7 * 24 * 60 * 60;
const MAX_TRACK_NUMBER = 100_000;
const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;
const MAX_RADIO_SCROBBLED_CHAPTERS = 256;
const MAX_RADIO_CHAPTER_KEY_LENGTH = 128;

type PlayerStateBoundaryValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | PlayerStateBoundaryValue[]
  | PlayerStateBoundaryRecord;

type PlayerStateBoundaryRecord = {
  [key: string]: PlayerStateBoundaryValue;
};

type DecodedPlayerStateRecord = PlayerStateBoundaryRecord & {
  version: typeof PLAYER_STATE_VERSION;
  savedAt: number;
  queue: PlayerStateBoundaryValue[];
};

function isRecord<Value>(
  value: Value,
): value is Value & PlayerStateBoundaryRecord {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function isBoundaryArray<Value>(
  value: Value,
): value is Value & PlayerStateBoundaryValue[] {
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

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isBoundedText<Value>(
  value: Value,
  required = false,
): value is Value & string {
  return (
    isStringValue(value) &&
    value.length <= MAX_TEXT_LENGTH &&
    !hasControlCharacter(value) &&
    (!required || value.length > 0)
  );
}

function isNonNegativeInteger<Value>(value: Value): value is Value & number {
  return isNumberValue(value) && Number.isSafeInteger(value) && value >= 0;
}

function isAbsent<Value>(
  value: Value,
): value is Value & (null | undefined) {
  return value === undefined || value === null;
}

function isRadioChapterKey<Value>(
  value: Value,
): value is Value & string {
  return (
    isStringValue(value) &&
    value.length > 0 &&
    value.length <= MAX_RADIO_CHAPTER_KEY_LENGTH &&
    !hasControlCharacter(value)
  );
}

function isBoundedSeconds<Value>(value: Value): value is Value & number {
  return (
    isNumberValue(value) &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_TRACK_SECONDS
  );
}

function isPaletteColor<Value>(value: Value): value is Value & string {
  return (
    isStringValue(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    !hasControlCharacter(value)
  );
}

function parsePalette<Value>(value: Value): [string, string] | undefined {
  if (!isBoundaryArray(value) || value.length !== 2) return undefined;
  const [first, second] = value;
  if (
    !isPaletteColor(first) ||
    !isPaletteColor(second)
  ) {
    return undefined;
  }
  return [first, second];
}

function parseScrobbleState<Value>(value: Value): ScrobbleState | undefined {
  if (!isStringValue(value)) return undefined;
  switch (value) {
    case "idle":
      return "idle";
    case "pending":
      return "pending";
    case "sent":
      return "sent";
    case "failed":
      return "failed";
    default:
      return undefined;
  }
}

function parseRepeatMode<Value>(value: Value): RepeatMode | undefined {
  if (!isStringValue(value)) return undefined;
  if (value === "off") return "off";
  if (value === "all") return "all";
  if (value === "one") return "one";
  return undefined;
}

export function isEphemeralTrackId(id: string): boolean {
  return id.startsWith("discover:") || id.startsWith("daily:");
}

export function persistedQueueIndex(
  queue: readonly Track[],
  currentIndex: number,
): number {
  const lastIndex = Math.min(currentIndex, queue.length - 1);
  let persistedIndex = -1;
  for (let index = 0; index <= lastIndex; index += 1) {
    const item = queue[index];
    if (item && !isEphemeralTrackId(item.id)) persistedIndex += 1;
  }
  return persistedIndex;
}

export function normalizedReleaseTitle(title: string): string {
  return title === "Unknown release" ? "" : title;
}

function isInvalidRadioTrackId(id: string): boolean {
  return id.startsWith("radio:") && !/^radio:[1-9]\d{0,15}$/.test(id);
}

function parseTrack<Value>(value: Value): PlayerStateTrack | undefined {
  if (!isRecord(value)) return undefined;
  const palette = parsePalette(value.palette);
  const album =
    isStringValue(value.album)
      ? normalizedReleaseTitle(value.album)
      : value.album;
  if (
    !isBoundedText(value.id, true) ||
    isEphemeralTrackId(value.id) ||
    isInvalidRadioTrackId(value.id) ||
    !isBoundedText(value.title, true) ||
    !isBoundedText(value.artist, true) ||
    !isBoundedText(album) ||
    !isBoundedText(value.albumId, true) ||
    !isNonNegativeInteger(value.duration) ||
    value.duration > MAX_TRACK_SECONDS ||
    !isNonNegativeInteger(value.track) ||
    value.track > MAX_TRACK_NUMBER ||
    (!isAbsent(value.disc) &&
      (!isNonNegativeInteger(value.disc) || value.disc > MAX_TRACK_NUMBER)) ||
    (!isAbsent(value.coverArt) && !isBoundedText(value.coverArt)) ||
    !palette
  ) {
    return undefined;
  }

  const track: PlayerStateTrack = {
    id: value.id,
    title: value.title,
    artist: value.artist,
    album,
    albumId: value.albumId,
    duration: value.duration,
    track: value.track,
    palette,
  };
  if (!isAbsent(value.disc)) track.disc = value.disc;
  if (!isAbsent(value.coverArt)) track.coverArt = value.coverArt;
  return track;
}

function parseLastFmProgress<Value>(
  value: Value,
): LastFmPlaybackProgress | undefined {
  if (!isRecord(value)) return undefined;
  const scrobbleState = parseScrobbleState(value.scrobbleState);
  if (
    !isBoundedText(value.trackId, true) ||
    !isNonNegativeInteger(value.startedAt) ||
    value.startedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(value.listenedSeconds) ||
    !isBoundedSeconds(value.lastPosition) ||
    !isBooleanValue(value.nowPlayingSent) ||
    !scrobbleState
  ) {
    return undefined;
  }
  return {
    trackId: value.trackId,
    // A resumed session starts paused. On the next play event Coda establishes
    // a fresh Last.fm start time and sends a fresh Now Playing update.
    startedAt: 0,
    listenedSeconds: value.listenedSeconds,
    lastPosition: value.lastPosition,
    nowPlayingSent: false,
    // A request that was in flight at shutdown is treated as attempted. Retrying
    // it could create a duplicate scrobble if Last.fm accepted the first request.
    scrobbleState: scrobbleState === "pending"
      ? "sent"
      : scrobbleState,
  };
}

function parseRadioScrobbleProgress<Value>(
  value: Value,
): RadioScrobbleProgress | undefined {
  if (!isRecord(value)) return undefined;
  const activeChapterKey = isAbsent(value.activeChapterKey)
    ? undefined
    : value.activeChapterKey;
  const chapterScrobbleState = parseScrobbleState(
    value.chapterScrobbleState,
  );
  const showScrobbleState = parseScrobbleState(value.showScrobbleState);
  if (
    !isBoundedText(value.showTrackId, true) ||
    !/^radio:[1-9]\d{0,15}$/.test(value.showTrackId) ||
    (!isAbsent(activeChapterKey) && !isRadioChapterKey(activeChapterKey)) ||
    !isNonNegativeInteger(value.chapterStartedAt) ||
    value.chapterStartedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(value.chapterListenedSeconds) ||
    !isBoundedSeconds(value.lastPosition) ||
    !isBooleanValue(value.chapterNowPlayingSent) ||
    !chapterScrobbleState ||
    !isNonNegativeInteger(value.showStartedAt) ||
    value.showStartedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(value.showListenedSeconds) ||
    !showScrobbleState ||
    !isBoundaryArray(value.scrobbledChapterKeys) ||
    value.scrobbledChapterKeys.length > MAX_RADIO_SCROBBLED_CHAPTERS ||
    !value.scrobbledChapterKeys.every(isRadioChapterKey)
  ) {
    return undefined;
  }

  const pendingChapterWasAttempted =
    value.chapterScrobbleState === "pending" && activeChapterKey;
  const scrobbledChapterKeys = [
    ...new Set([
      ...value.scrobbledChapterKeys,
      ...(pendingChapterWasAttempted ? [pendingChapterWasAttempted] : []),
    ]),
  ].slice(-MAX_RADIO_SCROBBLED_CHAPTERS);

  const progress: RadioScrobbleProgress = {
    showTrackId: value.showTrackId,
    // Restored sessions start paused. New playback establishes fresh Last.fm
    // timestamps while retaining genuine listening time and dedupe markers.
    chapterStartedAt: 0,
    chapterListenedSeconds: value.chapterListenedSeconds,
    lastPosition: value.lastPosition,
    chapterNowPlayingSent: false,
    chapterScrobbleState: chapterScrobbleState === "pending"
      ? "sent"
      : chapterScrobbleState,
    showStartedAt: 0,
    showListenedSeconds: value.showListenedSeconds,
    showScrobbleState: showScrobbleState === "pending"
      ? "sent"
      : showScrobbleState,
    scrobbledChapterKeys,
  };
  if (activeChapterKey) progress.activeChapterKey = activeChapterKey;
  return progress;
}

function queuePositionIsValid(
  queue: PlayerStateTrack[],
  currentIndex: number,
  positionSeconds: number,
): boolean {
  if (!isNonNegativeInteger(currentIndex) || !isBoundedSeconds(positionSeconds)) return false;
  return queue.length === 0
    ? currentIndex === 0 && positionSeconds === 0
    : currentIndex < queue.length;
}

export type PlayerStateYield = () => Promise<void>;

/**
 * Yield through the browser task queue so input, playback, and painting can run
 * between bounded player-state validation chunks.
 */
export function yieldPlayerStateValidation(): Promise<void> {
  if (globalThis.MessageChannel instanceof Function) {
    return new Promise((resolve) => {
      const channel = new globalThis.MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function playerStateRecord<Value>(
  value: Value,
): DecodedPlayerStateRecord | undefined {
  if (!isRecord(value) || value.version !== PLAYER_STATE_VERSION) return undefined;
  if (
    !isNonNegativeInteger(value.savedAt) ||
    value.savedAt > MAX_TIMESTAMP_MS ||
    !isBoundaryArray(value.queue) ||
    value.queue.length > MAX_PERSISTED_QUEUE_LENGTH
  ) {
    return undefined;
  }
  return {
    version: PLAYER_STATE_VERSION,
    savedAt: value.savedAt,
    queue: value.queue,
    currentIndex: value.currentIndex,
    positionSeconds: value.positionSeconds,
    volume: value.volume,
    repeatMode: value.repeatMode,
    queueOpen: value.queueOpen,
    lastFmProgress: value.lastFmProgress,
    radioScrobbleProgress: value.radioScrobbleProgress,
  };
}

function finishPlayerState(
  value: DecodedPlayerStateRecord,
  tracks: PlayerStateTrack[],
): PlayerStateSnapshot | undefined {
  if (
    !isNonNegativeInteger(value.currentIndex) ||
    !isBoundedSeconds(value.positionSeconds) ||
    !queuePositionIsValid(tracks, value.currentIndex, value.positionSeconds)
  ) {
    return undefined;
  }
  const repeatMode = parseRepeatMode(value.repeatMode);
  if (
    !isNumberValue(value.volume) ||
    !Number.isFinite(value.volume) ||
    value.volume < 0 ||
    value.volume > 1 ||
    !repeatMode ||
    !isBooleanValue(value.queueOpen)
  ) {
    return undefined;
  }

  const lastFmProgressAbsent = isAbsent(value.lastFmProgress);
  const radioScrobbleProgressAbsent = isAbsent(value.radioScrobbleProgress);
  const lastFmProgress = lastFmProgressAbsent
    ? undefined
    : parseLastFmProgress(value.lastFmProgress);
  const radioScrobbleProgress = radioScrobbleProgressAbsent
    ? undefined
    : parseRadioScrobbleProgress(value.radioScrobbleProgress);
  const currentTrack = tracks[value.currentIndex];
  if (
    !lastFmProgressAbsent &&
    (!lastFmProgress ||
      tracks.length === 0 ||
      currentTrack?.id.startsWith("radio:") ||
      lastFmProgress.trackId !== currentTrack?.id)
  ) {
    return undefined;
  }
  if (
    !radioScrobbleProgressAbsent &&
    (!radioScrobbleProgress ||
      tracks.length === 0 ||
      !currentTrack?.id.startsWith("radio:") ||
      radioScrobbleProgress.showTrackId !== currentTrack.id)
  ) {
    return undefined;
  }
  if (lastFmProgress && radioScrobbleProgress) return undefined;

  const snapshot: PlayerStateSnapshot = {
    version: PLAYER_STATE_VERSION,
    savedAt: value.savedAt,
    queue: tracks,
    currentIndex: value.currentIndex,
    positionSeconds: value.positionSeconds,
    volume: value.volume,
    repeatMode,
    queueOpen: value.queueOpen,
  };
  if (lastFmProgress) snapshot.lastFmProgress = lastFmProgress;
  if (radioScrobbleProgress) {
    snapshot.radioScrobbleProgress = radioScrobbleProgress;
  }
  return snapshot;
}

async function parseQueueAsync(
  queue: PlayerStateBoundaryValue[],
  yieldControl: PlayerStateYield,
): Promise<PlayerStateTrack[] | undefined> {
  const tracks: PlayerStateTrack[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const track = parseTrack(queue[index]);
    if (!track) return undefined;
    tracks.push(track);
    if (
      (index + 1) % PLAYER_STATE_VALIDATION_CHUNK_SIZE === 0 &&
      index + 1 < queue.length
    ) {
      await yieldControl();
    }
  }
  return tracks;
}

type PreparedPlayerStateQueue = {
  queue: PlayerStateTrack[];
  retainedThroughCurrent: number;
  currentWasOmitted: boolean;
};

function assertCreatablePlayerState(input: PlayerStateInput): void {
  if (
    !Array.isArray(input.queue) ||
    input.queue.length > MAX_PERSISTED_QUEUE_LENGTH ||
    !queuePositionIsValid(
      input.queue,
      input.currentIndex,
      input.positionSeconds,
    )
  ) {
    throw new Error("The player state is invalid and was not saved.");
  }
}

function appendPreparedPlayerStateTrack(
  prepared: PreparedPlayerStateQueue,
  candidate: Track,
  index: number,
  currentIndex: number,
): void {
  const ephemeral =
    isRecord(candidate) &&
    isStringValue(candidate.id) &&
    isEphemeralTrackId(candidate.id);
  const parsedTrack = parseTrack(
    ephemeral
      ? { ...candidate, id: `persistable:${candidate.id}` }
      : candidate,
  );
  if (!parsedTrack) {
    throw new Error("The player state is invalid and was not saved.");
  }
  if (!ephemeral) prepared.queue.push(parsedTrack);
  if (index <= currentIndex && !ephemeral) prepared.retainedThroughCurrent += 1;
  if (index === currentIndex) prepared.currentWasOmitted = ephemeral;
}

function finishCreatedPlayerState(
  input: PlayerStateInput,
  now: number,
  prepared: PreparedPlayerStateQueue,
): PlayerStateSnapshot {
  const { queue, retainedThroughCurrent, currentWasOmitted } = prepared;
  const currentIndex = queue.length === 0
    ? 0
    : currentWasOmitted
      ? Math.min(retainedThroughCurrent, queue.length - 1)
      : retainedThroughCurrent - 1;
  const candidate = playerStateRecord({
    ...input,
    queue,
    currentIndex,
    positionSeconds: queue.length === 0 || currentWasOmitted ? 0 : input.positionSeconds,
    lastFmProgress: currentWasOmitted ? undefined : input.lastFmProgress,
    radioScrobbleProgress: currentWasOmitted ? undefined : input.radioScrobbleProgress,
    version: PLAYER_STATE_VERSION,
    savedAt: now,
  });
  const parsed = candidate ? finishPlayerState(candidate, queue) : undefined;
  if (!parsed) throw new Error("The player state is invalid and was not saved.");
  return parsed;
}

export function createPlayerState(input: PlayerStateInput, now = Date.now()): PlayerStateSnapshot {
  assertCreatablePlayerState(input);
  const prepared: PreparedPlayerStateQueue = {
    queue: [],
    retainedThroughCurrent: 0,
    currentWasOmitted: false,
  };
  input.queue.forEach((candidate, index) => {
    appendPreparedPlayerStateTrack(prepared, candidate, index, input.currentIndex);
  });
  return finishCreatedPlayerState(input, now, prepared);
}

export async function createPlayerStateAsync(
  input: PlayerStateInput,
  now = Date.now(),
  yieldControl: PlayerStateYield = yieldPlayerStateValidation,
): Promise<PlayerStateSnapshot> {
  assertCreatablePlayerState(input);
  const prepared: PreparedPlayerStateQueue = {
    queue: [],
    retainedThroughCurrent: 0,
    currentWasOmitted: false,
  };
  for (let index = 0; index < input.queue.length; index += 1) {
    appendPreparedPlayerStateTrack(
      prepared,
      input.queue[index],
      index,
      input.currentIndex,
    );
    if (
      (index + 1) % PLAYER_STATE_VALIDATION_CHUNK_SIZE === 0 &&
      index + 1 < input.queue.length
    ) {
      await yieldControl();
    }
  }
  return finishCreatedPlayerState(input, now, prepared);
}

export function parsePlayerState<Value>(
  value: Value,
): PlayerStateSnapshot | undefined {
  const record = playerStateRecord(value);
  if (!record) return undefined;
  const tracks: PlayerStateTrack[] = [];
  for (const candidate of record.queue) {
    const track = parseTrack(candidate);
    if (!track) return undefined;
    tracks.push(track);
  }
  return finishPlayerState(record, tracks);
}

export async function parsePlayerStateAsync<Value>(
  value: Value,
  yieldControl: PlayerStateYield = yieldPlayerStateValidation,
): Promise<PlayerStateSnapshot | undefined> {
  const record = playerStateRecord(value);
  if (!record) return undefined;
  const tracks = await parseQueueAsync(record.queue, yieldControl);
  return tracks ? finishPlayerState(record, tracks) : undefined;
}

export function createPlayerStateCheckpoint(
  input: PlayerStateCheckpoint,
): PlayerStateCheckpoint {
  if (
    !isNonNegativeInteger(input.currentIndex) ||
    !isBoundedText(input.currentTrackId, true) ||
    !isBoundedSeconds(input.positionSeconds)
  ) {
    throw new Error("The player checkpoint is invalid and was not saved.");
  }
  const lastFmProgress =
    input.lastFmProgress === undefined ? undefined : parseLastFmProgress(input.lastFmProgress);
  const radioScrobbleProgress =
    input.radioScrobbleProgress === undefined
      ? undefined
      : parseRadioScrobbleProgress(input.radioScrobbleProgress);
  if (
    input.lastFmProgress !== undefined &&
    (!lastFmProgress ||
      input.currentTrackId.startsWith("radio:") ||
      lastFmProgress.trackId !== input.currentTrackId)
  ) {
    throw new Error("The player checkpoint is invalid and was not saved.");
  }
  if (
    input.radioScrobbleProgress !== undefined &&
    (!radioScrobbleProgress ||
      !input.currentTrackId.startsWith("radio:") ||
      radioScrobbleProgress.showTrackId !== input.currentTrackId)
  ) {
    throw new Error("The player checkpoint is invalid and was not saved.");
  }
  if (lastFmProgress && radioScrobbleProgress) {
    throw new Error("The player checkpoint is invalid and was not saved.");
  }
  const checkpoint: PlayerStateCheckpoint = {
    currentIndex: input.currentIndex,
    currentTrackId: input.currentTrackId,
    positionSeconds: input.positionSeconds,
  };
  if (lastFmProgress) checkpoint.lastFmProgress = lastFmProgress;
  if (radioScrobbleProgress) {
    checkpoint.radioScrobbleProgress = radioScrobbleProgress;
  }
  return checkpoint;
}
