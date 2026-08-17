import {
  copyOwnDataArray,
  hasControlCharacter,
  INVALID_OWN_DATA_PROPERTY,
  isAbsent,
  isBooleanValue,
  isNumberValue,
  isStringValue,
  MISSING_OWN_DATA_PROPERTY,
  ownDataArrayLength,
  ownDataProperty,
  projectOwnDataRecord,
  type OwnDataValue,
} from "./ownData";
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

function isBoundedText(
  value: OwnDataValue,
  required = false,
): value is string {
  return (
    isStringValue(value) &&
    value.length <= MAX_TEXT_LENGTH &&
    !hasControlCharacter(value) &&
    (!required || value.length > 0)
  );
}

function isNonNegativeInteger(value: OwnDataValue): value is number {
  return isNumberValue(value) && Number.isSafeInteger(value) && value >= 0;
}

function isRadioChapterKey(value: OwnDataValue): value is string {
  return (
    isStringValue(value) &&
    value.length > 0 &&
    value.length <= MAX_RADIO_CHAPTER_KEY_LENGTH &&
    !hasControlCharacter(value)
  );
}

function isBoundedSeconds(value: OwnDataValue): value is number {
  return (
    isNumberValue(value) &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_TRACK_SECONDS
  );
}

function isPaletteColor(value: OwnDataValue): value is string {
  return (
    isStringValue(value) &&
    value.length > 0 &&
    value.length <= 64 &&
    !hasControlCharacter(value)
  );
}

function parsePalette(value: OwnDataValue): [string, string] | undefined {
  const colors = copyOwnDataArray(value, 2);
  if (colors === undefined || colors.length !== 2) return undefined;
  const [first, second] = colors;
  if (
    !isPaletteColor(first) ||
    !isPaletteColor(second)
  ) {
    return undefined;
  }
  return [first, second];
}

function parseScrobbleState(value: OwnDataValue): ScrobbleState | undefined {
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

function parseRepeatMode(value: OwnDataValue): RepeatMode | undefined {
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

function parseTrack(value: OwnDataValue): PlayerStateTrack | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const palette = parsePalette(record.palette);
  const album = isStringValue(record.album)
    ? normalizedReleaseTitle(record.album)
    : record.album;
  const disc = record.disc;
  const coverArt = record.coverArt;
  if (
    !isBoundedText(record.id, true) ||
    isEphemeralTrackId(record.id) ||
    isInvalidRadioTrackId(record.id) ||
    !isBoundedText(record.title, true) ||
    !isBoundedText(record.artist, true) ||
    !isBoundedText(album) ||
    !isBoundedText(record.albumId, true) ||
    !isNonNegativeInteger(record.duration) ||
    record.duration > MAX_TRACK_SECONDS ||
    !isNonNegativeInteger(record.track) ||
    record.track > MAX_TRACK_NUMBER ||
    (!isAbsent(disc) &&
      (!isNonNegativeInteger(disc) || disc > MAX_TRACK_NUMBER)) ||
    (!isAbsent(coverArt) && !isBoundedText(coverArt)) ||
    !palette
  ) {
    return undefined;
  }

  const track: PlayerStateTrack = {
    id: record.id,
    title: record.title,
    artist: record.artist,
    album,
    albumId: record.albumId,
    duration: record.duration,
    track: record.track,
    palette,
  };
  if (!isAbsent(disc)) track.disc = disc;
  if (!isAbsent(coverArt)) track.coverArt = coverArt;
  return track;
}

function parseLastFmProgress(
  value: OwnDataValue,
): LastFmPlaybackProgress | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const scrobbleState = parseScrobbleState(record.scrobbleState);
  if (
    !isBoundedText(record.trackId, true) ||
    !isNonNegativeInteger(record.startedAt) ||
    record.startedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(record.listenedSeconds) ||
    !isBoundedSeconds(record.lastPosition) ||
    !isBooleanValue(record.nowPlayingSent) ||
    !scrobbleState
  ) {
    return undefined;
  }
  return {
    trackId: record.trackId,
    // A resumed session starts paused. On the next play event Coda establishes
    // a fresh Last.fm start time and sends a fresh Now Playing update.
    startedAt: 0,
    listenedSeconds: record.listenedSeconds,
    lastPosition: record.lastPosition,
    nowPlayingSent: false,
    // A request that was in flight at shutdown is treated as attempted. Retrying
    // it could create a duplicate scrobble if Last.fm accepted the first request.
    scrobbleState: scrobbleState === "pending"
      ? "sent"
      : scrobbleState,
  };
}

function parseRadioChapterKeys(value: OwnDataValue): string[] | undefined {
  const entries = copyOwnDataArray(value, MAX_RADIO_SCROBBLED_CHAPTERS);
  if (entries === undefined) return undefined;
  const keys: string[] = [];
  for (const candidate of entries) {
    if (!isRadioChapterKey(candidate)) return undefined;
    keys.push(candidate);
  }
  return keys;
}

