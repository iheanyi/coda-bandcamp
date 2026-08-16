import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useSyncExternalStore } from "react";
import {
  createCoverArtSourceStore,
  type CoverArtBridge,
} from "./coverArtSourceStore";
import { invokeNative, type NativeValue } from "./data-bridge/native";
import { clearPaintedCoverSources } from "./paintedCoverSources";

export type {
  CoverArtBridge,
  CoverArtSourceStore,
} from "./coverArtSourceStore";

const COVER_ART_UPDATED_EVENT = "coda://cover-art-updated";

const nativeCoverArtBridge = Object.freeze({
  convertFileSource: convertFileSrc,
  invalidate: (coverArtId) =>
    invokeNative("invalidate_cover_art", { coverArtId }),
  listenForUpdates: (handler) =>
    listen<NativeValue>(COVER_ART_UPDATED_EVENT, ({ payload }) => {
      handler(payload);
    }),
} satisfies CoverArtBridge);

const nativeCoverArtSourceStore =
  createCoverArtSourceStore(nativeCoverArtBridge);

export function coverArtSource(
  coverArtId: string,
  revision?: string,
): string | undefined {
  return nativeCoverArtSourceStore.source(coverArtId, revision);
}

export function useCoverArtSource(
  coverArtId: string | undefined,
): string | undefined {
  const readSource = useCallback(
    () =>
      coverArtId ? nativeCoverArtSourceStore.source(coverArtId) : undefined,
    [coverArtId],
  );
  return useSyncExternalStore(
    nativeCoverArtSourceStore.subscribe,
    readSource,
    readSource,
  );
}

export async function invalidateCoverArt(coverArtId: string): Promise<void> {
  await nativeCoverArtSourceStore.invalidate(coverArtId);
}

export function clearCoverArtRendererState(): void {
  nativeCoverArtSourceStore.clear();
  clearPaintedCoverSources();
  window.dispatchEvent(new CustomEvent("coda:refresh-artwork"));
}
