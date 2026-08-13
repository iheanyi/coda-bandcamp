const MAX_PAINTED_COVER_SOURCES = 512;
const paintedCoverSources = new Set<string>();

export function hasPaintedCoverSource(source: string): boolean {
  return paintedCoverSources.has(source);
}

export function forgetPaintedCoverSource(source: string): void {
  paintedCoverSources.delete(source);
}

export function clearPaintedCoverSources(): void {
  paintedCoverSources.clear();
}

export function rememberPaintedCoverSource(source: string): void {
  paintedCoverSources.delete(source);
  paintedCoverSources.add(source);
  if (paintedCoverSources.size <= MAX_PAINTED_COVER_SOURCES) return;
  const oldest = paintedCoverSources.values().next().value;
  if (oldest) paintedCoverSources.delete(oldest);
}
