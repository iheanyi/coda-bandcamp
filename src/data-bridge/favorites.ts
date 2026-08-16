import type {
  FavoriteCollection,
  FavoriteInput,
  FavoriteMutationResult,
  FavoriteTrackLocator,
  FavoriteTrackReconciliation,
  FavoriteVerification,
} from "../types";
import { hydrateAlbum, hydrateTrack } from "./hydration";
import {
  parseNativeAlbum,
  parseNativeTrack,
  type NativeAlbum,
  type NativeTrack,
} from "./library";
import {
  decodeNativeArray,
  decodeNativeBoolean,
  decodeNativeInteger,
  decodeNativeOptionalBoolean,
  decodeNativeRecord,
  decodeNativeString,
  invokeNative,
  invalidNativeResponse,
  MAX_NATIVE_IDENTIFIER_BYTES,
  type NativeValue,
} from "./native";

const MAX_FAVORITE_ALBUMS = 5_000;
const MAX_FAVORITE_TRACKS = 25_000;

export type NativeFavoriteCollection = {
  albumIds: string[];
  songIds: string[];
  albums: NativeAlbum[];
  tracks: NativeTrack[];
};

export type NativeFavoriteMutationResult = Omit<
  FavoriteMutationResult,
  "track"
> & {
  track?: NativeTrack;
};

export type NativeFavoriteTrackReconciliation = Omit<
  FavoriteTrackReconciliation,
  "tracks"
> & {
  tracks: NativeTrack[];
};

function parseNativeIdentifier(
  value: NativeValue,
  context: string,
): string {
  return decodeNativeString(
    value,
    context,
    MAX_NATIVE_IDENTIFIER_BYTES,
  );
}

function parseFavoriteVerification(
  value: NativeValue,
  context: string,
): FavoriteVerification {
  const verification = decodeNativeString(value, context, 32);
  switch (verification) {
    case "notRequired":
    case "verified":
    case "unavailable":
    case "mismatch":
      return verification;
    default:
      return invalidNativeResponse(context, "a favorite verification state");
  }
}

export function parseNativeFavoriteCollection(
  value: NativeValue,
  context = "fetch_favorites",
): NativeFavoriteCollection {
  const record = decodeNativeRecord(value, context);
  return {
    albumIds: decodeNativeArray(
      record.albumIds,
      `${context}.albumIds`,
      MAX_FAVORITE_ALBUMS,
      parseNativeIdentifier,
    ),
    songIds: decodeNativeArray(
      record.songIds,
      `${context}.songIds`,
      MAX_FAVORITE_TRACKS,
      parseNativeIdentifier,
    ),
    albums: decodeNativeArray(
      record.albums,
      `${context}.albums`,
      MAX_FAVORITE_ALBUMS,
      parseNativeAlbum,
    ),
    tracks: decodeNativeArray(
      record.tracks,
      `${context}.tracks`,
      MAX_FAVORITE_TRACKS,
      parseNativeTrack,
    ),
  };
}

export function parseNativeFavoriteMutationResult(
  value: NativeValue,
  context = "set_favorite",
): NativeFavoriteMutationResult {
  const record = decodeNativeRecord(value, context);
  const accepted = decodeNativeBoolean(
    record.accepted,
    `${context}.accepted`,
  );
  if (!accepted) {
    return invalidNativeResponse(`${context}.accepted`, "true");
  }
  const result: NativeFavoriteMutationResult = {
    accepted,
    verification: parseFavoriteVerification(
      record.verification,
      `${context}.verification`,
    ),
  };
  const favorite = decodeNativeOptionalBoolean(
    record.favorite,
    `${context}.favorite`,
  );
  if (favorite !== undefined) result.favorite = favorite;
  const track = record.track;
  if (track !== null && track !== undefined) {
    result.track = parseNativeTrack(track, `${context}.track`);
  }
  return result;
}

export function parseNativeFavoriteTrackReconciliation(
  value: NativeValue,
  context = "reconcile_favorite_tracks",
): NativeFavoriteTrackReconciliation {
  const record = decodeNativeRecord(value, context);
  return {
    tracks: decodeNativeArray(
      record.tracks,
      `${context}.tracks`,
      MAX_FAVORITE_TRACKS,
      parseNativeTrack,
    ),
    unstarredIds: decodeNativeArray(
      record.unstarredIds,
      `${context}.unstarredIds`,
      MAX_FAVORITE_TRACKS,
      parseNativeIdentifier,
    ),
    unavailableTrackCount: decodeNativeInteger(
      record.unavailableTrackCount,
      `${context}.unavailableTrackCount`,
      MAX_FAVORITE_TRACKS,
    ),
  };
}

export async function fetchFavorites(): Promise<FavoriteCollection> {
  const favorites = parseNativeFavoriteCollection(
    await invokeNative("fetch_favorites"),
  );
  const albums = favorites.albums.map(hydrateAlbum);
  const albumPalettes = new Map(
    albums.map((album) => [album.id, album.palette] as const),
  );
  return {
    ...favorites,
    albums,
    tracks: favorites.tracks.map((track) =>
      hydrateTrack(track, albumPalettes.get(track.albumId)),
    ),
  };
}

export async function setFavorite(
  input: FavoriteInput,
): Promise<FavoriteMutationResult> {
  const result = parseNativeFavoriteMutationResult(
    await invokeNative("set_favorite", { input }),
  );
  const { track, ...mutation } = result;
  const hydrated: FavoriteMutationResult = { ...mutation };
  if (track !== undefined) hydrated.track = hydrateTrack(track);
  return hydrated;
}

export async function reconcileFavoriteTracks(
  tracks: FavoriteTrackLocator[],
): Promise<FavoriteTrackReconciliation> {
  const result = parseNativeFavoriteTrackReconciliation(
    await invokeNative("reconcile_favorite_tracks", { tracks }),
  );
  return {
    ...result,
    tracks: result.tracks.map((track) => hydrateTrack(track)),
  };
}
