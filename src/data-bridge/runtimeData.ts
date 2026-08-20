import { clearStoredLibraryCache } from "./libraryCache";
import { clearStreamUrlCache } from "./streamUrls";

export function clearConnectionMediaCaches(): void {
  clearStreamUrlCache();
}

export function clearRuntimeCaches(): void {
  clearConnectionMediaCaches();
  clearStoredLibraryCache();
}
