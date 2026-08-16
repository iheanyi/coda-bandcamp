import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useSyncExternalStore } from "react";
import { clearPaintedCoverSources } from "./paintedCoverSources";

const COVER_ART_UPDATED_EVENT = "coda://cover-art-updated";
const COVER_ART_PROTOCOL = "coda-cover";
const DEFAULT_REVISION = "0";
const MAX_IDENTIFIER_BYTES = 512;
const MAX_REVISION_LENGTH = 128;
const MAX_PERSISTED_REVISIONS = 5_000;
const SESSION_SCOPE_BYTES = 16;
const REVISION_STORAGE_KEY = "coda.cover-art.revisions.v1";
const SESSION_SCOPE_STORAGE_KEY = "coda.cover-art.scope.v1";

type CoverArtUpdatedPayload = {
  coverArtId: string;
  revision: string;
};

type CoverArtSubscription = Readonly<{
  bridge: CoverArtBridge;
  notify: () => void;
}>;

type CoverArtWireRecord = {
  [field: string]: CoverArtWireValue;
};

export type CoverArtWireValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | CoverArtWireValue[]
  | CoverArtWireRecord;

export type CoverArtBridge = Readonly<{
  convertFileSource: (path: string, protocol: string) => string;
  invalidate: (coverArtId: string) => Promise<void>;
  listenForUpdates: (
    handler: (payload: CoverArtWireValue) => void,
  ) => Promise<() => void | Promise<void>>;
}>;

const nativeCoverArtBridge = Object.freeze({
  convertFileSource: convertFileSrc,
  invalidate: (coverArtId) => invoke("invalidate_cover_art", { coverArtId }),
  listenForUpdates: (handler) =>
    listen<CoverArtWireValue>(COVER_ART_UPDATED_EVENT, ({ payload }) => {
      handler(payload);
    }),
} satisfies CoverArtBridge);

const revisions = loadPersistedRevisions();
const subscribers = new Set<CoverArtSubscription>();
let listenerBridge: CoverArtBridge | undefined;
let listenerRequest: Promise<void> | undefined;
let listenerDisposer: (() => void | Promise<void>) | undefined;
let listenerGeneration = 0;
let listenerShutdown: Promise<void> | undefined;
let listenerTeardownGeneration = 0;
let retryRevision = 0;
let revisionPersistenceTimer: ReturnType<typeof setTimeout> | undefined;
let sessionScope = loadOrCreateSessionScope();

