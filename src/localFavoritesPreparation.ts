import {
  createLocalFavoritesSnapshot,
  localTrackStarIndexAndRadio,
  LOCAL_FAVORITES_VERSION,
  MAX_FAVORITE_ALBUMS,
  MAX_FAVORITE_RADIO_SHOWS,
  MAX_FAVORITE_TRACKS,
  MAX_LOCAL_FAVORITES_BYTES,
  parseLocalFavoritesSerialized,
  sanitizeLocalFavorites,
  type LocalFavoritesSnapshot,
} from "./localFavorites";
import { parseLibraryDate } from "./libraryDates";
import {
  copyOwnDataArray,
  hasControlCharacter,
  isDataArray,
  isNumberValue,
  isStringValue,
  projectOwnDataRecord,
  type OwnDataRecord,
  type OwnDataValue,
} from "./ownData";
import type { LocalFavoriteCollection } from "./types";

export type PreparedLocalFavorites = {
  favorites: LocalFavoriteCollection;
  serialized: string;
};

export type LocalFavoritesWorkerPreparedResult = {
  serialized: string;
  favorites?: LocalFavoriteCollection;
};

export type LocalFavoritesPreparationRequest =
  | {
      kind: "parse-local-favorites";
      requestId: number;
      serialized: string;
    }
  | {
      kind: "serialize-local-favorites";
      requestId: number;
      favorites: LocalFavoriteCollection;
    };

export class ValidatedLocalFavorites {
  private constructor(
    readonly collection: LocalFavoriteCollection,
  ) {}

  static parse(
    value: OwnDataValue,
  ): ValidatedLocalFavorites | undefined {
    const collection = sanitizeLocalFavorites(value);
    return collection ? new ValidatedLocalFavorites(collection) : undefined;
  }
}

export type ParsedLocalFavoritesPreparationRequest =
  | {
      kind: "parse-local-favorites";
      requestId: number;
      serialized: string;
    }
  | {
      kind: "serialize-local-favorites";
      requestId: number;
      favorites: ValidatedLocalFavorites;
      sourceFavorites: OwnDataValue;
    };

export type LocalFavoritesPreparationResponse =
  | {
      kind: "local-favorites-parsed";
      requestId: number;
      favorites?: LocalFavoriteCollection;
    }
  | {
      kind: "local-favorites-serialized";
      requestId: number;
      prepared: LocalFavoritesWorkerPreparedResult;
    }
  | {
      kind: "local-favorites-error";
      requestId: number;
      errorName: string;
      errorMessage: string;
    };

export type LocalFavoritesWorkerMessageEvent = MessageEvent<OwnDataValue>;

export type LocalFavoritesWorkerErrorEvent = ErrorEvent;

export type LocalFavoritesWorkerMessageErrorEvent = MessageEvent<OwnDataValue>;

export type LocalFavoritesWorkerPort = {
  onmessage: ((event: LocalFavoritesWorkerMessageEvent) => void) | null;
  onerror: ((event: LocalFavoritesWorkerErrorEvent) => void) | null;
  onmessageerror: (
    (event: LocalFavoritesWorkerMessageErrorEvent) => void
  ) | null;
  postMessage: (request: LocalFavoritesPreparationRequest) => void;
  terminate: () => void;
};

export type LocalFavoritesWorkerFactory = () =>
  LocalFavoritesWorkerPort | undefined;

export type LocalFavoritesPreparation = {
  parse: (serialized: string) => Promise<LocalFavoriteCollection | undefined>;
  serialize: (
    favorites: LocalFavoriteCollection,
  ) => Promise<PreparedLocalFavorites>;
};

export type LocalFavoritesIdleScheduler = (callback: () => void) => void;

const LOCAL_FAVORITES_IDLE_TIMEOUT_MS = 250;

type PendingPreparation =
  | {
      kind: "parse";
      serialized: string;
      resolve: (favorites: LocalFavoriteCollection | undefined) => void;
      reject: (error: Error) => void;
    }
  | {
      kind: "serialize";
      favorites: LocalFavoriteCollection;
      resolve: (prepared: PreparedLocalFavorites) => void;
      reject: (error: Error) => void;
    };

function errorFromCause(cause: unknown, fallback: string): Error {
  return cause instanceof Error ? cause : new Error(fallback);
}

function isPreparedText(
  value: OwnDataValue,
  required = true,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= 1_024 &&
    (!required || value.length > 0) &&
    !hasControlCharacter(value)
  );
}

function isPreparedCount(
  value: OwnDataValue,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isPreparedDuration(value: OwnDataValue): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 7 * 24 * 60 * 60
  );
}