function parseRadioScrobbleProgress(
  value: OwnDataValue,
): RadioScrobbleProgress | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const activeChapterKeyValue = record.activeChapterKey;
  const activeChapterKey = isAbsent(activeChapterKeyValue)
    ? undefined
    : activeChapterKeyValue;
  const chapterScrobbleState = parseScrobbleState(
    record.chapterScrobbleState,
  );
  const showScrobbleState = parseScrobbleState(record.showScrobbleState);
  const scrobbledChapterKeys = parseRadioChapterKeys(
    record.scrobbledChapterKeys,
  );
  if (
    !isBoundedText(record.showTrackId, true) ||
    !/^radio:[1-9]\d{0,15}$/.test(record.showTrackId) ||
    (!isAbsent(activeChapterKey) && !isRadioChapterKey(activeChapterKey)) ||
    !isNonNegativeInteger(record.chapterStartedAt) ||
    record.chapterStartedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(record.chapterListenedSeconds) ||
    !isBoundedSeconds(record.lastPosition) ||
    !isBooleanValue(record.chapterNowPlayingSent) ||
    !chapterScrobbleState ||
    !isNonNegativeInteger(record.showStartedAt) ||
    record.showStartedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(record.showListenedSeconds) ||
    !showScrobbleState ||
    !scrobbledChapterKeys
  ) {
    return undefined;
  }

  const pendingChapterWasAttempted =
    chapterScrobbleState === "pending" && activeChapterKey;
  const restoredChapterKeys = [
    ...new Set([
      ...scrobbledChapterKeys,
      ...(pendingChapterWasAttempted ? [pendingChapterWasAttempted] : []),
    ]),
  ].slice(-MAX_RADIO_SCROBBLED_CHAPTERS);

  const progress: RadioScrobbleProgress = {
    showTrackId: record.showTrackId,
    // Restored sessions start paused. New playback establishes fresh Last.fm
    // timestamps while retaining genuine listening time and dedupe markers.
    chapterStartedAt: 0,
    chapterListenedSeconds: record.chapterListenedSeconds,
    lastPosition: record.lastPosition,
    chapterNowPlayingSent: false,
    chapterScrobbleState: chapterScrobbleState === "pending"
      ? "sent"
      : chapterScrobbleState,
    showStartedAt: 0,
    showListenedSeconds: record.showListenedSeconds,
    showScrobbleState: showScrobbleState === "pending"
      ? "sent"
      : showScrobbleState,
    scrobbledChapterKeys: restoredChapterKeys,
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
 * WebViews without MessageChannel (and tests that stub it with a non-callable
 * value) must fall back to the timeout task boundary, so feature detection
 * keeps the callability strictness of a `typeof` check.
 */
function isMessageChannelConstructor(
  value: typeof globalThis.MessageChannel,
): value is typeof globalThis.MessageChannel {
  return typeof value === "function";
}

/**
 * Yield through the browser task queue so input, playback, and painting can run
 * between bounded player-state validation chunks.
 */
export function yieldPlayerStateValidation(): Promise<void> {
  const channelConstructor = globalThis.MessageChannel;
  if (isMessageChannelConstructor(channelConstructor)) {
    return new Promise((resolve) => {
      const channel = new channelConstructor();
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

type ParsedPlayerStateEnvelope = {
  savedAt: number;
  queueSource: OwnDataValue;
  queueLength: number;
  currentIndex: number;
  positionSeconds: number;
  volume: number;
  repeatMode: RepeatMode;
  queueOpen: boolean;
  lastFmProgress?: LastFmPlaybackProgress;
  radioScrobbleProgress?: RadioScrobbleProgress;
};

function parsePlayerStateEnvelope<Value>(
  value: Value,
): ParsedPlayerStateEnvelope | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined || record.version !== PLAYER_STATE_VERSION) {
    return undefined;
  }
  const repeatMode = parseRepeatMode(record.repeatMode);
  const queueLength = ownDataArrayLength(
    record.queue,
    MAX_PERSISTED_QUEUE_LENGTH,
  );
  if (
    !isNonNegativeInteger(record.savedAt) ||
    record.savedAt > MAX_TIMESTAMP_MS ||
    queueLength === undefined ||
    !isNonNegativeInteger(record.currentIndex) ||
    !isBoundedSeconds(record.positionSeconds) ||
    !isNumberValue(record.volume) ||
    !Number.isFinite(record.volume) ||
    record.volume < 0 ||
    record.volume > 1 ||
    !repeatMode ||
    !isBooleanValue(record.queueOpen)
  ) {
    return undefined;
  }
  const lastFmProgressPayload = record.lastFmProgress;
  const radioScrobbleProgressPayload = record.radioScrobbleProgress;
  const lastFmProgress = isAbsent(lastFmProgressPayload)
    ? undefined
    : parseLastFmProgress(lastFmProgressPayload);
  const radioScrobbleProgress = isAbsent(radioScrobbleProgressPayload)
    ? undefined
    : parseRadioScrobbleProgress(radioScrobbleProgressPayload);
  if (
    (!isAbsent(lastFmProgressPayload) && !lastFmProgress) ||
    (!isAbsent(radioScrobbleProgressPayload) && !radioScrobbleProgress) ||
    (lastFmProgress && radioScrobbleProgress)
  ) {
    return undefined;
  }

  const parsed: ParsedPlayerStateEnvelope = {
    savedAt: record.savedAt,
    currentIndex: record.currentIndex,
    positionSeconds: record.positionSeconds,
    volume: record.volume,
    repeatMode,
    queueOpen: record.queueOpen,
    queueSource: record.queue,
    queueLength,
  };
  if (lastFmProgress) parsed.lastFmProgress = lastFmProgress;
  if (radioScrobbleProgress) {
    parsed.radioScrobbleProgress = radioScrobbleProgress;
  }
  return parsed;
}

function finishPlayerState(
  value: ParsedPlayerStateEnvelope,
  tracks: PlayerStateTrack[],
): PlayerStateSnapshot | undefined {
  if (!queuePositionIsValid(tracks, value.currentIndex, value.positionSeconds)) {
    return undefined;
  }

  const lastFmProgress = Object.hasOwn(value, "lastFmProgress")
    ? value.lastFmProgress
    : undefined;
  const radioScrobbleProgress = Object.hasOwn(value, "radioScrobbleProgress")
    ? value.radioScrobbleProgress
    : undefined;
  const currentTrack = tracks[value.currentIndex];
  if (
    lastFmProgress &&
    (tracks.length === 0 ||
      currentTrack?.id.startsWith("radio:") ||
      lastFmProgress.trackId !== currentTrack?.id)
  ) {
    return undefined;
  }
  if (
    radioScrobbleProgress &&
    (tracks.length === 0 ||
      !currentTrack?.id.startsWith("radio:") ||
      radioScrobbleProgress.showTrackId !== currentTrack.id)
  ) {
    return undefined;
  }
  const snapshot: PlayerStateSnapshot = {
    version: PLAYER_STATE_VERSION,
    savedAt: value.savedAt,
    queue: tracks,
    currentIndex: value.currentIndex,
    positionSeconds: value.positionSeconds,
    volume: value.volume,
    repeatMode: value.repeatMode,
    queueOpen: value.queueOpen,
  };
  if (lastFmProgress) snapshot.lastFmProgress = lastFmProgress;
  if (radioScrobbleProgress) {
    snapshot.radioScrobbleProgress = radioScrobbleProgress;
  }
  return snapshot;
}

function parseQueueEntry(
  queueSource: OwnDataValue,
  index: number,
): PlayerStateTrack | undefined {
  const entry = ownDataProperty(queueSource, index);
  if (
    entry === INVALID_OWN_DATA_PROPERTY ||
    entry === MISSING_OWN_DATA_PROPERTY
  ) {
    return undefined;
  }
  return parseTrack(entry);
}

function parseQueueChunk(
  queueSource: OwnDataValue,
  tracks: PlayerStateTrack[],
  start: number,
  end: number,
): boolean {
  for (let index = start; index < end; index += 1) {
    const track = parseQueueEntry(queueSource, index);
    if (!track) return false;
    tracks[index] = track;
  }
  return true;
}

function parseQueue(
  queueSource: OwnDataValue,
  queueLength: number,
): PlayerStateTrack[] | undefined {
  const tracks: PlayerStateTrack[] = [];
  tracks.length = queueLength;
  return parseQueueChunk(queueSource, tracks, 0, queueLength)
    ? tracks
    : undefined;
}

async function parseQueueAsync(
  queueSource: OwnDataValue,
  queueLength: number,
  yieldControl: PlayerStateYield,
): Promise<PlayerStateTrack[] | undefined> {
  const tracks: PlayerStateTrack[] = [];
  tracks.length = queueLength;
  for (
    let start = 0;
    start < queueLength;
    start += PLAYER_STATE_VALIDATION_CHUNK_SIZE
  ) {
    const end = Math.min(
      start + PLAYER_STATE_VALIDATION_CHUNK_SIZE,
      queueLength,
    );
    if (!parseQueueChunk(queueSource, tracks, start, end)) return undefined;
    if (end < queueLength) await yieldControl();
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
  const record = projectOwnDataRecord(candidate);
  const candidateId = record === undefined ? undefined : record.id;
  const ephemeral =
    isStringValue(candidateId) && isEphemeralTrackId(candidateId);
  const parsedTrack = parseTrack(
    ephemeral && record !== undefined
      ? { ...record, id: `persistable:${candidateId}` }
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
  const candidate = parsePlayerStateEnvelope({
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
  const parsed = parsePlayerStateEnvelope(value);
  if (!parsed) return undefined;
  const tracks = parseQueue(parsed.queueSource, parsed.queueLength);
  return tracks ? finishPlayerState(parsed, tracks) : undefined;
}

export async function parsePlayerStateAsync<Value>(
  value: Value,
  yieldControl: PlayerStateYield = yieldPlayerStateValidation,
): Promise<PlayerStateSnapshot | undefined> {
  const parsed = parsePlayerStateEnvelope(value);
  if (!parsed) return undefined;
  const tracks = await parseQueueAsync(
    parsed.queueSource,
    parsed.queueLength,
    yieldControl,
  );
  return tracks ? finishPlayerState(parsed, tracks) : undefined;
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
