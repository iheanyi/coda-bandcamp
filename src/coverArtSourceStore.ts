import { isDesktop } from "./data-bridge/desktop";
import {
  isDataArray,
  isOwnDataRecord,
  isStringValue,
  ownDataProperty,
  type OwnDataPropertyResult,
  type OwnDataValue,
} from "./ownData";

const COVER_ART_PROTOCOL = "coda-cover";
const DEFAULT_REVISION = "0";
const MAX_IDENTIFIER_BYTES = 512;
const MAX_REVISION_LENGTH = 128;
// sessionStorage restore is capped so a stale or oversized blob cannot grow
// without bound. In-memory revision and floor maps are the session authority
// and are not LRU-evicted: their keyspace is covers this renderer has actually
// seen. Each entry is a 512-byte identifier, a 128-character revision, and a
// bigint sequence — small even at the 5,000-album library snapshot plus
// Discover, Radio, and playlist covers visited in one sitting. Evicting those
// maps would reissue ?v=0, the same browser HTTP cache key as the first paint,
// because the native cover protocol ignores v= and s=.
const MAX_PERSISTED_REVISIONS = 5_000;
const RETRY_REVISION_PREFIX = "retry-";
const MAX_ORDERING_SEQUENCE_LENGTH = 20;
const MAX_ORDERING_SEQUENCE = 18_446_744_073_709_551_615n;
const ORDERING_FLOOR_STORAGE_KEY = "coda.cover-art.ordering-floors.v1";
const REVISION_STORAGE_KEY = "coda.cover-art.revisions.v1";
const REVISION_LISTENER_RETRY_INITIAL_MS = 250;
const REVISION_LISTENER_RETRY_MAX_MS = 4_000;
const SESSION_SCOPE_BYTES = 16;
const SESSION_SCOPE_STORAGE_KEY = "coda.cover-art.scope.v1";

type CoverArtUpdatedPayload = {
  coverArtId: string;
  revision: string;
  sequence: bigint;
};

type CoverArtRevision = Readonly<{
  revision: string;
  sequence: bigint;
}>;

export type CoverArtBridge = Readonly<{
  convertFileSource: (path: string, protocol: string) => string;
  invalidate: (coverArtId: string) => Promise<OwnDataValue>;
  listenForUpdates: (
    handler: (payload: OwnDataValue) => void,
  ) => Promise<() => void | Promise<void>>;
}>;

export type CoverArtSourceStore = Readonly<{
  clear: () => void;
  dispose: () => Promise<void>;
  invalidate: (coverArtId: string) => Promise<void>;
  source: (coverArtId: string, revision?: string) => string | undefined;
  subscribe: (subscriber: () => void) => () => void;
}>;