function hasPreparedPalette(value: OwnDataValue): boolean {
  const colors = copyOwnDataArray(value, 2);
  if (colors === undefined || colors.length !== 2) return false;
  const [first, second] = colors;
  return (
    isPreparedText(first) &&
    first.length <= 64 &&
    isPreparedText(second) &&
    second.length <= 64
  );
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isPreparedItemDate(value: OwnDataValue): boolean {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return false;
  const year = record.year;
  const month = record.month;
  const day = record.day;
  return (
    isPreparedCount(year, 9_999) &&
    year > 0 &&
    (month === undefined ||
      (isPreparedCount(month, 12) && month > 0)) &&
    (day === undefined ||
      (isPreparedCount(day, 31) &&
        day > 0 &&
        isNumberValue(month) &&
        isCalendarDate(year, month, day)))
  );
}

function isPreparedOptionalText(
  value: OwnDataValue,
  required = false,
): boolean {
  return value === undefined || isPreparedText(value, required);
}

function isPreparedOptionalDateText(value: OwnDataValue): boolean {
  return (
    value === undefined ||
    (isPreparedText(value, false) &&
      parseLibraryDate(value) !== undefined)
  );
}

function isPreparedTrack(value: OwnDataValue): boolean {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return false;
  const disc = record.disc;
  const musicBrainzId = record.musicBrainzId;
  return (
    isPreparedText(record.id) &&
    isPreparedText(record.title) &&
    isPreparedText(record.artist) &&
    isPreparedText(record.album) &&
    isPreparedText(record.albumId) &&
    isPreparedDuration(record.duration) &&
    isPreparedCount(record.track, 100_000) &&
    (disc === undefined ||
      isPreparedCount(disc, 100_000)) &&
    isPreparedOptionalText(record.albumArtist) &&
    (musicBrainzId === undefined ||
      (isStringValue(musicBrainzId) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
          .test(musicBrainzId))) &&
    isPreparedOptionalText(record.coverArt) &&
    isPreparedOptionalDateText(record.starredAt) &&
    hasPreparedPalette(record.palette) &&
    record.artworkUrl === undefined &&
    record.streamUrl === undefined &&
    record.radioChapters === undefined &&
    record.discoverRelease === undefined &&
    record.dailySource === undefined
  );
}

function isPreparedOptionalItemDate(value: OwnDataValue): boolean {
  return value === undefined || isPreparedItemDate(value);
}

function isPreparedAlbum(value: OwnDataValue): boolean {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return false;
  const year = record.year;
  return (
    isPreparedText(record.id) &&
    isPreparedText(record.title) &&
    isPreparedText(record.artist) &&
    isPreparedCount(record.songCount, MAX_FAVORITE_TRACKS) &&
    isPreparedDuration(record.duration) &&
    (year === undefined ||
      (isPreparedCount(year, 9_999) && year > 0)) &&
    isPreparedOptionalText(record.coverArt) &&
    isPreparedOptionalText(record.genre) &&
    isPreparedOptionalDateText(record.addedAt) &&
    isPreparedOptionalDateText(record.starredAt) &&
    isPreparedOptionalDateText(record.playedAt) &&
    isPreparedOptionalItemDate(record.originalReleaseDate) &&
    isPreparedOptionalItemDate(record.releaseDate) &&
    hasPreparedPalette(record.palette) &&
    record.artworkUrl === undefined &&
    record.tracks === undefined
  );
}

function isPreparedRadioSeries(value: OwnDataValue): boolean {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return false;
  const id = record.id;
  return (
    isPreparedCount(id, Number.MAX_SAFE_INTEGER) &&
    id > 0 &&
    isPreparedText(record.title) &&
    isPreparedText(record.slug)
  );
}

function isPreparedRadioShow(value: OwnDataValue): boolean {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return false;
  const id = record.id;
  const series = record.series;
  return (
    isPreparedCount(id, Number.MAX_SAFE_INTEGER) &&
    id > 0 &&
    isPreparedText(record.subtitle) &&
    isPreparedText(record.description, false) &&
    isPreparedText(record.publishedAt, false) &&
    (series === undefined || isPreparedRadioSeries(series)) &&
    record.artworkUrl === undefined
  );
}

function hasBoundedItems(
  value: OwnDataValue,
  maximum: number,
  validate: (item: OwnDataValue) => boolean,
): boolean {
  const items = copyOwnDataArray(value, maximum);
  if (items === undefined) return false;
  for (const item of items) {
    if (!validate(item)) return false;
  }
  return true;
}

function isPreparedRadioId(value: OwnDataValue): boolean {
  return (
    isPreparedCount(value, Number.MAX_SAFE_INTEGER) &&
    value > 0
  );
}

function isPreparedLocalFavorites<Value>(
  value: Value,
): value is Value & LocalFavoriteCollection {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return false;
  return (
    hasBoundedItems(
      record.albumIds,
      MAX_FAVORITE_ALBUMS,
      isPreparedText,
    ) &&
    hasBoundedItems(
      record.songIds,
      MAX_FAVORITE_TRACKS,
      isPreparedText,
    ) &&
    hasBoundedItems(
      record.radioShowIds,
      MAX_FAVORITE_RADIO_SHOWS,
      isPreparedRadioId,
    ) &&
    hasBoundedItems(
      record.albums,
      MAX_FAVORITE_ALBUMS,
      isPreparedAlbum,
    ) &&
    hasBoundedItems(
      record.tracks,
      MAX_FAVORITE_TRACKS,
      isPreparedTrack,
    ) &&
    hasBoundedItems(
      record.radioShows,
      MAX_FAVORITE_RADIO_SHOWS,
      isPreparedRadioShow,
    )
  );
}

function parsePreparedLocalFavorites(
  value: OwnDataValue,
): LocalFavoriteCollection | undefined {
  return isPreparedLocalFavorites(value) ? value : undefined;
}

function requestIdFrom(value: OwnDataRecord): number | undefined {
  const requestId = value.requestId;
  return (
      isNumberValue(requestId) &&
      Number.isSafeInteger(requestId) &&
      requestId > 0
    )
    ? requestId
    : undefined;
}

function defaultIdleScheduler(callback: () => void): void {
  if ("requestIdleCallback" in globalThis) {
    globalThis.requestIdleCallback(() => callback(), {
      timeout: LOCAL_FAVORITES_IDLE_TIMEOUT_MS,
    });
    return;
  }
  setTimeout(callback, 0);
}

export function parseLocalFavoritesPreparationRequest<Value>(
  value: Value,
): ParsedLocalFavoritesPreparationRequest | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const requestId = requestIdFrom(record);
  if (requestId === undefined) return undefined;
  const kind = record.kind;
  if (kind === "parse-local-favorites") {
    const serialized = record.serialized;
    if (
      !isStringValue(serialized) ||
      serialized.length > MAX_LOCAL_FAVORITES_BYTES
    ) {
      return undefined;
    }
    return {
      kind,
      requestId,
      serialized,
    };
  }
  if (kind !== "serialize-local-favorites") return undefined;
  const sourceFavorites = record.favorites;
  if (sourceFavorites === undefined) return undefined;
  const favorites = ValidatedLocalFavorites.parse(sourceFavorites);
  if (!favorites) return undefined;
  return {
    kind,
    requestId,
    favorites,
    sourceFavorites,
  };
}

