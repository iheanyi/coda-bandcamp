import {
  createLocalFavoritesSnapshot,
  MAX_LOCAL_FAVORITES_BYTES,
  parseLocalFavoritesSnapshot,
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

export type LocalFavoritesPreparationResponse =
  | {
      kind: "local-favorites-parsed";
      requestId: number;
      favorites?: LocalFavoriteCollection;
    }
  | {
      kind: "local-favorites-serialized";
      requestId: number;
      prepared: PreparedLocalFavorites;
    }
  | {
      kind: "local-favorites-error";
      requestId: number;
      errorName: string;
      errorMessage: string;
    };

export type LocalFavoritesWorkerMessageEvent = {
  data: LocalFavoritesPreparationResponse;
};

export type LocalFavoritesWorkerErrorEvent = {
  error?: unknown;
  message?: string;
  preventDefault?: () => void;
};

export type LocalFavoritesWorkerPort = {
  onmessage: ((event: LocalFavoritesWorkerMessageEvent) => void) | null;
  onerror: ((event: LocalFavoritesWorkerErrorEvent) => void) | null;
  onmessageerror: ((event: LocalFavoritesWorkerErrorEvent) => void) | null;
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

function errorFromUnknown(error: unknown, fallback: string): Error {
  return error instanceof Error ? error : new Error(fallback);
}

export function parseLocalFavoritesSerialized(
  serialized: string,
): LocalFavoriteCollection | undefined {
  if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) return undefined;
  try {
    const value: unknown = JSON.parse(serialized);
    return parseLocalFavoritesSnapshot(value);
  } catch {
    return undefined;
  }
}

export function serializeLocalFavorites(
  favorites: LocalFavoriteCollection,
): PreparedLocalFavorites {
  const snapshot = createLocalFavoritesSnapshot(favorites);
  const serialized = JSON.stringify(snapshot);
  if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) {
    throw new Error("Local favorites are too large to save safely.");
  }
  const { version: _version, ...sanitized } = snapshot;
  return { favorites: sanitized, serialized };
}

function defaultWorkerFactory(): LocalFavoritesWorkerPort | undefined {
  if (typeof Worker === "undefined") return undefined;
  return new Worker(
    new URL("./localFavoritesPreparation.worker.ts", import.meta.url),
    { name: "coda-local-favorites", type: "module" },
  ) as unknown as LocalFavoritesWorkerPort;
}

function deferFallback<Value>(operation: () => Value): Promise<Value> {
  return new Promise((resolve, reject) => {
    const schedule = typeof window === "undefined"
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
      const error = errorFromUnknown(
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
    try {
      worker.postMessage({
        kind: "serialize-local-favorites",
        requestId,
        favorites,
      });
    } catch (cause) {
      const pending = this.pending.get(requestId);
      this.pending.delete(requestId);
      const error = errorFromUnknown(
        cause,
        "Coda could not send local Favorites to its worker.",
      );
      this.failWorker(error, true);
      if (pending) this.fallbackPending(pending);
      return promise;
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
      this.failWorker(errorFromUnknown(
        event.error,
        event.message || "Coda's local Favorites worker failed.",
      ), true);
    };
    worker.onmessageerror = (event) => {
      if (this.worker !== worker) return;
      event.preventDefault?.();
      this.failWorker(new Error(
        event.message || "Coda received an invalid local Favorites worker response.",
      ), true);
    };
    this.worker = worker;
    return worker;
  }

  private handleMessage(response: LocalFavoritesPreparationResponse): void {
    if (
      !response ||
      !Number.isSafeInteger(response.requestId) ||
      response.requestId < 1
    ) {
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
      pending.resolve(response.prepared);
      return;
    }
    this.fallbackPending(pending);
    this.failWorker(new Error(
      "Coda received a mismatched local Favorites worker response.",
    ), true);
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
