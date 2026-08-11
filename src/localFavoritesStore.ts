import type { LocalFavoriteCollection } from "./types";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_KEY,
  MAX_LOCAL_FAVORITES_BYTES,
} from "./localFavorites";
import {
  localFavoritesPreparation,
  type LocalFavoritesPreparation,
  type PreparedLocalFavorites,
} from "./localFavoritesPreparation";

const DATABASE_NAME = "coda-local-state";
const DATABASE_VERSION = 1;
const FAVORITES_STORE = "favorites";
const FAVORITES_KEY = "current";

export type LocalFavoritesStorage = {
  read: () => Promise<unknown | undefined>;
  write: (serialized: string) => Promise<void>;
  clear: () => Promise<void>;
};

let databaseRequest: Promise<IDBDatabase> | undefined;
let indexedStorageUnavailable = false;
let storageOperationChain: Promise<void> = Promise.resolve();

function enqueueStorageOperation<Value>(
  operation: () => Promise<Value>,
): Promise<Value> {
  const result = storageOperationChain.then(operation);
  storageOperationChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!databaseRequest) {
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(FAVORITES_STORE)) {
          request.result.createObjectStore(FAVORITES_STORE);
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databaseRequest = undefined;
        };
        database.onclose = () => {
          databaseRequest = undefined;
        };
        resolve(database);
      };
      request.onerror = () => {
        databaseRequest = undefined;
        reject(request.error ?? new Error("Coda could not open local Favorites."));
      };
    });
    let guarded: Promise<IDBDatabase>;
    guarded = pending.catch((cause) => {
      if (databaseRequest === guarded) databaseRequest = undefined;
      throw cause;
    });
    databaseRequest = guarded;
  }
  return databaseRequest;
}

async function transact<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (cause: unknown) => void) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(FAVORITES_STORE, mode);
    let result: T;
    let resultReady = false;
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Coda could not access local Favorites."),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Coda could not update local Favorites."),
    );
    transaction.oncomplete = () => {
      if (resultReady) resolve(result);
      else reject(new Error("Coda did not finish the local Favorites request."));
    };
    operation(
      transaction.objectStore(FAVORITES_STORE),
      (value) => {
        result = value;
        resultReady = true;
      },
      reject,
    );
  });
}

const defaultIndexedFavoritesStorage: LocalFavoritesStorage = {
  read: () => transact("readonly", (store, resolve, reject) => {
    const request = store.get(FAVORITES_KEY);
    request.onsuccess = () => resolve(request.result as unknown | undefined);
    request.onerror = () => reject(request.error);
  }),
  write: (serialized) => transact("readwrite", (store, resolve, reject) => {
    const request = store.put(serialized, FAVORITES_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }),
  clear: () => transact("readwrite", (store, resolve, reject) => {
    const request = store.delete(FAVORITES_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  }),
};

function indexedFavoritesStorage(): LocalFavoritesStorage | undefined {
  if (typeof window === "undefined" || indexedStorageUnavailable) {
    return undefined;
  }
  try {
    return window.indexedDB ? defaultIndexedFavoritesStorage : undefined;
  } catch {
    indexedStorageUnavailable = true;
    return undefined;
  }
}

function disableDefaultIndexedStorage(storage: LocalFavoritesStorage): boolean {
  if (storage !== defaultIndexedFavoritesStorage) return false;
  indexedStorageUnavailable = true;
  const pending = databaseRequest;
  databaseRequest = undefined;
  void pending?.then(
    (database) => database.close(),
    () => undefined,
  );
  return true;
}

function removeLegacyFavorites(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_FAVORITES_KEY);
  } catch {
    // IndexedDB remains the durable source if synchronous storage is disabled.
  }
}

function readLegacySerialized(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const serialized = window.localStorage.getItem(LOCAL_FAVORITES_KEY);
    if (!serialized) return undefined;
    if (serialized.length > MAX_LOCAL_FAVORITES_BYTES) {
      removeLegacyFavorites();
      return undefined;
    }
    return serialized;
  } catch {
    return undefined;
  }
}

function writeLegacyPrepared(prepared: PreparedLocalFavorites): void {
  if (typeof window === "undefined") {
    throw new Error("Coda cannot access local Favorites in this environment.");
  }
  window.localStorage.setItem(LOCAL_FAVORITES_KEY, prepared.serialized);
}

async function readPreparedLegacyFavorites(
  preparation: LocalFavoritesPreparation,
): Promise<LocalFavoriteCollection | undefined> {
  const serialized = readLegacySerialized();
  if (serialized === undefined) return undefined;
  const favorites = await preparation.parse(serialized);
  if (!favorites) removeLegacyFavorites();
  return favorites;
}

export function readLocalFavoritesAsync(
  storage: LocalFavoritesStorage | undefined = indexedFavoritesStorage(),
  preparation: LocalFavoritesPreparation = localFavoritesPreparation,
): Promise<LocalFavoriteCollection> {
  return enqueueStorageOperation(async () => {
    const legacyFavorites = await readPreparedLegacyFavorites(preparation);
    if (legacyFavorites) {
      if (!storage) return legacyFavorites;
      try {
        const prepared = await preparation.serialize(legacyFavorites);
        await storage.write(prepared.serialized);
        removeLegacyFavorites();
        return prepared.favorites;
      } catch {
        disableDefaultIndexedStorage(storage);
        // Leave the legacy snapshot in place so a later launch can retry.
        return legacyFavorites;
      }
    }

    if (!storage) return emptyLocalFavorites();
    try {
      const stored = await storage.read();
      if (typeof stored === "string") {
        const favorites = await preparation.parse(stored);
        if (favorites) return favorites;
      }
      if (stored !== undefined) await storage.clear();
      const prepared = await preparation.serialize(emptyLocalFavorites());
      await storage.write(prepared.serialized);
      return prepared.favorites;
    } catch {
      disableDefaultIndexedStorage(storage);
      return (await readPreparedLegacyFavorites(preparation)) ??
        emptyLocalFavorites();
    }
  });
}

export function writeLocalFavoritesAsync(
  favorites: LocalFavoriteCollection,
  storage: LocalFavoritesStorage | undefined = indexedFavoritesStorage(),
  preparation: LocalFavoritesPreparation = localFavoritesPreparation,
): Promise<LocalFavoriteCollection> {
  return enqueueStorageOperation(async () => {
    const prepared = await preparation.serialize(favorites);
    if (!storage) {
      writeLegacyPrepared(prepared);
      return prepared.favorites;
    }
    try {
      await storage.write(prepared.serialized);
      removeLegacyFavorites();
    } catch (cause) {
      if (!disableDefaultIndexedStorage(storage)) throw cause;
      writeLegacyPrepared(prepared);
    }
    return prepared.favorites;
  });
}

export function clearLocalFavoritesAsync(
  storage: LocalFavoritesStorage | undefined = indexedFavoritesStorage(),
  preparation: LocalFavoritesPreparation = localFavoritesPreparation,
): Promise<LocalFavoriteCollection> {
  return enqueueStorageOperation(async () => {
    if (storage) {
      try {
        await storage.clear();
      } catch (cause) {
        if (!disableDefaultIndexedStorage(storage)) throw cause;
        const tombstone = await preparation.serialize(emptyLocalFavorites());
        writeLegacyPrepared(tombstone);
        return tombstone.favorites;
      }
    } else if (indexedStorageUnavailable) {
      const tombstone = await preparation.serialize(emptyLocalFavorites());
      writeLegacyPrepared(tombstone);
      return tombstone.favorites;
    }
    removeLegacyFavorites();
    return emptyLocalFavorites();
  });
}