function generateSessionScope(): string {
  const bytes = new Uint8Array(SESSION_SCOPE_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function validSessionScope(value: string | null): value is string {
  return Boolean(value && /^[a-f0-9]{32}$/.test(value));
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
    const stored = globalThis.sessionStorage?.getItem(
      SESSION_SCOPE_STORAGE_KEY,
    );
    if (validSessionScope(stored)) return stored;
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

function loadPersistedRevisions(): Map<string, string> {
  const restored = new Map<string, string>();
  try {
    const stored = globalThis.sessionStorage?.getItem(REVISION_STORAGE_KEY);
    if (!stored) return restored;
    const parsed: CoverArtWireValue = JSON.parse(stored);
    if (!Array.isArray(parsed)) return restored;
    for (const entry of parsed.slice(-MAX_PERSISTED_REVISIONS)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [coverArtId, revision] = entry;
      if (
        String(coverArtId) !== coverArtId ||
        String(revision) !== revision ||
        !validCoverArtId(coverArtId) ||
        !validRevision(revision)
      ) {
        continue;
      }
      restored.delete(coverArtId);
      restored.set(coverArtId, revision);
    }
  } catch {
    // A disabled or malformed transient store must not block artwork.
  }
  return restored;
}

function persistRevisions(): void {
  try {
    globalThis.sessionStorage?.setItem(
      REVISION_STORAGE_KEY,
      JSON.stringify(Array.from(revisions)),
    );
  } catch {
    // The native cache remains correct when transient web storage is disabled.
  }
}

function scheduleRevisionPersistence(): void {
  if (revisionPersistenceTimer !== undefined) return;
  revisionPersistenceTimer = setTimeout(() => {
    revisionPersistenceTimer = undefined;
    persistRevisions();
  }, 0);
}

function rememberRevision(coverArtId: string, revision: string): void {
  revisions.delete(coverArtId);
  revisions.set(coverArtId, revision);
  if (revisions.size > MAX_PERSISTED_REVISIONS) {
    const oldestCoverArtId = revisions.keys().next().value;
    if (oldestCoverArtId) revisions.delete(oldestCoverArtId);
  }
  scheduleRevisionPersistence();
}

function clearPersistedRevisions(): void {
  if (revisionPersistenceTimer !== undefined) {
    clearTimeout(revisionPersistenceTimer);
    revisionPersistenceTimer = undefined;
  }
  revisions.clear();
  try {
    globalThis.sessionStorage?.removeItem(REVISION_STORAGE_KEY);
  } catch {
    // The in-memory clear is still authoritative for this renderer.
  }
}

function isDesktop(): boolean {
  return "__TAURI_INTERNALS__" in window;
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

function isCoverArtWireRecord(
  value: CoverArtWireValue,
): value is CoverArtWireRecord {
  return (
    value !== null &&
    value !== undefined &&
    Object(value) === value &&
    !Array.isArray(value)
  );
}

function emitChange(): void {
  for (const subscriber of subscribers) subscriber.notify();
}

function parseCoverArtUpdatedPayload(
  payload: CoverArtWireValue,
): CoverArtUpdatedPayload | undefined {
  if (!isCoverArtWireRecord(payload)) return undefined;
  const { coverArtId, revision } = payload;
  if (
    String(coverArtId) !== coverArtId ||
    String(revision) !== revision ||
    !validCoverArtId(coverArtId) ||
    !validRevision(revision)
  ) {
    return undefined;
  }
  return { coverArtId, revision };
}

function applyRevision(payload: CoverArtWireValue): void {
  const update = parseCoverArtUpdatedPayload(payload);
  if (!update || revisions.get(update.coverArtId) === update.revision) return;
  const { coverArtId, revision } = update;
  rememberRevision(coverArtId, revision);
  emitChange();
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

function preferredRevisionBridge(): CoverArtBridge | undefined {
  let injectedBridge: CoverArtBridge | undefined;
  for (const subscriber of subscribers) {
    if (subscriber.bridge === nativeCoverArtBridge) return nativeCoverArtBridge;
    injectedBridge ??= subscriber.bridge;
  }
  return injectedBridge;
}

function ensureRevisionListener(): void {
  const bridge = preferredRevisionBridge();
  if (!isDesktop() || !bridge || listenerRequest || listenerShutdown) return;
  const generation = listenerGeneration;
  listenerBridge = bridge;
  listenerRequest = bridge
    .listenForUpdates(applyRevision)
    .then(async (dispose) => {
      if (generation !== listenerGeneration || listenerBridge !== bridge) {
        await disposeRevisionListener(dispose);
        return;
      }
      listenerDisposer = dispose;
    })
    .catch(() => {
      if (generation === listenerGeneration) {
        listenerRequest = undefined;
        listenerDisposer = undefined;
        listenerBridge = undefined;
      }
    });
}

function resetRevisionListener(): Promise<void> | undefined {
  listenerGeneration += 1;
  const request = listenerRequest;
  const dispose = listenerDisposer;
  listenerBridge = undefined;
  listenerDisposer = undefined;
  listenerRequest = undefined;
  if (dispose) return disposeRevisionListener(dispose);
  return request;
}

function restartRevisionListener(): void {
  listenerTeardownGeneration += 1;
  if (listenerShutdown) return;
  const shutdown = resetRevisionListener();
  if (!shutdown) {
    ensureRevisionListener();
    return;
  }
  listenerShutdown = shutdown;
  void shutdown.then(() => {
    if (listenerShutdown !== shutdown) return;
    listenerShutdown = undefined;
    reconcileRevisionListener();
  });
}

function reconcileRevisionListener(): void {
  if (listenerShutdown) return;
  const preferredBridge = preferredRevisionBridge();
  if (!preferredBridge) {
    if (listenerRequest) restartRevisionListener();
    return;
  }
  if (listenerBridge && listenerBridge !== preferredBridge) {
    restartRevisionListener();
    return;
  }
  ensureRevisionListener();
}

function scheduleRevisionListenerTeardown(): void {
  const generation = ++listenerTeardownGeneration;
  queueMicrotask(() => {
    if (generation !== listenerTeardownGeneration || subscribers.size > 0) {
      return;
    }
    restartRevisionListener();
  });
}

function subscribe(subscriber: () => void, bridge: CoverArtBridge): () => void {
  const subscription = Object.freeze({ bridge, notify: subscriber });
  listenerTeardownGeneration += 1;
  subscribers.add(subscription);
  reconcileRevisionListener();
  return () => {
    subscribers.delete(subscription);
    if (subscribers.size === 0) {
      scheduleRevisionListenerTeardown();
      return;
    }
    reconcileRevisionListener();
  };
}

function revisionFor(coverArtId: string | undefined): string | undefined {
  if (!coverArtId || !validCoverArtId(coverArtId)) return undefined;
  return revisions.get(coverArtId) ?? DEFAULT_REVISION;
}

function sourceSnapshotFor(coverArtId: string | undefined): string | undefined {
  const revision = revisionFor(coverArtId);
  return revision ? `${sessionScope}:${revision}` : undefined;
}

function coverArtSourceForScope(
  coverArtId: string,
  revision: string | undefined,
  scope: string,
  bridge: CoverArtBridge,
): string | undefined {
  if (!isDesktop() || !validCoverArtId(coverArtId) || !revision) {
    return undefined;
  }
  if (!validRevision(revision)) return undefined;
  const route = `/v1/600/${encodeURIComponent(coverArtId)}?v=${revision}&s=${scope}`;
  try {
    const convertedOrigin = bridge.convertFileSource("", COVER_ART_PROTOCOL);
    const base = convertedOrigin.endsWith("/")
      ? convertedOrigin
      : `${convertedOrigin}/`;
    return new URL(route, base).toString();
  } catch {
    return undefined;
  }
}

export function coverArtSource(
  coverArtId: string,
  revision = revisionFor(coverArtId),
  bridge: CoverArtBridge = nativeCoverArtBridge,
): string | undefined {
  return coverArtSourceForScope(coverArtId, revision, sessionScope, bridge);
}

export function useCoverArtSource(
  coverArtId: string | undefined,
  bridge: CoverArtBridge = nativeCoverArtBridge,
): string | undefined {
  const subscribeToBridge = useCallback(
    (subscriber: () => void) => subscribe(subscriber, bridge),
    [bridge],
  );
  const sourceSnapshot = useSyncExternalStore(
    subscribeToBridge,
    () => sourceSnapshotFor(coverArtId),
    () => sourceSnapshotFor(coverArtId),
  );
  if (!coverArtId || !sourceSnapshot) return undefined;
  const separator = sourceSnapshot.indexOf(":");
  return coverArtSourceForScope(
    coverArtId,
    sourceSnapshot.slice(separator + 1),
    sourceSnapshot.slice(0, separator),
    bridge,
  );
}

export async function invalidateCoverArt(
  coverArtId: string,
  bridge: CoverArtBridge = nativeCoverArtBridge,
): Promise<void> {
  if (!isDesktop() || !validCoverArtId(coverArtId)) return;
  await bridge.invalidate(coverArtId);
  retryRevision = (retryRevision + 1) % Number.MAX_SAFE_INTEGER;
  rememberRevision(coverArtId, `retry-${retryRevision}`);
  emitChange();
}

export function clearCoverArtRendererState(): void {
  restartRevisionListener();
  clearPersistedRevisions();
  clearPaintedCoverSources();
  sessionScope = rotateSessionScope();
  emitChange();
  window.dispatchEvent(new CustomEvent("coda:refresh-artwork"));
}