function generateSessionScope(): string {
  const bytes = new Uint8Array(SESSION_SCOPE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function persistSessionScope(value: string): void {
  try {
    globalThis.sessionStorage?.setItem(SESSION_SCOPE_STORAGE_KEY, value);
  } catch {
    // The native cache remains correct when transient web storage is disabled.
  }
}

function loadOrCreateSessionScope(): string {
  try {
    const stored: unknown = globalThis.sessionStorage?.getItem(
      SESSION_SCOPE_STORAGE_KEY,
    );
    if (isStringValue(stored) && /^[a-f0-9]{32}$/.test(stored)) {
      return stored;
    }
  } catch {
    // Fall through to an in-memory scope.
  }
  const generated = generateSessionScope();
  persistSessionScope(generated);
  return generated;
}

function rotateSessionScope(): string {
  const generated = generateSessionScope();
  persistSessionScope(generated);
  return generated;
}

function validCoverArtId(value: string): boolean {
  return (
    value.length > 0 &&
    value.trim() === value &&
    new TextEncoder().encode(value).length <= MAX_IDENTIFIER_BYTES &&
    !Array.from(value).some((character) => /\p{Cc}/u.test(character))
  );
}

function validRevision(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_REVISION_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function parseOrderingSequence(
  value: OwnDataPropertyResult,
  allowZero = false,
): bigint | undefined {
  if (
    !isStringValue(value) ||
    value.length === 0 ||
    value.length > MAX_ORDERING_SEQUENCE_LENGTH ||
    !/^(0|[1-9]\d*)$/.test(value)
  ) {
    return undefined;
  }
  const sequence = BigInt(value);
  if (sequence > MAX_ORDERING_SEQUENCE || (!allowZero && sequence === 0n)) {
    return undefined;
  }
  return sequence;
}

function parseCoverArtUpdatedPayload(
  payload: OwnDataValue,
): CoverArtUpdatedPayload | undefined {
  if (!isOwnDataRecord(payload)) return undefined;
  const coverArtId = ownDataProperty(payload, "coverArtId");
  const revision = ownDataProperty(payload, "revision");
  const sequence = parseOrderingSequence(ownDataProperty(payload, "sequence"));
  if (
    !isStringValue(coverArtId) ||
    !isStringValue(revision) ||
    !validCoverArtId(coverArtId) ||
    !validRevision(revision) ||
    sequence === undefined
  ) {
    return undefined;
  }
  return { coverArtId, revision, sequence };
}

function parseInvalidationSequence(payload: OwnDataValue): bigint {
  if (!isOwnDataRecord(payload)) {
    throw new TypeError(
      "Invalid native response for invalidate_cover_art: expected an ordering receipt.",
    );
  }
  const sequence = parseOrderingSequence(ownDataProperty(payload, "sequence"));
  if (sequence === undefined) {
    throw new TypeError(
      "Invalid native response for invalidate_cover_art: expected an ordering receipt.",
    );
  }
  return sequence;
}

function persistableTail<Value>(
  values: ReadonlyMap<string, Value>,
): ReadonlyArray<readonly [string, Value]> {
  const entries = Array.from(values);
  return entries.length > MAX_PERSISTED_REVISIONS
    ? entries.slice(-MAX_PERSISTED_REVISIONS)
    : entries;
}

function rememberOrderingFloor(
  floors: Map<string, bigint>,
  coverArtId: string,
  sequence: bigint,
): boolean {
  // Native sequences are global, but independent cover events may be
  // delivered out of order. Only the in-memory floor for this cover
  // determines whether its revision is stale, including after the cover
  // falls out of the persisted LRU.
  const current = floors.get(coverArtId);
  if (current !== undefined && sequence <= current) return false;
  floors.delete(coverArtId);
  floors.set(coverArtId, sequence);
  return true;
}

function loadPersistedOrderingFloors(): Map<string, bigint> {
  const restored = new Map<string, bigint>();
  try {
    const stored: unknown = globalThis.sessionStorage?.getItem(
      ORDERING_FLOOR_STORAGE_KEY,
    );
    if (!isStringValue(stored) || stored.length === 0) return restored;
    const parsed: OwnDataValue = JSON.parse(stored);
    if (!isDataArray(parsed)) return restored;
    for (const candidate of parsed.slice(-MAX_PERSISTED_REVISIONS)) {
      if (!isDataArray(candidate) || candidate.length !== 2) continue;
      const [coverArtId, sequenceValue] = candidate;
      const sequence = parseOrderingSequence(sequenceValue);
      if (
        !isStringValue(coverArtId) ||
        !validCoverArtId(coverArtId) ||
        sequence === undefined
      ) {
        continue;
      }
      rememberOrderingFloor(restored, coverArtId, sequence);
    }
  } catch {
    // A disabled or malformed transient store must not block artwork.
  }
  return restored;
}

function persistOrderingFloors(floors: ReadonlyMap<string, bigint>): void {
  try {
    globalThis.sessionStorage?.setItem(
      ORDERING_FLOOR_STORAGE_KEY,
      JSON.stringify(
        persistableTail(floors).map(([coverArtId, sequence]) => [
          coverArtId,
          sequence.toString(),
        ]),
      ),
    );
  } catch {
    // The in-memory floors still order this store instance.
  }
}

function loadPersistedRevisions(): Map<string, CoverArtRevision> {
  const restored = new Map<string, CoverArtRevision>();
  try {
    const stored: unknown =
      globalThis.sessionStorage?.getItem(REVISION_STORAGE_KEY);
    if (!isStringValue(stored) || stored.length === 0) return restored;
    const parsed: OwnDataValue = JSON.parse(stored);
    if (!isDataArray(parsed)) return restored;
    for (const candidate of parsed.slice(-MAX_PERSISTED_REVISIONS)) {
      if (
        !isDataArray(candidate) ||
        (candidate.length !== 2 && candidate.length !== 3)
      ) {
        continue;
      }
      const [coverArtId, revision, sequenceValue = "0"] = candidate;
      const sequence = parseOrderingSequence(sequenceValue, true);
      if (
        !isStringValue(coverArtId) ||
        !isStringValue(revision) ||
        !validCoverArtId(coverArtId) ||
        !validRevision(revision) ||
        sequence === undefined
      ) {
        continue;
      }
      restored.delete(coverArtId);
      restored.set(coverArtId, { revision, sequence });
    }
  } catch {
    // A disabled or malformed transient store must not block artwork.
  }
  return restored;
}

function disposeRevisionListener(
  dispose: () => void | Promise<void>,
): Promise<void> {
  try {
    return Promise.resolve(dispose()).catch(() => undefined);
  } catch {
    // A failed platform cleanup must not retain listener ownership.
    return Promise.resolve();
  }
}

export function createCoverArtSourceStore(
  bridge: CoverArtBridge,
): CoverArtSourceStore {
  const revisions = loadPersistedRevisions();
  const orderingFloors = loadPersistedOrderingFloors();
  for (const [coverArtId, value] of revisions) {
    if (value.sequence > 0n) {
      rememberOrderingFloor(orderingFloors, coverArtId, value.sequence);
    }
  }
  const subscribers = new Set<() => void>();
  let disposed = false;
  let disposePromise: Promise<void> | undefined;
  let invalidationGenerationToken = Symbol();
  let listenerDisposer: (() => void | Promise<void>) | undefined;
  let listenerGeneration = 0;
  let listenerRequest: Promise<void> | undefined;
  let listenerRetryAttempt = 0;
  let listenerRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let listenerShutdown: Promise<void> | undefined;
  let listenerTeardownGeneration = 0;
  let revisionPersistenceTimer: ReturnType<typeof setTimeout> | undefined;
  let sessionScope = loadOrCreateSessionScope();

  const persistRevisionMetadata = (): void => {
    try {
      if (revisions.size === 0) {
        globalThis.sessionStorage?.removeItem(REVISION_STORAGE_KEY);
      } else {
        globalThis.sessionStorage?.setItem(
          REVISION_STORAGE_KEY,
          JSON.stringify(
            persistableTail(revisions).map(([coverArtId, value]) => [
              coverArtId,
              value.revision,
              value.sequence.toString(),
            ]),
          ),
        );
      }
    } catch {
      // The native cache remains correct when transient web storage is disabled.
    }
    persistOrderingFloors(orderingFloors);
  };

  const scheduleRevisionPersistence = (): void => {
    if (disposed || revisionPersistenceTimer !== undefined) return;
    revisionPersistenceTimer = setTimeout(() => {
      revisionPersistenceTimer = undefined;
      if (!disposed) persistRevisionMetadata();
    }, 0);
  };

  const advanceOrderingSequence = (
    coverArtId: string,
    sequence: bigint,
  ): boolean => {
    if (!rememberOrderingFloor(orderingFloors, coverArtId, sequence)) {
      return false;
    }
    scheduleRevisionPersistence();
    return true;
  };

  const rememberRevision = (
    coverArtId: string,
    revision: string,
    sequence: bigint,
  ): boolean => {
    if (!advanceOrderingSequence(coverArtId, sequence)) return false;
    const previous = revisions.get(coverArtId);
    revisions.delete(coverArtId);
    revisions.set(coverArtId, { revision, sequence });
    scheduleRevisionPersistence();
    return previous?.revision !== revision;
  };

  const clearPersistedRevisions = (): void => {
    if (revisionPersistenceTimer !== undefined) {
      clearTimeout(revisionPersistenceTimer);
      revisionPersistenceTimer = undefined;
    }
    persistOrderingFloors(orderingFloors);
    revisions.clear();
    try {
      globalThis.sessionStorage?.removeItem(REVISION_STORAGE_KEY);
    } catch {
      // The in-memory clear is still authoritative for this renderer.
    }
  };

  const emitChange = (): void => {
    for (const subscriber of subscribers) subscriber();
  };

  const applyRevision = (payload: OwnDataValue): void => {
    if (disposed) return;
    const update = parseCoverArtUpdatedPayload(payload);
    if (!update) return;
    const changed = rememberRevision(
      update.coverArtId,
      update.revision,
      update.sequence,
    );
    if (changed) emitChange();
  };

  const resetRevisionListener = (): Promise<void> | undefined => {
    listenerGeneration += 1;
    listenerRetryAttempt = 0;
    if (listenerRetryTimer !== undefined) {
      clearTimeout(listenerRetryTimer);
      listenerRetryTimer = undefined;
    }
    const request = listenerRequest;
    const dispose = listenerDisposer;
    listenerDisposer = undefined;
    listenerRequest = undefined;
    if (dispose) return disposeRevisionListener(dispose);
    return request;
  };

  const scheduleRevisionListenerRetry = (): void => {
    if (
      disposed ||
      !isDesktop() ||
      subscribers.size === 0 ||
      listenerRequest ||
      listenerDisposer ||
      listenerRetryTimer !== undefined ||
      listenerShutdown
    ) {
      return;
    }
    const delay = Math.min(
      REVISION_LISTENER_RETRY_INITIAL_MS * 2 ** listenerRetryAttempt,
      REVISION_LISTENER_RETRY_MAX_MS,
    );
    if (delay < REVISION_LISTENER_RETRY_MAX_MS) listenerRetryAttempt += 1;
    const generation = listenerGeneration;
    listenerRetryTimer = setTimeout(() => {
      listenerRetryTimer = undefined;
      if (disposed || generation !== listenerGeneration) return;
      ensureRevisionListener();
    }, delay);
  };

  const ensureRevisionListener = (): void => {
    if (
      disposed ||
      !isDesktop() ||
      subscribers.size === 0 ||
      listenerRequest ||
      listenerDisposer ||
      listenerRetryTimer !== undefined ||
      listenerShutdown
    ) {
      return;
    }
    const generation = listenerGeneration;
    let registration: Promise<() => void | Promise<void>>;
    try {
      registration = bridge.listenForUpdates((payload) => {
        if (!disposed && generation === listenerGeneration) {
          applyRevision(payload);
        }
      });
    } catch {
      scheduleRevisionListenerRetry();
      return;
    }
    const request = registration
      .then(async (dispose) => {
        if (disposed || generation !== listenerGeneration) {
          await disposeRevisionListener(dispose);
          return;
        }
        listenerDisposer = dispose;
        listenerRetryAttempt = 0;
      })
      .catch(() => {
        if (
          !disposed &&
          generation === listenerGeneration &&
          listenerRequest === request
        ) {
          listenerRequest = undefined;
          listenerDisposer = undefined;
          scheduleRevisionListenerRetry();
        }
      });
    listenerRequest = request;
  };

  const reconcileRevisionListener = (): void => {
    if (disposed || listenerShutdown) return;
    if (subscribers.size === 0) {
      if (listenerRequest) restartRevisionListener();
      return;
    }
    ensureRevisionListener();
  };

  const restartRevisionListener = (): void => {
    listenerTeardownGeneration += 1;
    if (disposed || listenerShutdown) return;
    const shutdown = resetRevisionListener();
    if (!shutdown) {
      reconcileRevisionListener();
      return;
    }
    listenerShutdown = shutdown;
    void shutdown.then(() => {
      if (listenerShutdown !== shutdown) return;
      listenerShutdown = undefined;
      reconcileRevisionListener();
    });
  };

  const scheduleRevisionListenerTeardown = (): void => {
    const generation = ++listenerTeardownGeneration;
    queueMicrotask(() => {
      if (
        disposed ||
        generation !== listenerTeardownGeneration ||
        subscribers.size > 0
      ) {
        return;
      }
      restartRevisionListener();
    });
  };

  const subscribe = (subscriber: () => void): (() => void) => {
    if (disposed) return () => undefined;
    listenerTeardownGeneration += 1;
    subscribers.add(subscriber);
    reconcileRevisionListener();
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) scheduleRevisionListenerTeardown();
    };
  };

  const revisionFor = (coverArtId: string): string | undefined => {
    if (!validCoverArtId(coverArtId)) return undefined;
    return revisions.get(coverArtId)?.revision ?? DEFAULT_REVISION;
  };

  const source = (
    coverArtId: string,
    revision = revisionFor(coverArtId),
  ): string | undefined => {
    if (
      disposed ||
      !isDesktop() ||
      !validCoverArtId(coverArtId) ||
      !revision ||
      !validRevision(revision)
    ) {
      return undefined;
    }
    const route = `/v1/600/${encodeURIComponent(coverArtId)}?v=${revision}&s=${sessionScope}`;
    try {
      const convertedOrigin = bridge.convertFileSource("", COVER_ART_PROTOCOL);
      const base = convertedOrigin.endsWith("/")
        ? convertedOrigin
        : `${convertedOrigin}/`;
      return new URL(route, base).toString();
    } catch {
      return undefined;
    }
  };

  const invalidate = async (coverArtId: string): Promise<void> => {
    if (disposed || !isDesktop() || !validCoverArtId(coverArtId)) return;
    const generationToken = invalidationGenerationToken;
    const sequence = parseInvalidationSequence(
      await bridge.invalidate(coverArtId),
    );
    if (disposed || generationToken !== invalidationGenerationToken) {
      advanceOrderingSequence(coverArtId, sequence);
      return;
    }
    const changed = rememberRevision(
      coverArtId,
      `${RETRY_REVISION_PREFIX}${sequence}`,
      sequence,
    );
    if (changed) emitChange();
  };

  const clear = (): void => {
    if (disposed) return;
    invalidationGenerationToken = Symbol();
    restartRevisionListener();
    clearPersistedRevisions();
    sessionScope = rotateSessionScope();
    emitChange();
  };

  const dispose = (): Promise<void> => {
    if (disposePromise) return disposePromise;
    disposed = true;
    invalidationGenerationToken = Symbol();
    listenerTeardownGeneration += 1;
    subscribers.clear();
    if (revisionPersistenceTimer !== undefined) {
      clearTimeout(revisionPersistenceTimer);
      revisionPersistenceTimer = undefined;
      persistRevisionMetadata();
    }
    const activeShutdown = listenerShutdown;
    const requestedShutdown = resetRevisionListener();
    disposePromise = Promise.all([activeShutdown, requestedShutdown]).then(
      () => undefined,
    );
    return disposePromise;
  };

  return Object.freeze({
    clear,
    dispose,
    invalidate,
    source,
    subscribe,
  });
}
