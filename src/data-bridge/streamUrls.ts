import { decodeNativeBandcampUrl, invokeNative } from "./native";

const MAX_MEDIA_URLS = 512;
const STREAM_URL_CACHE_TTL_MS = 10 * 60 * 1_000;

type RuntimeCacheEntry<T> = {
  promise: Promise<T>;
  expiresAt: number;
  value?: T;
};

export type StreamUrlFetcher = (trackId: string) => Promise<string>;

export type StreamUrlRepository = Readonly<{
  fetch: StreamUrlFetcher;
  invalidate: (trackId: string) => void;
  clear: () => void;
}>;

function rememberPromise<T>(
  cache: Map<string, RuntimeCacheEntry<T>>,
  key: string,
  load: () => Promise<T>,
  limit: number,
  ttlMs: number,
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key);
  if (existing && existing.expiresAt > now) {
    cache.delete(key);
    cache.set(key, existing);
    return existing.promise;
  }
  if (existing) {
    cache.delete(key);
  }

  let request: Promise<T>;
  request = load()
    .then((value) => {
      const entry = cache.get(key);
      if (entry?.promise === request) entry.value = value;
      return value;
    })
    .catch((error) => {
      if (cache.get(key)?.promise === request) {
        cache.delete(key);
      }
      throw error;
    });
  cache.set(key, {
    promise: request,
    expiresAt: now + ttlMs,
  });
  if (cache.size > limit) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return request;
}

export function createStreamUrlRepository(
  fetchStreamUrl: StreamUrlFetcher,
): StreamUrlRepository {
  const cache = new Map<string, RuntimeCacheEntry<string>>();
  return Object.freeze({
    fetch(trackId: string): Promise<string> {
      return rememberPromise(
        cache,
        trackId,
        () => fetchStreamUrl(trackId),
        MAX_MEDIA_URLS,
        STREAM_URL_CACHE_TTL_MS,
      );
    },
    invalidate(trackId: string): void {
      cache.delete(trackId);
    },
    clear(): void {
      cache.clear();
    },
  });
}

const nativeStreamUrls = createStreamUrlRepository(async (trackId) =>
  decodeNativeBandcampUrl(
    await invokeNative("get_stream_url", { trackId }),
    "get_stream_url",
  ),
);

export function fetchStreamUrl(trackId: string): Promise<string> {
  return nativeStreamUrls.fetch(trackId);
}

export function invalidateStreamUrl(trackId: string): void {
  nativeStreamUrls.invalidate(trackId);
}

export function clearStreamUrlCache(): void {
  nativeStreamUrls.clear();
}