export function parseLocalFavoritesPreparationResponse(
  value: OwnDataValue,
): LocalFavoritesPreparationResponse | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const requestId = requestIdFrom(record);
  if (requestId === undefined) return undefined;
  const kind = record.kind;
  if (kind === "local-favorites-parsed") {
    const favoritesValue = record.favorites;
    if (favoritesValue === undefined) {
      return { kind, requestId };
    }
    const favorites = parsePreparedLocalFavorites(favoritesValue);
    return favorites ? { kind, requestId, favorites } : undefined;
  }
  if (kind === "local-favorites-serialized") {
    const preparedRecord = projectOwnDataRecord(record.prepared);
    if (preparedRecord === undefined) return undefined;
    const serialized = preparedRecord.serialized;
    const favoritesValue = preparedRecord.favorites;
    if (
      !isStringValue(serialized) ||
      serialized.length === 0 ||
      serialized.length > MAX_LOCAL_FAVORITES_BYTES
    ) {
      return undefined;
    }
    const favorites = favoritesValue === undefined
      ? undefined
      : parsePreparedLocalFavorites(favoritesValue);
    if (favoritesValue !== undefined && !favorites) return undefined;
    const prepared: LocalFavoritesPreparationResponse = {
      kind,
      requestId,
      prepared: {
        serialized,
      },
    };
    if (favorites) prepared.prepared.favorites = favorites;
    return prepared;
  }
  const errorName = record.errorName;
  const errorMessage = record.errorMessage;
  if (
    kind !== "local-favorites-error" ||
    !isStringValue(errorName) ||
    errorName.length === 0 ||
    errorName.length > 1_024 ||
    !isStringValue(errorMessage) ||
    errorMessage.length === 0 ||
    errorMessage.length > 1_024
  ) {
    return undefined;
  }
  return {
    kind,
    requestId,
    errorName,
    errorMessage,
  };
}

