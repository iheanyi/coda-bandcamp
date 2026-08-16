import type {
  PlaylistDetail,
  PlaylistSummary,
  PlaylistUpdateInput,
} from "../types";
import { hydrateTrack } from "./hydration";
import { parseNativeTrack, type NativeTrack } from "./library";
import {
  decodeNativeArray,
  decodeNativeInteger,
  decodeNativeOptionalBoolean,
  decodeNativeOptionalString,
  decodeNativeRecord,
  decodeNativeString,
  decodeNativeVoid,
  invalidNativeResponse,
  invokeNative,
  MAX_NATIVE_IDENTIFIER_BYTES,
  MAX_NATIVE_METADATA_BYTES,
  type NativeValue,
} from "./native";

const MAX_PLAYLISTS = 5_000;
const MAX_PLAYLIST_TRACKS = 25_000;
const MAX_PLAYLIST_NAME_BYTES = 256;
const MAX_PLAYLIST_COMMENT_BYTES = 4_096;
const MAX_PLAYLIST_DURATION_SECONDS = 10 * 365 * 24 * 60 * 60;
const ABSOLUTE_URL = /^[a-z][a-z\d+.-]*:\/\//iu;

function isBoundedNonUrlPlaylistId(value: string): boolean {
  return (
    value.trim() === value &&
    !ABSOLUTE_URL.test(value) &&
    !value.startsWith("//")
  );
}

export type NativePlaylistDetail = Omit<PlaylistDetail, "tracks"> & {
  tracks: NativeTrack[];
};

export function parseNativePlaylistSummary(
  value: NativeValue,
  context = "playlist",
): PlaylistSummary {
  const record = decodeNativeRecord(value, context);
  const id = decodeNativeString(
    record.id,
    `${context}.id`,
    MAX_NATIVE_IDENTIFIER_BYTES,
  );
  if (!isBoundedNonUrlPlaylistId(id)) {
    return invalidNativeResponse(
      `${context}.id`,
      "a bounded non-URL identifier",
    );
  }
  const playlist: PlaylistSummary = {
    id,
    name: decodeNativeString(
      record.name,
      `${context}.name`,
      MAX_PLAYLIST_NAME_BYTES,
    ),
    songCount: decodeNativeInteger(
      record.songCount,
      `${context}.songCount`,
      MAX_PLAYLIST_TRACKS,
    ),
    duration: decodeNativeInteger(
      record.duration,
      `${context}.duration`,
      MAX_PLAYLIST_DURATION_SECONDS,
    ),
  };
  const comment = decodeNativeOptionalString(
    record.comment,
    `${context}.comment`,
    MAX_PLAYLIST_COMMENT_BYTES,
  );
  const owner = decodeNativeOptionalString(
    record.owner,
    `${context}.owner`,
    MAX_NATIVE_METADATA_BYTES,
  );
  const isPublic = decodeNativeOptionalBoolean(
    record.public,
    `${context}.public`,
  );
  const createdAt = decodeNativeOptionalString(
    record.createdAt,
    `${context}.createdAt`,
    MAX_NATIVE_METADATA_BYTES,
    true,
  );
  const changedAt = decodeNativeOptionalString(
    record.changedAt,
    `${context}.changedAt`,
    MAX_NATIVE_METADATA_BYTES,
    true,
  );
  const coverArt = decodeNativeOptionalString(
    record.coverArt,
    `${context}.coverArt`,
    MAX_NATIVE_IDENTIFIER_BYTES,
  );
  if (comment !== undefined) playlist.comment = comment;
  if (owner !== undefined) playlist.owner = owner;
  if (isPublic !== undefined) playlist.public = isPublic;
  if (createdAt !== undefined) playlist.createdAt = createdAt;
  if (changedAt !== undefined) playlist.changedAt = changedAt;
  if (coverArt !== undefined) playlist.coverArt = coverArt;
  return playlist;
}

export function parseNativePlaylists(
  value: NativeValue,
  context = "fetch_playlists",
): PlaylistSummary[] {
  return decodeNativeArray(
    value,
    context,
    MAX_PLAYLISTS,
    parseNativePlaylistSummary,
  );
}

export function parseNativePlaylistDetail(
  value: NativeValue,
  context = "playlist detail",
): NativePlaylistDetail {
  const record = decodeNativeRecord(value, context);
  return {
    ...parseNativePlaylistSummary(record, context),
    tracks: decodeNativeArray(
      record.tracks,
      `${context}.tracks`,
      MAX_PLAYLIST_TRACKS,
      parseNativeTrack,
    ),
  };
}

export function parseNativeOptionalPlaylistDetail(
  value: NativeValue,
  context = "update_playlist",
): NativePlaylistDetail | null {
  return value === null ? null : parseNativePlaylistDetail(value, context);
}

function hydratePlaylist(playlist: NativePlaylistDetail): PlaylistDetail {
  return {
    ...playlist,
    tracks: playlist.tracks.map((track) => hydrateTrack(track)),
  };
}

export async function fetchPlaylists(): Promise<PlaylistSummary[]> {
  return parseNativePlaylists(await invokeNative("fetch_playlists"));
}

export async function fetchPlaylist(
  playlistId: string,
): Promise<PlaylistDetail> {
  return hydratePlaylist(
    parseNativePlaylistDetail(
      await invokeNative("fetch_playlist", { playlistId }),
      "fetch_playlist",
    ),
  );
}

export async function createPlaylist(
  name: string,
  songIds: string[] = [],
): Promise<PlaylistDetail> {
  return hydratePlaylist(
    parseNativePlaylistDetail(
      await invokeNative("create_playlist", { name, songIds }),
      "create_playlist",
    ),
  );
}

export async function updatePlaylist(
  input: PlaylistUpdateInput,
): Promise<PlaylistDetail | undefined> {
  const playlist = parseNativeOptionalPlaylistDetail(
    await invokeNative("update_playlist", {
      input: {
        ...input,
        songIdsToAdd: input.songIdsToAdd ?? [],
        songIndexesToRemove: input.songIndexesToRemove ?? [],
      },
    }),
  );
  return playlist ? hydratePlaylist(playlist) : undefined;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  decodeNativeVoid(
    await invokeNative("delete_playlist", { playlistId }),
    "delete_playlist",
  );
}
