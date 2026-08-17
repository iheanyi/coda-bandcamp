import { clearCoverArtRendererState } from "../coverArtSource";
import { clearStoredLibraryCache } from "./libraryCache";
import { clearStreamUrlCache } from "./streamUrls";

export function clearConnectionMediaCaches(): void {
  clearCoverArtRendererState();
  clearStreamUrlCache();
}

export function clearRuntimeCaches(): void {
  clearConnectionMediaCaches();
  clearStoredLibraryCache();
}
