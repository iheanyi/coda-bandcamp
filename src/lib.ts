import { isDesktop } from "./data-bridge/desktop";
import {
  decodeNativeBoolean,
  decodeNativeInteger,
  decodeNativeRecord,
  decodeNativeVoid,
  invokeNative,
  type NativeValue,
} from "./data-bridge/native";
import {
  createPlayerStateCheckpoint,
  parsePlayerStateAsync,
  PLAYER_STATE_CONTRACT_VERSION,
} from "./playerState";
import {
  preparePlayerStateSnapshot,
  waitForPlayerStateIdle,
} from "./playerStatePreparation";
import type {
  PlayerStateCheckpoint,
  PlayerStateInput,
  PlayerStateSnapshot,
} from "./types";

export {
  fetchDailyArticle,
  fetchDailyArticles,
} from "./data-bridge/daily";
export { isDesktop } from "./data-bridge/desktop";
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
  connectBandcamp,
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
export { clearRuntimeCaches } from "./data-bridge/runtimeData";
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

let playerStateContractVersionRequest: Promise<number> | undefined;

async function nativePlayerStateContractVersion(): Promise<number> {
  if (!playerStateContractVersionRequest) {
    playerStateContractVersionRequest = invokeNative(
      "player_state_contract_version",
    )
      .then((value) =>
        decodeNativeInteger(
          value,
          "player_state_contract_version",
          255,
          1,
        ),
      )
      // An older native process will not know this command while Tauri is
      // rebuilding. Keep the durable queue compatible until it restarts.
      .catch(() => 1);
  }
  return playerStateContractVersionRequest;
}

function forNativePlayerStateContract<
  T extends { radioScrobbleProgress?: unknown },
>(value: T, contractVersion: number): T | Omit<T, "radioScrobbleProgress"> {
  if (contractVersion >= PLAYER_STATE_CONTRACT_VERSION) return value;
  const { radioScrobbleProgress: _unsupported, ...legacy } = value;
  return legacy;
}

function recordPlayerStateDiagnostic(event: string): void {
  void invokeNative("record_player_state_diagnostic", { event })
    .then((value) =>
      decodeNativeVoid(value, "record_player_state_diagnostic"),
    )
    .catch(() => undefined);
}

export async function loadPlayerState(): Promise<
  PlayerStateSnapshot | undefined
> {
  if (!isDesktop()) return undefined;
  let value: NativeValue;
  try {
    value = await invokeNative("load_player_state");
  } catch (cause) {
    recordPlayerStateDiagnostic("renderer.load.native-error");
    throw cause;
  }
  if (value === null) {
    recordPlayerStateDiagnostic("renderer.load.none");
    return undefined;
  }
  const state = await parsePlayerStateAsync(value);
  if (!state) {
    recordPlayerStateDiagnostic("renderer.load.invalid");
    throw new Error("Coda ignored an invalid saved player state.");
  }
  recordPlayerStateDiagnostic("renderer.load.ok");
  return state;
}

export type PlaybackDiagnosticEvent =
  | "renderer.play.request"
  | "renderer.stream.request"
  | "renderer.stream.ready"
  | "renderer.stream.error"
  | "renderer.audio.play-request"
  | "renderer.audio.play-ready"
  | "renderer.audio.play-error"
  | "renderer.audio.media-error";

export function recordPlaybackDiagnostic(event: PlaybackDiagnosticEvent): void {
  if (!isDesktop()) return;
  recordPlayerStateDiagnostic(event);
}

export async function savePlayerState(input: PlayerStateInput): Promise<void> {
  const [state, contractVersion] = await Promise.all([
    preparePlayerStateSnapshot(input),
    nativePlayerStateContractVersion(),
  ]);
  await waitForPlayerStateIdle();
  decodeNativeVoid(
    await invokeNative("save_player_state", {
      state: forNativePlayerStateContract(state, contractVersion),
    }),
    "save_player_state",
  );
}

export async function checkpointPlayerState(
  checkpoint: PlayerStateCheckpoint,
): Promise<boolean> {
  const [validated, contractVersion] = await Promise.all([
    Promise.resolve(createPlayerStateCheckpoint(checkpoint)),
    nativePlayerStateContractVersion(),
  ]);
  return decodeNativeBoolean(
    await invokeNative("checkpoint_player_state", {
      checkpoint: forNativePlayerStateContract(validated, contractVersion),
    }),
    "checkpoint_player_state",
  );
}

export async function clearPlayerState(): Promise<void> {
  decodeNativeVoid(
    await invokeNative("clear_player_state"),
    "clear_player_state",
  );
}

export async function coverCacheDiagnostics(): Promise<CoverCacheDiagnostics> {
  return parseCoverCacheDiagnostics(
    await invokeNative("cover_cache_diagnostics"),
    "cover_cache_diagnostics",
  );
}

export async function openBandcampUrl(value: string): Promise<void> {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    (host !== "bandcamp.com" && !host.endsWith(".bandcamp.com")) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("Coda only opens verified Bandcamp links.");
  }
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url.toString());
  } else {
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  const hours = Math.floor(rounded / 3_600);
  const minutes = Math.floor((rounded % 3_600) / 60);
  const tail = `${String(minutes).padStart(hours ? 2 : 1, "0")}:${String(rounded % 60).padStart(2, "0")}`;
  return hours ? `${hours}:${tail}` : tail;
}

export function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
