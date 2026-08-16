const MAX_PAINTED_COVER_SOURCES = 512;
const PAINTED_COVER_STORAGE_KEY = "coda.cover-art.painted.v1";
const paintedCoverSources = new Set<string>();
const paintedLocalCoverKeys = loadPaintedLocalCoverKeys();
let persistenceQueued = false;

type PaintedCoverWireRecord = {
  [field: string]: PaintedCoverWireValue;
};

type PaintedCoverWireValue =
  | string
  | number
  | boolean
  | null
  | PaintedCoverWireValue[]
  | PaintedCoverWireRecord;

function isPaintedCoverKey(value: PaintedCoverWireValue): value is string {
  return String(value) === value && /^[a-f0-9]{8}$/.test(value);
}

function isLocalCoverSource(source: string): boolean {
  try {
    const url = new URL(source);
    return (
      url.protocol === "coda-cover:" ||
      (url.protocol === "http:" && url.hostname === "coda-cover.localhost")
    );
  } catch {
    return false;
  }
}

function sourceKey(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function loadPaintedLocalCoverKeys(): Set<string> {
  try {
    const stored = globalThis.sessionStorage?.getItem(
      PAINTED_COVER_STORAGE_KEY,
    );
    if (!stored) return new Set();
    const parsed: PaintedCoverWireValue = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .filter(isPaintedCoverKey)
        .slice(-MAX_PAINTED_COVER_SOURCES),
    );
  } catch {
    return new Set();
  }
}

function persistPaintedLocalCoverKeys(): void {
  try {
    globalThis.sessionStorage?.setItem(
      PAINTED_COVER_STORAGE_KEY,
      JSON.stringify(Array.from(paintedLocalCoverKeys)),
    );
  } catch {
    // Rendering remains correct when transient web storage is unavailable.
  }
}

function queuePaintedKeyPersistence(): void {
  if (persistenceQueued) return;
  persistenceQueued = true;
  queueMicrotask(() => {
    persistenceQueued = false;
    persistPaintedLocalCoverKeys();
  });
}

export function hasPaintedCoverSource(source: string): boolean {
  return (
    paintedCoverSources.has(source) ||
    (isLocalCoverSource(source) && paintedLocalCoverKeys.has(sourceKey(source)))
  );
}

export function forgetPaintedCoverSource(source: string): void {
  paintedCoverSources.delete(source);
  if (!isLocalCoverSource(source)) return;
  paintedLocalCoverKeys.delete(sourceKey(source));
  queuePaintedKeyPersistence();
}

export function clearPaintedCoverSources(): void {
  paintedCoverSources.clear();
  paintedLocalCoverKeys.clear();
  persistenceQueued = false;
  try {
    globalThis.sessionStorage?.removeItem(PAINTED_COVER_STORAGE_KEY);
  } catch {
    // Rendering remains correct when transient web storage is unavailable.
  }
}

export function rememberPaintedCoverSource(source: string): void {
  paintedCoverSources.delete(source);
  paintedCoverSources.add(source);
  if (paintedCoverSources.size > MAX_PAINTED_COVER_SOURCES) {
    const oldest = paintedCoverSources.values().next().value;
    if (oldest) paintedCoverSources.delete(oldest);
  }
  if (!isLocalCoverSource(source)) return;
  const key = sourceKey(source);
  paintedLocalCoverKeys.delete(key);
  paintedLocalCoverKeys.add(key);
  if (paintedLocalCoverKeys.size > MAX_PAINTED_COVER_SOURCES) {
    const oldestKey = paintedLocalCoverKeys.values().next().value;
    if (oldestKey) paintedLocalCoverKeys.delete(oldestKey);
  }
  queuePaintedKeyPersistence();
}
