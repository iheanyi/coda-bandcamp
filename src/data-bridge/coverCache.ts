import {
  decodeNativeBoolean,
  decodeNativeInteger,
  decodeNativeRecord,
  invokeNative,
  type NativeValue,
} from "./native";

export type CoverCacheDiagnostics = {
  entryCount: number;
  totalBytes: number;
  hitCount: number;
  missCount: number;
  staleCount: number;
  cleanupPending: boolean;
};

function parseCoverCacheDiagnostics(
  value: NativeValue,
  context: string,
): CoverCacheDiagnostics {
  const record = decodeNativeRecord(value, context);
  return {
    entryCount: decodeNativeInteger(
      record.entryCount,
      `${context}.entryCount`,
      5_000,
    ),
    totalBytes: decodeNativeInteger(
      record.totalBytes,
      `${context}.totalBytes`,
      256 * 1024 * 1024,
    ),
    hitCount: decodeNativeInteger(record.hitCount, `${context}.hitCount`),
    missCount: decodeNativeInteger(record.missCount, `${context}.missCount`),
    staleCount: decodeNativeInteger(
      record.staleCount,
      `${context}.staleCount`,
    ),
    cleanupPending: decodeNativeBoolean(
      record.cleanupPending,
      `${context}.cleanupPending`,
    ),
  };
}

export async function coverCacheDiagnostics(): Promise<CoverCacheDiagnostics> {
  return parseCoverCacheDiagnostics(
    await invokeNative("cover_cache_diagnostics"),
    "cover_cache_diagnostics",
  );
}
