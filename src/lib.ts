import { clearCoverArtRendererState } from "./coverArtSource";
import {
  connectBandcamp as connectBandcampNative,
  type LibrarySyncProgress,
} from "./data-bridge/library";
import { clearRuntimeCaches as clearNativeRuntimeCaches } from "./data-bridge/runtimeData";
import type { Album, ConnectionInput } from "./types";

export {
  fetchDailyArticle,
  fetchDailyArticles,
} from "./data-bridge/daily";
export { isDesktop, openBandcampUrl } from "./data-bridge/desktop";
export { fetchDiscover } from "./data-bridge/discover";
export {
  fetchFavorites,
  reconcileFavoriteTracks,
  setFavorite,
} from "./data-bridge/favorites";
export {
  hydrateAlbum,
  hydrateTrack,
  paletteFor,
} from "./data-bridge/hydration";
export {
  beginLastFmAuthorization,
  completeLastFmAuthorization,
  disconnectLastFm,
  getLastFmStatus,
  openLastFmAuthorization,
  scrobbleLastFm,
  updateLastFmNowPlaying,
} from "./data-bridge/lastfm";
export {
  disconnect,
  fetchAlbum,
  fetchLibrary,
  hasConnection,
  loadLibraryCache,
} from "./data-bridge/library";
export type {
  LibraryCacheSnapshot,
  LibrarySyncProgress,
} from "./data-bridge/library";
export { readLibraryCache } from "./data-bridge/libraryCache";
export {
  createPlaylist,
  deletePlaylist,
  fetchPlaylist,
  fetchPlaylists,
  updatePlaylist,
} from "./data-bridge/playlists";
export {
  fetchRadioShow,
  fetchRadioShows,
} from "./data-bridge/radio";
export {
  fetchStreamUrl,
  invalidateStreamUrl,
} from "./data-bridge/streamUrls";
export type {
  SystemMediaControlEvent,
  SystemMediaMetadataInput,
} from "./data-bridge/systemMedia";
export {
  updateSystemMediaMetadata,
  updateSystemMediaPlayback,
  updateSystemMediaTimeline,
} from "./data-bridge/systemMedia";
export {
  coverCacheDiagnostics,
  type CoverCacheDiagnostics,
} from "./data-bridge/coverCache";
export {
  checkpointPlayerState,
  clearPlayerState,
  loadPlayerState,
  recordPlaybackDiagnostic,
  savePlayerState,
  type PlaybackDiagnosticEvent,
} from "./data-bridge/playerState";
export { formatTime, initials } from "./formatting";

export async function connectBandcamp(
  input: ConnectionInput,
  onPage?: (progress: LibrarySyncProgress) => void,
): Promise<Album[]> {
  const albums = await connectBandcampNative(input, onPage);
  clearCoverArtRendererState();
  return albums;
}

export function clearRuntimeCaches(): void {
  clearCoverArtRendererState();
  clearNativeRuntimeCaches();
}
