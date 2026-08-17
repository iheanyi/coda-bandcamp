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
  INVALID_OWN_DATA_PROPERTY as INVALID_PROPERTY,
  isDataArray,
  isNumberValue,
  isOwnDataRecord,
  isStringValue,
  MISSING_OWN_DATA_PROPERTY as MISSING_PROPERTY,
  ownDataProperty,
  type OwnDataPropertyResult,
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

function objectProperty(
  value: OwnDataPropertyResult,
  key: string,
): OwnDataPropertyResult {
  if (!isOwnDataRecord(value)) return INVALID_PROPERTY;
  return ownDataProperty(value, key);
}

function arrayElement(
  values: readonly OwnDataValue[],
  index: number,
): OwnDataPropertyResult {
  return ownDataProperty(values, String(index));
}

function isOmitted(value: OwnDataPropertyResult): boolean {
  return value === MISSING_PROPERTY || value === undefined;
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function isPreparedText(
  value: OwnDataPropertyResult,
  required = true,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= 1_024 &&
    (!required || value.length > 0) &&
    !hasControlCharacters(value)
  );
}

function isPreparedCount(
  value: OwnDataPropertyResult,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= maximum
  );
}

function isPreparedDuration(value: OwnDataPropertyResult): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 7 * 24 * 60 * 60
  );
}

function hasPreparedPalette(value: OwnDataPropertyResult): boolean {
  if (!isDataArray(value) || value.length !== 2) return false;
  const first = arrayElement(value, 0);
  const second = arrayElement(value, 1);
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

function isPreparedItemDate(value: OwnDataPropertyResult): boolean {
  const year = objectProperty(value, "year");
  const month = objectProperty(value, "month");
  const day = objectProperty(value, "day");
  return (
    isPreparedCount(year, 9_999) &&
    year > 0 &&
    (isOmitted(month) ||
      (isPreparedCount(month, 12) && month > 0)) &&
    (isOmitted(day) ||
      (isPreparedCount(day, 31) &&
        day > 0 &&
        isNumberValue(month) &&
        isCalendarDate(year, month, day)))
  );
}

function isPreparedOptionalText(
  value: OwnDataPropertyResult,
  required = false,
): boolean {
  return isOmitted(value) || isPreparedText(value, required);
}

function isPreparedOptionalDateText(value: OwnDataPropertyResult): boolean {
  return (
    isOmitted(value) ||
    (isPreparedText(value, false) &&
      parseLibraryDate(value) !== undefined)
  );
}

function isPreparedTrack(value: OwnDataPropertyResult): boolean {
  const disc = objectProperty(value, "disc");
  const musicBrainzId = objectProperty(value, "musicBrainzId");
  return (
    isPreparedText(objectProperty(value, "id")) &&
    isPreparedText(objectProperty(value, "title")) &&
    isPreparedText(objectProperty(value, "artist")) &&
    isPreparedText(objectProperty(value, "album")) &&
    isPreparedText(objectProperty(value, "albumId")) &&
    isPreparedDuration(objectProperty(value, "duration")) &&
    isPreparedCount(objectProperty(value, "track"), 100_000) &&
    (isOmitted(disc) ||
      isPreparedCount(disc, 100_000)) &&
    isPreparedOptionalText(objectProperty(value, "albumArtist")) &&
    (isOmitted(musicBrainzId) ||
      (isStringValue(musicBrainzId) &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
          .test(musicBrainzId))) &&
    isPreparedOptionalText(objectProperty(value, "coverArt")) &&
    isPreparedOptionalDateText(objectProperty(value, "starredAt")) &&
    hasPreparedPalette(objectProperty(value, "palette")) &&
    isOmitted(objectProperty(value, "artworkUrl")) &&
    isOmitted(objectProperty(value, "streamUrl")) &&
    isOmitted(objectProperty(value, "radioChapters")) &&
    isOmitted(objectProperty(value, "discoverRelease")) &&
    isOmitted(objectProperty(value, "dailySource"))
  );
}

function isPreparedOptionalItemDate(value: OwnDataPropertyResult): boolean {
  return isOmitted(value) || isPreparedItemDate(value);
}

function isPreparedAlbum(value: OwnDataPropertyResult): boolean {
  const year = objectProperty(value, "year");
  return (
    isPreparedText(objectProperty(value, "id")) &&
    isPreparedText(objectProperty(value, "title")) &&
    isPreparedText(objectProperty(value, "artist")) &&
    isPreparedCount(objectProperty(value, "songCount"), MAX_FAVORITE_TRACKS) &&
    isPreparedDuration(objectProperty(value, "duration")) &&
    (isOmitted(year) ||
      (isPreparedCount(year, 9_999) && year > 0)) &&
    isPreparedOptionalText(objectProperty(value, "coverArt")) &&
    isPreparedOptionalText(objectProperty(value, "genre")) &&
    isPreparedOptionalDateText(objectProperty(value, "addedAt")) &&
    isPreparedOptionalDateText(objectProperty(value, "starredAt")) &&
    isPreparedOptionalDateText(objectProperty(value, "playedAt")) &&
    isPreparedOptionalItemDate(objectProperty(value, "originalReleaseDate")) &&
    isPreparedOptionalItemDate(objectProperty(value, "releaseDate")) &&
    hasPreparedPalette(objectProperty(value, "palette")) &&
    isOmitted(objectProperty(value, "artworkUrl")) &&
    isOmitted(objectProperty(value, "tracks"))
  );
}

function isPreparedRadioSeries(value: OwnDataPropertyResult): boolean {
  const id = objectProperty(value, "id");
  return (
    isPreparedCount(id, Number.MAX_SAFE_INTEGER) &&
    id > 0 &&
    isPreparedText(objectProperty(value, "title")) &&
    isPreparedText(objectProperty(value, "slug"))
  );
}

function isPreparedRadioShow(value: OwnDataPropertyResult): boolean {
  const id = objectProperty(value, "id");
  const series = objectProperty(value, "series");
  return (
    isPreparedCount(id, Number.MAX_SAFE_INTEGER) &&
    id > 0 &&
    isPreparedText(objectProperty(value, "subtitle")) &&
    isPreparedText(objectProperty(value, "description"), false) &&
    isPreparedText(objectProperty(value, "publishedAt"), false) &&
    (isOmitted(series) || isPreparedRadioSeries(series)) &&
    isOmitted(objectProperty(value, "artworkUrl"))
  );
}

function hasBoundedItems(
  value: OwnDataPropertyResult,
  maximum: number,
  validate: (item: OwnDataPropertyResult) => boolean,
): boolean {
  if (!isDataArray(value) || value.length > maximum) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!validate(arrayElement(value, index))) return false;
  }
  return true;
}