function localFavoritesSnapshot(
  favorites: LocalFavoriteCollection,
): LocalFavoritesSnapshot {
  return {
    version: LOCAL_FAVORITES_VERSION,
    ...localTrackStarIndexAndRadio(favorites),
  };
}

function serializeLocalFavoritesSnapshot(
  snapshot: LocalFavoritesSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function prepareLocalFavoritesSnapshot(
  snapshot: LocalFavoritesSnapshot,
): PreparedLocalFavorites {
  const serialized = serializeLocalFavoritesSnapshot(snapshot);
  if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) {
    throw new Error("Local favorites are too large to save safely.");
  }
  const { version: _version, ...sanitized } = snapshot;
  return { favorites: sanitized, serialized };
}

function isLocalFavoriteCollectionFields(
  fields: {
    albumIds: OwnDataValue;
    songIds: OwnDataValue;
    albums: OwnDataValue;
    tracks: OwnDataValue;
    radioShowIds: OwnDataValue;
    radioShows: OwnDataValue;
  },
): fields is LocalFavoriteCollection {
  return (
    isDataArray(fields.albumIds) &&
    isDataArray(fields.songIds) &&
    isDataArray(fields.albums) &&
    isDataArray(fields.tracks) &&
    isDataArray(fields.radioShowIds) &&
    isDataArray(fields.radioShows)
  );
}

export function serializeValidatedLocalFavorites(
  validated: ValidatedLocalFavorites,
): PreparedLocalFavorites {
  return prepareLocalFavoritesSnapshot(
    localFavoritesSnapshot(validated.collection),
  );
}

export function serializeLocalFavorites(
  favorites: LocalFavoriteCollection,
): PreparedLocalFavorites {
  return prepareLocalFavoritesSnapshot(
    localFavoritesSnapshot(createLocalFavoritesSnapshot(favorites)),
  );
}

export function localFavoritesInputMatchesPrepared(
  value: OwnDataValue,
  prepared: PreparedLocalFavorites,
): boolean {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return false;
  const albumIds = record.albumIds;
  const songIds = record.songIds;
  const radioShowIds = record.radioShowIds;
  const albums = record.albums;
  const tracks = record.tracks;
  const radioShows = record.radioShows;
  const fields = {
    albumIds,
    songIds,
    albums,
    tracks,
    radioShowIds,
    radioShows,
  };
  if (!isLocalFavoriteCollectionFields(fields)) return false;
  try {
    return serializeLocalFavoritesSnapshot(localFavoritesSnapshot(fields)) ===
      prepared.serialized;
  } catch {
    return false;
  }
}

export function localFavoritesWorkerPrepared(
  prepared: PreparedLocalFavorites,
  sourceFavorites: OwnDataValue,
): LocalFavoritesWorkerPreparedResult {
  if (localFavoritesInputMatchesPrepared(sourceFavorites, prepared)) {
    return { serialized: prepared.serialized };
  }
  return {
    serialized: prepared.serialized,
    favorites: prepared.favorites,
  };
}

function defaultWorkerFactory(): LocalFavoritesWorkerPort | undefined {
  if (!("Worker" in globalThis)) return undefined;
  return new Worker(
    new URL("./localFavoritesPreparation.worker.ts", import.meta.url),
    { name: "coda-local-favorites", type: "module" },
  );
}

function deferFallback<Value>(operation: () => Value): Promise<Value> {
  return new Promise((resolve, reject) => {
    const schedule = !("window" in globalThis)
      ? (callback: () => void) => globalThis.setTimeout(callback, 0)
      : window.setTimeout.bind(window);
    schedule(() => {
      try {
        resolve(operation());
      } catch (cause) {
        reject(cause);
      }
    });
  });
}

export class LocalFavoritesPreparationClient implements LocalFavoritesPreparation {
  private worker: LocalFavoritesWorkerPort | undefined;
  private workerUnavailable = false;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingPreparation>();

  constructor(
    private readonly workerFactory: LocalFavoritesWorkerFactory = defaultWorkerFactory,
    private readonly schedule: LocalFavoritesIdleScheduler = defaultIdleScheduler,
  ) {}

