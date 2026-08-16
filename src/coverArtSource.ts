import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";
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

const revisions = loadPersistedRevisions();
const subscribers = new Set<() => void>();
let listenerRequest: Promise<void> | undefined;
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
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return restored;
    for (const entry of parsed.slice(-MAX_PERSISTED_REVISIONS)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [coverArtId, revision] = entry;
      if (
        typeof coverArtId !== "string" ||
        typeof revision !== "string" ||
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

function emitChange(): void {
  for (const subscriber of subscribers) subscriber();
}

function applyRevision(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const { coverArtId, revision } = payload as Partial<CoverArtUpdatedPayload>;
  if (
    typeof coverArtId !== "string" ||
    typeof revision !== "string" ||
    !validCoverArtId(coverArtId) ||
    !validRevision(revision) ||
    revisions.get(coverArtId) === revision
  ) {
    return;
  }
  rememberRevision(coverArtId, revision);
  emitChange();
}

function ensureRevisionListener(): void {
  if (!isDesktop() || listenerRequest) return;
  listenerRequest = listen<unknown>(COVER_ART_UPDATED_EVENT, ({ payload }) => {
    applyRevision(payload);
  })
    .then(() => undefined)
    .catch(() => {
      listenerRequest = undefined;
    });
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  ensureRevisionListener();
  return () => subscribers.delete(subscriber);
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
): string | undefined {
  if (!isDesktop() || !validCoverArtId(coverArtId) || !revision) {
    return undefined;
  }
  if (!validRevision(revision)) return undefined;
  const route = `/v1/600/${encodeURIComponent(coverArtId)}?v=${revision}&s=${scope}`;
  try {
    const convertedOrigin = convertFileSrc("", COVER_ART_PROTOCOL);
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
): string | undefined {
  return coverArtSourceForScope(coverArtId, revision, sessionScope);
}

export function useCoverArtSource(
  coverArtId: string | undefined,
): string | undefined {
  const sourceSnapshot = useSyncExternalStore(
    subscribe,
    () => sourceSnapshotFor(coverArtId),
    () => sourceSnapshotFor(coverArtId),
  );
  if (!coverArtId || !sourceSnapshot) return undefined;
  const separator = sourceSnapshot.indexOf(":");
  return coverArtSourceForScope(
    coverArtId,
    sourceSnapshot.slice(separator + 1),
    sourceSnapshot.slice(0, separator),
  );
}

export async function invalidateCoverArt(coverArtId: string): Promise<void> {
  if (!isDesktop() || !validCoverArtId(coverArtId)) return;
  await invoke("invalidate_cover_art", { coverArtId });
  retryRevision = (retryRevision + 1) % Number.MAX_SAFE_INTEGER;
  rememberRevision(coverArtId, `retry-${retryRevision}`);
  emitChange();
}

export function clearCoverArtRendererState(): void {
  clearPersistedRevisions();
  clearPaintedCoverSources();
  sessionScope = rotateSessionScope();
  emitChange();
  window.dispatchEvent(new CustomEvent("coda:refresh-artwork"));
}