function isPreparedRadioId(value: OwnDataPropertyResult): boolean {
  return (
    isPreparedCount(value, Number.MAX_SAFE_INTEGER) &&
    value > 0
  );
}

function isPreparedLocalFavorites<Value>(
  value: Value,
): value is Value & LocalFavoriteCollection {
  return (
    isOwnDataRecord(value) &&
    hasBoundedItems(
      objectProperty(value, "albumIds"),
      MAX_FAVORITE_ALBUMS,
      isPreparedText,
    ) &&
    hasBoundedItems(
      objectProperty(value, "songIds"),
      MAX_FAVORITE_TRACKS,
      isPreparedText,
    ) &&
    hasBoundedItems(
      objectProperty(value, "radioShowIds"),
      MAX_FAVORITE_RADIO_SHOWS,
      isPreparedRadioId,
    ) &&
    hasBoundedItems(
      objectProperty(value, "albums"),
      MAX_FAVORITE_ALBUMS,
      isPreparedAlbum,
    ) &&
    hasBoundedItems(
      objectProperty(value, "tracks"),
      MAX_FAVORITE_TRACKS,
      isPreparedTrack,
    ) &&
    hasBoundedItems(
      objectProperty(value, "radioShows"),
      MAX_FAVORITE_RADIO_SHOWS,
      isPreparedRadioShow,
    )
  );
}

function parsePreparedLocalFavorites(
  value: OwnDataPropertyResult,
): LocalFavoriteCollection | undefined {
  return isPreparedLocalFavorites(value) ? value : undefined;
}

function requestIdFrom(value: OwnDataRecord): number | undefined {
  const requestId = objectProperty(value, "requestId");
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

function isMissing(value: OwnDataPropertyResult): boolean {
  return value === MISSING_PROPERTY || value === undefined;
}

export function parseLocalFavoritesPreparationRequest<Value>(
  value: Value,
): ParsedLocalFavoritesPreparationRequest | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  const requestId = requestIdFrom(value);
  if (requestId === undefined) return undefined;
  const kind = objectProperty(value, "kind");
  if (kind === "parse-local-favorites") {
    const serialized = objectProperty(value, "serialized");
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
  const sourceFavorites = objectProperty(value, "favorites");
  if (
    sourceFavorites === INVALID_PROPERTY ||
    sourceFavorites === MISSING_PROPERTY
  ) {
    return undefined;
  }
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
  if (!isOwnDataRecord(value)) return undefined;
  const requestId = requestIdFrom(value);
  if (requestId === undefined) return undefined;
  const kind = objectProperty(value, "kind");
  if (kind === "local-favorites-parsed") {
    const favoritesValue = objectProperty(value, "favorites");
    if (isMissing(favoritesValue)) {
      return { kind, requestId };
    }
    const favorites = parsePreparedLocalFavorites(favoritesValue);
    return favorites ? { kind, requestId, favorites } : undefined;
  }
  if (kind === "local-favorites-serialized") {
    const preparedValue = objectProperty(value, "prepared");
    if (!isOwnDataRecord(preparedValue)) return undefined;
    const serialized = objectProperty(preparedValue, "serialized");
    const favoritesValue = objectProperty(preparedValue, "favorites");
    if (
      !isStringValue(serialized) ||
      serialized.length === 0 ||
      serialized.length > MAX_LOCAL_FAVORITES_BYTES
    ) {
      return undefined;
    }
    const favorites = isMissing(favoritesValue)
      ? undefined
      : parsePreparedLocalFavorites(favoritesValue);
    if (!isMissing(favoritesValue) && !favorites) return undefined;
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
  const errorName = objectProperty(value, "errorName");
  const errorMessage = objectProperty(value, "errorMessage");
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

function isOwnDataField(
  value: OwnDataPropertyResult,
): value is OwnDataValue {
  return value !== MISSING_PROPERTY && value !== INVALID_PROPERTY;
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
  if (!isOwnDataRecord(value)) return false;
  const albumIds = objectProperty(value, "albumIds");
  const songIds = objectProperty(value, "songIds");
  const radioShowIds = objectProperty(value, "radioShowIds");
  const albums = objectProperty(value, "albums");
  const tracks = objectProperty(value, "tracks");
  const radioShows = objectProperty(value, "radioShows");
  if (
    !isOwnDataField(albumIds) ||
    !isOwnDataField(songIds) ||
    !isOwnDataField(radioShowIds) ||
    !isOwnDataField(albums) ||
    !isOwnDataField(tracks) ||
    !isOwnDataField(radioShows)
  ) {
    return false;
  }
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