  parse(serialized: string): Promise<LocalFavoriteCollection | undefined> {
    let worker: LocalFavoritesWorkerPort | undefined;
    try {
      worker = this.getWorker();
    } catch {
      return deferFallback(() => parseLocalFavoritesSerialized(serialized));
    }
    if (!worker) {
      return deferFallback(() => parseLocalFavoritesSerialized(serialized));
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const promise = new Promise<LocalFavoriteCollection | undefined>(
      (resolve, reject) => {
        this.pending.set(requestId, {
          kind: "parse",
          serialized,
          resolve,
          reject,
        });
      },
    );
    try {
      worker.postMessage({
        kind: "parse-local-favorites",
        requestId,
        serialized,
      });
    } catch (cause) {
      const pending = this.pending.get(requestId);
      this.pending.delete(requestId);
      const error = errorFromCause(
        cause,
        "Coda could not send local Favorites to its worker.",
      );
      this.failWorker(error, true);
      if (pending) this.fallbackPending(pending);
      return promise;
    }
    return promise;
  }

  serialize(
    favorites: LocalFavoriteCollection,
  ): Promise<PreparedLocalFavorites> {
    let worker: LocalFavoritesWorkerPort | undefined;
    try {
      worker = this.getWorker();
    } catch {
      return deferFallback(() => serializeLocalFavorites(favorites));
    }
    if (!worker) {
      return deferFallback(() => serializeLocalFavorites(favorites));
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const promise = new Promise<PreparedLocalFavorites>((resolve, reject) => {
      this.pending.set(requestId, {
        kind: "serialize",
        favorites,
        resolve,
        reject,
      });
    });
    const send = () => {
      if (this.worker !== worker || !this.pending.has(requestId)) return;
      try {
        worker.postMessage({
          kind: "serialize-local-favorites",
          requestId,
          favorites,
        });
      } catch (cause) {
        this.handlePostFailure(requestId, cause);
      }
    };
    try {
      this.schedule(send);
    } catch (cause) {
      this.handlePostFailure(requestId, cause);
    }
    return promise;
  }

  dispose(reason = "The local Favorites worker was disposed."): void {
    this.failWorker(new Error(reason));
  }

  private getWorker(): LocalFavoritesWorkerPort | undefined {
    if (this.worker) return this.worker;
    if (this.workerUnavailable) return undefined;
    const worker = this.workerFactory();
    if (!worker) {
      this.workerUnavailable = true;
      return undefined;
    }
    worker.onmessage = (event) => {
      if (this.worker !== worker) return;
      this.handleMessage(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker !== worker) return;
      event.preventDefault?.();
      this.failWorker(errorFromCause(
        event.error,
        event.message || "Coda's local Favorites worker failed.",
      ), true);
    };
    worker.onmessageerror = (event) => {
      if (this.worker !== worker) return;
      event.preventDefault();
      this.failWorker(new Error(
        "Coda received an invalid local Favorites worker response.",
      ), true);
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(value: OwnDataValue): void {
    const response = parseLocalFavoritesPreparationResponse(value);
    if (!response) {
      this.failWorker(new Error(
        "Coda received an invalid local Favorites worker response.",
      ), true);
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) {
      this.failWorker(new Error(
        "Coda received an unexpected local Favorites worker response.",
      ), true);
      return;
    }
    this.pending.delete(response.requestId);
    if (response.kind === "local-favorites-error") {
      const error = new Error(response.errorMessage);
      error.name = response.errorName;
      pending.reject(error);
      return;
    }
    if (
      pending.kind === "parse" &&
      response.kind === "local-favorites-parsed"
    ) {
      pending.resolve(response.favorites);
      return;
    }
    if (
      pending.kind === "serialize" &&
      response.kind === "local-favorites-serialized"
    ) {
      pending.resolve({
        favorites: response.prepared.favorites ?? pending.favorites,
        serialized: response.prepared.serialized,
      });
      return;
    }
    this.fallbackPending(pending);
    this.failWorker(new Error(
      "Coda received a mismatched local Favorites worker response.",
    ), true);
  }

  private handlePostFailure(requestId: number, cause: unknown): void {
    const pending = this.pending.get(requestId);
    this.pending.delete(requestId);
    const error = errorFromCause(
      cause,
      "Coda could not send local Favorites to its worker.",
    );
    this.failWorker(error, true);
    if (pending) this.fallbackPending(pending);
  }

  private fallbackPending(request: PendingPreparation): void {
    if (request.kind === "parse") {
      void deferFallback(
        () => parseLocalFavoritesSerialized(request.serialized),
      ).then(request.resolve, request.reject);
      return;
    }
    void deferFallback(
      () => serializeLocalFavorites(request.favorites),
    ).then(request.resolve, request.reject);
  }

  private failWorker(error: Error, useFallback = false): void {
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try {
        worker.terminate();
      } catch {
        // Pending work must still reject if platform cleanup fails.
      }
    }
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) {
      if (useFallback) this.fallbackPending(request);
      else request.reject(error);
    }
  }
}

export const localFavoritesPreparation = new LocalFavoritesPreparationClient();
