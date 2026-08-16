import type {
  LastFmAuthorization,
  LastFmStatus,
  LastFmTrackInput,
} from "../types";
import { isDesktop } from "./desktop";
import {
  decodeNativeBoolean,
  decodeNativeOptionalString,
  decodeNativeRecord,
  decodeNativeString,
  decodeNativeVoid,
  invokeNative,
  invalidNativeResponse,
  MAX_NATIVE_METADATA_BYTES,
  MAX_NATIVE_URL_BYTES,
  type NativeValue,
} from "./native";

export function parseLastFmStatus(
  value: NativeValue,
  context: string,
): LastFmStatus {
  const record = decodeNativeRecord(value, context);
  const status: LastFmStatus = {
    configured: decodeNativeBoolean(
      record.configured,
      `${context}.configured`,
    ),
    connected: decodeNativeBoolean(record.connected, `${context}.connected`),
  };
  const username = decodeNativeOptionalString(
    record.username,
    `${context}.username`,
    MAX_NATIVE_METADATA_BYTES,
  );
  if (username !== undefined) status.username = username;
  return status;
}

export function parseLastFmAuthorization(
  value: NativeValue,
  context: string,
): LastFmAuthorization {
  const record = decodeNativeRecord(value, context);
  const authorizationUrl = decodeNativeString(
    record.authorizationUrl,
    `${context}.authorizationUrl`,
    MAX_NATIVE_URL_BYTES,
  );
  let url: URL;
  try {
    url = new URL(authorizationUrl);
  } catch {
    return invalidNativeResponse(
      `${context}.authorizationUrl`,
      "the Last.fm authorization URL",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.last.fm" ||
    url.pathname !== "/api/auth/" ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    return invalidNativeResponse(
      `${context}.authorizationUrl`,
      "the verified Last.fm authorization URL",
    );
  }
  return {
    authorizationUrl,
    token: decodeNativeString(
      record.token,
      `${context}.token`,
      MAX_NATIVE_METADATA_BYTES,
    ),
  };
}

export async function getLastFmStatus(): Promise<LastFmStatus> {
  if (!isDesktop()) {
    return { configured: false, connected: false };
  }
  return parseLastFmStatus(await invokeNative("lastfm_status"), "lastfm_status");
}

export async function beginLastFmAuthorization(): Promise<LastFmAuthorization> {
  return parseLastFmAuthorization(
    await invokeNative("lastfm_begin_auth"),
    "lastfm_begin_auth",
  );
}

export async function completeLastFmAuthorization(
  token: string,
): Promise<LastFmStatus> {
  return parseLastFmStatus(
    await invokeNative("lastfm_complete_auth", { token }),
    "lastfm_complete_auth",
  );
}

export async function disconnectLastFm(): Promise<LastFmStatus> {
  return parseLastFmStatus(
    await invokeNative("lastfm_disconnect"),
    "lastfm_disconnect",
  );
}

export async function updateLastFmNowPlaying(
  track: LastFmTrackInput,
): Promise<void> {
  decodeNativeVoid(
    await invokeNative("lastfm_update_now_playing", { input: track }),
    "lastfm_update_now_playing",
  );
}

export async function scrobbleLastFm(
  track: LastFmTrackInput,
  timestamp: number,
): Promise<void> {
  decodeNativeVoid(
    await invokeNative("lastfm_scrobble", {
      input: { track, timestamp },
    }),
    "lastfm_scrobble",
  );
}

export async function openLastFmAuthorization(value: string): Promise<void> {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "www.last.fm" ||
    url.pathname !== "/api/auth/" ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("Coda only opens the verified Last.fm authorization page.");
  }
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url.toString());
  } else {
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }
}
