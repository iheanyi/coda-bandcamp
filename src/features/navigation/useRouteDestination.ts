import { useMatch, useRouterState } from "@tanstack/react-router";
import { useMemo } from "react";

import {
  deriveLibraryRouteInput,
  type LibraryRouteInput,
} from "@/routing/libraryRouteInput";
import {
  type AlbumId,
  type ArtistKey,
  type CollectionRouteSearch,
  type DiscoverReleaseId,
  type DiscoverRouteSearch,
  type PlaylistId,
  type RadioSeriesId,
  type RadioShowId,
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
  validateCollectionSearch,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import type {
  CodaPrimaryView,
  CodaRouteMeta,
  CodaScreen,
} from "@/routing/routeMeta";
import { useCodaRouteMeta } from "@/routing/useCodaRouteMeta";

export type CodaDetailDestination =
  | Readonly<{ kind: "album"; albumId: AlbumId }>
  | Readonly<{
      kind: "artist";
      artistKey: ArtistKey;
      sourceAlbumId?: AlbumId;
    }>
  | Readonly<{
      kind: "discover-release";
      releaseId: DiscoverReleaseId;
    }>
  | Readonly<{ kind: "playlist"; playlistId: PlaylistId }>
  | Readonly<{ kind: "radio-series"; seriesId: RadioSeriesId }>
  | Readonly<{ kind: "radio-show"; showId: RadioShowId }>
  | Readonly<{ kind: "now-playing" }>;

export type CodaRouteDestination = Readonly<{
  collectionSearch: CollectionRouteSearch;
  detail?: CodaDetailDestination;
  discoverSearch: DiscoverRouteSearch;
  libraryRouteInput: LibraryRouteInput;
  locationKey: string;
  meta?: CodaRouteMeta;
  nowPlayingOpen: boolean;
  primaryView: CodaPrimaryView;
  screen?: CodaScreen;
}>;

function tryParse<Value>(
  value: unknown,
  parse: (candidate: unknown) => Value,
): Value | undefined {
  try {
    return parse(value);
  } catch {
    return undefined;
  }
}

export function detailDestinationKey(
  destination: CodaDetailDestination | undefined,
): string {
  if (!destination) return "primary";
  switch (destination.kind) {
    case "album":
      return `album:${destination.albumId}`;
    case "artist":
      return `artist:${destination.artistKey}:${destination.sourceAlbumId ?? ""}`;
    case "discover-release":
      return `discover-release:${destination.releaseId}`;
    case "playlist":
      return `playlist:${destination.playlistId}`;
    case "radio-series":
      return `radio-series:${destination.seriesId}`;
    case "radio-show":
      return `radio-show:${destination.showId}`;
    case "now-playing":
      return "now-playing";
  }
}

/**
 * Projects the generated route tree into the small destination vocabulary used
 * by root-owned navigation choreography. This is a read-only projection: it
 * never mirrors the route into React state and cannot become a second router.
 */
export function useRouteDestination(): CodaRouteDestination {
  const meta = useCodaRouteMeta();
  const routeLocation = useRouterState({
    select: (state) => ({
      key: state.location.state.__TSR_key ?? state.location.href,
      search: state.location.search,
    }),
  });
  const albumMatch = useMatch({
    from: "/collection/albums/$albumId",
    shouldThrow: false,
  });
  const artistMatch = useMatch({
    from: "/collection/artists/$artistKey",
    shouldThrow: false,
  });
  const discoverReleaseMatch = useMatch({
    from: "/discover/releases/$releaseId",
    shouldThrow: false,
  });
  const playlistMatch = useMatch({
    from: "/playlists/$playlistId",
    shouldThrow: false,
  });
  const radioSeriesMatch = useMatch({
    from: "/radio/series/$seriesId",
    shouldThrow: false,
  });
  const radioShowMatch = useMatch({
    from: "/radio/shows/$showId",
    shouldThrow: false,
  });

  return useMemo(() => {
    const libraryRouteInput = deriveLibraryRouteInput({
      albumId: albumMatch?.params.albumId,
      artistKey: artistMatch?.params.artistKey,
      screen: meta?.screen,
      search: routeLocation.search,
      sourceAlbumId: artistMatch?.search.albumId,
    });
    const collectionSearch =
      libraryRouteInput.kind === "inactive"
        ? validateCollectionSearch(routeLocation.search)
        : libraryRouteInput.collectionSearch;
    const discoverSearch = validateDiscoverSearch(routeLocation.search);
    let detail: CodaDetailDestination | undefined;

    switch (meta?.screen) {
      case "album":
        if (libraryRouteInput.kind === "album") {
          detail = { kind: "album", albumId: libraryRouteInput.albumId };
        }
        break;
      case "artist":
        if (libraryRouteInput.kind === "artist") {
          detail = {
            kind: "artist",
            artistKey: libraryRouteInput.artistKey,
            ...(libraryRouteInput.sourceAlbumId
              ? { sourceAlbumId: libraryRouteInput.sourceAlbumId }
              : {}),
          };
        }
        break;
      case "discover-release":
        if (discoverReleaseMatch) {
          detail = {
            kind: "discover-release",
            releaseId: discoverReleaseMatch.params.releaseId,
          };
        }
        break;
      case "playlist":
        if (playlistMatch) {
          detail = {
            kind: "playlist",
            playlistId: playlistMatch.params.playlistId,
          };
        }
        break;
      case "radio-series": {
        const seriesId = tryParse(
          radioSeriesMatch?.params.seriesId,
          parseRadioSeriesIdParam,
        );
        if (seriesId !== undefined) {
          detail = { kind: "radio-series", seriesId };
        }
        break;
      }
      case "radio-show": {
        const showId = tryParse(
          radioShowMatch?.params.showId,
          parseRadioShowIdParam,
        );
        if (showId !== undefined) detail = { kind: "radio-show", showId };
        break;
      }
      case "now-playing":
        detail = { kind: "now-playing" };
        break;
    }

    return {
      collectionSearch,
      ...(detail ? { detail } : {}),
      discoverSearch,
      libraryRouteInput,
      locationKey: routeLocation.key,
      ...(meta ? { meta } : {}),
      nowPlayingOpen: meta?.screen === "now-playing",
      primaryView: meta?.primaryView ?? "library",
      screen: meta?.screen,
    };
  }, [
    albumMatch,
    artistMatch,
    discoverReleaseMatch,
    meta,
    playlistMatch,
    radioSeriesMatch,
    radioShowMatch,
    routeLocation,
  ]);
}
