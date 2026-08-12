import type {
  LastFmPlaybackProgress,
  PlayerStateCheckpoint,
  PlayerStateInput,
  PlayerStateSnapshot,
  PlayerStateTrack,
  RadioScrobbleProgress,
  RepeatMode,
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
const REPEAT_MODES = new Set<RepeatMode>(["off", "all", "one"]);
const SCROBBLE_STATES = new Set(["idle", "pending", "sent", "failed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBoundedText(value: unknown, required = false): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_TEXT_LENGTH &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value) &&
    (!required || value.length > 0)
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isAbsent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function isRadioChapterKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_RADIO_CHAPTER_KEY_LENGTH &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
  );
}

function isBoundedSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_TRACK_SECONDS;
}

function parsePalette(value: unknown): [string, string] | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(
      (color) =>
        typeof color === "string" &&
        color.length > 0 &&
        color.length <= 64 &&
        !/[\u0000-\u001f\u007f-\u009f]/u.test(color),
    )
  ) {
    return undefined;
  }
  return [value[0], value[1]];
}

export function isEphemeralTrackId(id: string): boolean {
  return id.startsWith("discover:");
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

function parseTrack(value: unknown): PlayerStateTrack | undefined {
  if (!isRecord(value)) return undefined;
  const palette = parsePalette(value.palette);
  const album =
    typeof value.album === "string"
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

  return {
    id: value.id,
    title: value.title,
    artist: value.artist,
    album,
    albumId: value.albumId,
    duration: value.duration,
    track: value.track,
    ...(isAbsent(value.disc) ? {} : { disc: value.disc }),
    ...(isAbsent(value.coverArt) ? {} : { coverArt: value.coverArt }),
    palette,
  };
}

function parseLastFmProgress(value: unknown): LastFmPlaybackProgress | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !isBoundedText(value.trackId, true) ||
    !isNonNegativeInteger(value.startedAt) ||
    value.startedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(value.listenedSeconds) ||
    !isBoundedSeconds(value.lastPosition) ||
    typeof value.nowPlayingSent !== "boolean" ||
    typeof value.scrobbleState !== "string" ||
    !SCROBBLE_STATES.has(value.scrobbleState)
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
    scrobbleState: value.scrobbleState === "pending"
      ? "sent"
      : value.scrobbleState as LastFmPlaybackProgress["scrobbleState"],
  };
}

function parseRadioScrobbleProgress(value: unknown): RadioScrobbleProgress | undefined {
  if (!isRecord(value)) return undefined;
  const activeChapterKey = isAbsent(value.activeChapterKey)
    ? undefined
    : value.activeChapterKey;
  if (
    !isBoundedText(value.showTrackId, true) ||
    !/^radio:[1-9]\d{0,15}$/.test(value.showTrackId) ||
    (!isAbsent(activeChapterKey) && !isRadioChapterKey(activeChapterKey)) ||
    !isNonNegativeInteger(value.chapterStartedAt) ||
    value.chapterStartedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(value.chapterListenedSeconds) ||
    !isBoundedSeconds(value.lastPosition) ||
    typeof value.chapterNowPlayingSent !== "boolean" ||
    typeof value.chapterScrobbleState !== "string" ||
    !SCROBBLE_STATES.has(value.chapterScrobbleState) ||
    !isNonNegativeInteger(value.showStartedAt) ||
    value.showStartedAt > MAX_TIMESTAMP_MS / 1_000 ||
    !isBoundedSeconds(value.showListenedSeconds) ||
    typeof value.showScrobbleState !== "string" ||
    !SCROBBLE_STATES.has(value.showScrobbleState) ||
    !Array.isArray(value.scrobbledChapterKeys) ||
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

  return {
    showTrackId: value.showTrackId,
    ...(activeChapterKey ? { activeChapterKey } : {}),
    // Restored sessions start paused. New playback establishes fresh Last.fm
    // timestamps while retaining genuine listening time and dedupe markers.
    chapterStartedAt: 0,
    chapterListenedSeconds: value.chapterListenedSeconds,
    lastPosition: value.lastPosition,
    chapterNowPlayingSent: false,
    chapterScrobbleState: value.chapterScrobbleState === "pending"
      ? "sent"
      : value.chapterScrobbleState as RadioScrobbleProgress["chapterScrobbleState"],
    showStartedAt: 0,
    showListenedSeconds: value.showListenedSeconds,
    showScrobbleState: value.showScrobbleState === "pending"
      ? "sent"
      : value.showScrobbleState as RadioScrobbleProgress["showScrobbleState"],
    scrobbledChapterKeys,
  };
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
  if (typeof MessageChannel !== "undefined") {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
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

function playerStateRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || value.version !== PLAYER_STATE_VERSION) return undefined;
  if (
    !isNonNegativeInteger(value.savedAt) ||
    value.savedAt > MAX_TIMESTAMP_MS ||
    !Array.isArray(value.queue) ||
    value.queue.length > MAX_PERSISTED_QUEUE_LENGTH
  ) {
    return undefined;
  }
  return value;
}

function finishPlayerState(
  value: Record<string, unknown>,
  tracks: PlayerStateTrack[],
): PlayerStateSnapshot | undefined {
  if (!queuePositionIsValid(tracks, value.currentIndex as number, value.positionSeconds as number)) {
    return undefined;
  }
  if (
    typeof value.volume !== "number" ||
    !Number.isFinite(value.volume) ||
    value.volume < 0 ||
    value.volume > 1 ||
    typeof value.repeatMode !== "string" ||
    !REPEAT_MODES.has(value.repeatMode as RepeatMode) ||
    typeof value.queueOpen !== "boolean"
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
  const currentTrack = tracks[value.currentIndex as number];
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

  return {
    version: PLAYER_STATE_VERSION,
    savedAt: value.savedAt as number,
    queue: tracks,
    currentIndex: value.currentIndex as number,
    positionSeconds: value.positionSeconds as number,
    volume: value.volume,
    repeatMode: value.repeatMode as RepeatMode,
    queueOpen: value.queueOpen,
    ...(lastFmProgress ? { lastFmProgress } : {}),
    ...(radioScrobbleProgress ? { radioScrobbleProgress } : {}),
  };
}

async function parseQueueAsync(
  queue: unknown[],
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
  candidate: unknown,
  index: number,
  currentIndex: number,
): void {
  const ephemeral =
    isRecord(candidate) &&
    typeof candidate.id === "string" &&
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

export function parsePlayerState(value: unknown): PlayerStateSnapshot | undefined {
  const record = playerStateRecord(value);
  if (!record) return undefined;
  const queue = (record.queue as unknown[]).map(parseTrack);
  if (queue.some((track) => !track)) return undefined;
  const tracks = queue as PlayerStateTrack[];
  return finishPlayerState(record, tracks);
}

export async function parsePlayerStateAsync(
  value: unknown,
  yieldControl: PlayerStateYield = yieldPlayerStateValidation,
): Promise<PlayerStateSnapshot | undefined> {
  const record = playerStateRecord(value);
  if (!record) return undefined;
  const tracks = await parseQueueAsync(record.queue as unknown[], yieldControl);
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
  return {
    currentIndex: input.currentIndex,
    currentTrackId: input.currentTrackId,
    positionSeconds: input.positionSeconds,
    ...(lastFmProgress ? { lastFmProgress } : {}),
    ...(radioScrobbleProgress ? { radioScrobbleProgress } : {}),
  };
}
