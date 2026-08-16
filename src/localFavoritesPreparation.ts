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
  type LocalFavoritesWireValue,
} from "./localFavorites";
import type { LocalFavoriteCollection } from "./types";

export type PreparedLocalFavorites = {
  favorites: LocalFavoriteCollection;
  serialized: string;
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
    value: LocalFavoritesWireValue,
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
      sourceFavorites: LocalFavoritesWireValue;
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
      prepared: {
        favorites?: LocalFavoriteCollection;
        serialized: string;
      };
    }
  | {
      kind: "local-favorites-error";
      requestId: number;
      errorName: string;
      errorMessage: string;
    };

export type LocalFavoritesWorkerMessageEvent =
  MessageEvent<LocalFavoritesWireValue>;

export type LocalFavoritesWorkerErrorEvent = ErrorEvent;

export type LocalFavoritesWorkerMessageErrorEvent =
  MessageEvent<LocalFavoritesWireValue>;

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

type LocalFavoritesPreparationWireRecord = {
  [field: string]: LocalFavoritesWireValue;
};

function isRecord(
  value: LocalFavoritesWireValue,
): value is LocalFavoritesPreparationWireRecord {
  return (
    value !== null &&
    value !== undefined &&
    Object(value) === value &&
    !Array.isArray(value)
  );
}

function requestIdFrom(
  value: LocalFavoritesPreparationWireRecord,
): number | undefined {
  return Number.isSafeInteger(value.requestId) && Number(value.requestId) > 0
    ? Number(value.requestId)
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

/**
 * Validates only the dedicated worker protocol envelope. The module worker is
 * created by this client, cannot receive window messages, and deep-sanitizes
 * each request before replying. Repeating that O(n) validation here would move
 * the work back onto the renderer task that the worker exists to protect.
 */
function hasBoundedTrustedWorkerFavoritesEnvelope(
  value: LocalFavoritesWireValue,
): value is LocalFavoriteCollection {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.albumIds) &&
    value.albumIds.length <= MAX_FAVORITE_ALBUMS &&
    Array.isArray(value.songIds) &&
    value.songIds.length <= MAX_FAVORITE_TRACKS &&
    Array.isArray(value.radioShowIds) &&
    value.radioShowIds.length <= MAX_FAVORITE_RADIO_SHOWS &&
    Array.isArray(value.albums) &&
    value.albums.length <= MAX_FAVORITE_ALBUMS &&
    Array.isArray(value.tracks) &&
    value.tracks.length <= MAX_FAVORITE_TRACKS &&
    Array.isArray(value.radioShows) &&
    value.radioShows.length <= MAX_FAVORITE_RADIO_SHOWS
  );
}

export function parseLocalFavoritesPreparationRequest(
  value: LocalFavoritesWireValue,
): ParsedLocalFavoritesPreparationRequest | undefined {
  if (!isRecord(value)) return undefined;
  const requestId = requestIdFrom(value);
  if (requestId === undefined) return undefined;
  if (value.kind === "parse-local-favorites") {
    if (
      String(value.serialized) !== value.serialized ||
      value.serialized.length > MAX_LOCAL_FAVORITES_BYTES
    ) {
      return undefined;
    }
    return {
      kind: value.kind,
      requestId,
      serialized: value.serialized,
    };
  }
  if (value.kind !== "serialize-local-favorites") return undefined;
  const favorites = ValidatedLocalFavorites.parse(value.favorites);
  if (!favorites) return undefined;
  return {
    kind: value.kind,
    requestId,
    favorites,
    sourceFavorites: value.favorites,
  };
}

export function parseLocalFavoritesPreparationResponse(
  value: LocalFavoritesWireValue,
): LocalFavoritesPreparationResponse | undefined {
  if (!isRecord(value)) return undefined;
  const requestId = requestIdFrom(value);
  if (requestId === undefined) return undefined;
  if (value.kind === "local-favorites-parsed") {
    if (value.favorites === undefined) {
      return { kind: value.kind, requestId };
    }
    return hasBoundedTrustedWorkerFavoritesEnvelope(value.favorites)
      ? { kind: value.kind, requestId, favorites: value.favorites }
      : undefined;
  }
  if (value.kind === "local-favorites-serialized") {
    if (!isRecord(value.prepared)) return undefined;
    if (
      String(value.prepared.serialized) !== value.prepared.serialized ||
      value.prepared.serialized.length === 0 ||
      value.prepared.serialized.length > MAX_LOCAL_FAVORITES_BYTES ||
      (value.prepared.favorites !== undefined &&
        !hasBoundedTrustedWorkerFavoritesEnvelope(value.prepared.favorites))
    ) {
      return undefined;
    }
    const prepared: LocalFavoritesPreparationResponse = {
      kind: value.kind,
      requestId,
      prepared: {
        serialized: value.prepared.serialized,
      },
    };
    if (value.prepared.favorites !== undefined) {
      prepared.prepared.favorites = value.prepared.favorites;
    }
    return prepared;
  }
  if (
    value.kind !== "local-favorites-error" ||
    String(value.errorName) !== value.errorName ||
    value.errorName.length === 0 ||
    value.errorName.length > 1_024 ||
    String(value.errorMessage) !== value.errorMessage ||
    value.errorMessage.length === 0 ||
    value.errorMessage.length > 1_024
  ) {
    return undefined;
  }
  return {
    kind: value.kind,
    requestId,
    errorName: value.errorName,
    errorMessage: value.errorMessage,
  };
}

function prepareLocalFavoritesSnapshot(
  snapshot: LocalFavoritesSnapshot,
): PreparedLocalFavorites {
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) {
    throw new Error("Local favorites are too large to save safely.");
  }
  const { version: _version, ...sanitized } = snapshot;
  return { favorites: sanitized, serialized };
}

export function serializeValidatedLocalFavorites(
  validated: ValidatedLocalFavorites,
): PreparedLocalFavorites {
  const snapshot: LocalFavoritesSnapshot = {
    version: LOCAL_FAVORITES_VERSION,
    ...localTrackStarIndexAndRadio(validated.collection),
  };
  return prepareLocalFavoritesSnapshot(snapshot);
}

export function serializeLocalFavorites(
  favorites: LocalFavoriteCollection,
): PreparedLocalFavorites {
  return prepareLocalFavoritesSnapshot(createLocalFavoritesSnapshot(favorites));
}

export function localFavoritesInputMatchesPrepared(
  value: LocalFavoritesWireValue,
  prepared: PreparedLocalFavorites,
): boolean {
  if (!isRecord(value)) return false;
  try {
    return JSON.stringify({
      version: LOCAL_FAVORITES_VERSION,
      albumIds: value.albumIds,
      songIds: value.songIds,
      radioShowIds: value.radioShowIds,
      albums: value.albums,
      tracks: value.tracks,
      radioShows: value.radioShows,
    }) === prepared.serialized;
  } catch {
    return false;
  }
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

  private handleMessage(value: LocalFavoritesWireValue): void {
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
