import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import type { LocalFavoritesController } from "@/features/favorites/useLocalFavoritesController";
import {
  artistKey,
  type ArtistGroup,
  type LibraryBrowseMode,
} from "@/libraryBrowse";
import { cachedAlbumTracks } from "@/libraryQueries";
import type { LibraryRouteInput } from "@/routing/libraryRouteInput";
import {
  missingRouteResource,
  pendingRouteResource,
  readyRouteResource,
} from "@/routing/routeResource";
import type { Album, Track } from "@/types";

import type { AlbumScreenActions } from "./AlbumScreen";
import type { ArtistScreenActions, ArtistScreenModel } from "./ArtistScreen";
import type { CollectionScreenProps } from "./CollectionScreen";
import type {
  ArtistResultsActions,
  ArtistResultsModel,
  LibraryAvailabilityActions,
  LibraryAvailabilityModel,
  ReleaseResultsActions,
  ReleaseResultsModel,
} from "./LibraryResults";
import type { LibraryRouteRuntime } from "./LibraryRouteRuntime";

type LibraryFavoritesRuntime = Pick<
  LocalFavoritesController,
  "collection" | "favoriteAlbumIds" | "favoriteTrackIds" | "toggleFavorite"
>;

export type LibraryRouteScreensRuntime = Readonly<{
  artistResultsActions: ArtistResultsActions;
  artistResultsModel: ArtistResultsModel;
  availabilityActions: LibraryAvailabilityActions;
  availabilityModel: LibraryAvailabilityModel;
  browseMode: LibraryBrowseMode;
  refs: CollectionScreenProps["refs"];
  releaseResultsActions: ReleaseResultsActions;
  releaseResultsModel: ReleaseResultsModel;
}>;

export type LibraryRoutePlaybackRuntime = Readonly<{
  currentTrack?: Pick<Track, "albumId" | "artist" | "id">;
  onPlayTrack: AlbumScreenActions["detail"]["onPlayTrack"];
  onQueueTrack: AlbumScreenActions["detail"]["onQueueTrack"];
  onTogglePlayback: () => void;
  playing: boolean;
}>;

export type LibraryAlbumRouteRuntime = Readonly<{
  loadingAlbumId?: string;
  onAddToPlaylist: AlbumScreenActions["detail"]["onAddToPlaylist"];
  onBack: () => void;
}>;

export type LibraryArtistRouteRuntime = Readonly<{
  action?: NonNullable<ArtistScreenModel["artist"]["loading"]>;
  activeShuffleArtistKey?: string;
  group?: ArtistGroup;
  onBack: () => void;
  onPlay: ArtistScreenActions["artist"]["onPlay"];
  onQueue: ArtistScreenActions["artist"]["onQueue"];
  onShuffle: ArtistScreenActions["artist"]["onShuffle"];
  routeInput: LibraryRouteInput;
  shuffleInProgress: boolean;
}>;

export type LibraryRouteRuntimeAdapterOptions = Readonly<{
  album: LibraryAlbumRouteRuntime;
  artist: LibraryArtistRouteRuntime;
  catalog: Readonly<{
    albums: readonly Album[];
    selectedAlbum?: Album;
  }>;
  favorites: LibraryFavoritesRuntime;
  initialLoading: boolean;
  playback: LibraryRoutePlaybackRuntime;
  screens: LibraryRouteScreensRuntime;
}>;

function albumWithTracks(album: Album, tracks: Track[]): Album {
  return {
    ...album,
    coverArt:
      album.coverArt ?? tracks.find((track) => track.coverArt)?.coverArt,
    tracks,
  };
}

/** Owns route-resource resolution for Collection, Recent, album, and artist screens. */
export function useLibraryRouteRuntimeAdapter({
  album,
  artist,
  catalog,
  favorites,
  initialLoading,
  playback,
  screens,
}: LibraryRouteRuntimeAdapterOptions): LibraryRouteRuntime {
  const queryClient = useQueryClient();

  return useMemo(() => {
    const collectionProps: CollectionScreenProps = {
      model: {
        availability: screens.availabilityModel,
        content:
          screens.browseMode === "artists"
            ? { kind: "artists", results: screens.artistResultsModel }
            : { kind: "releases", results: screens.releaseResultsModel },
      },
      actions: {
        availability: screens.availabilityActions,
        artists: screens.artistResultsActions,
        releases: screens.releaseResultsActions,
      },
      refs: screens.refs,
    };
    const recentProps = {
      model: {
        availability: screens.availabilityModel,
        results: screens.releaseResultsModel,
      },
      actions: {
        availability: screens.availabilityActions,
        releases: screens.releaseResultsActions,
      },
      refs: screens.refs,
    };

    return {
      getCollectionScreenProps: () => collectionProps,
      getRecentScreenProps: () => recentProps,
      resolveAlbumScreen: (albumId) => {
        const summary =
          catalog.selectedAlbum?.id === albumId
            ? catalog.selectedAlbum
            : (catalog.albums.find((item) => item.id === albumId) ??
              favorites.collection.albums.find((item) => item.id === albumId));
        if (!summary) {
          return initialLoading
            ? pendingRouteResource()
            : missingRouteResource();
        }

        const cachedTracks = cachedAlbumTracks(queryClient, summary);
        const albumForScreen = cachedTracks
          ? albumWithTracks(summary, cachedTracks)
          : summary;

        return readyRouteResource({
          model: {
            detail: {
              album: albumForScreen,
              loading: album.loadingAlbumId === albumId,
              favoriteAlbum: favorites.favoriteAlbumIds.has(albumId),
              favoriteTrackIds: favorites.favoriteTrackIds,
              currentTrackId: playback.currentTrack?.id,
              currentAlbumId: playback.currentTrack?.albumId,
              playing: playback.playing,
            },
          },
          actions: {
            detail: {
              onBack: album.onBack,
              onPlayAlbum: () =>
                screens.releaseResultsActions.onPlay(albumForScreen),
              onQueueAlbum: () =>
                screens.releaseResultsActions.onQueue(albumForScreen),
              onPlayTrack: playback.onPlayTrack,
              onQueueTrack: playback.onQueueTrack,
              onArtist: screens.releaseResultsActions.onArtist,
              onToggleFavoriteAlbum: () =>
                favorites.toggleFavorite(albumId, "album"),
              onToggleFavoriteTrack: (track) =>
                favorites.toggleFavorite(track.id, "song"),
              onAddToPlaylist: album.onAddToPlaylist,
              onTogglePlayback: playback.onTogglePlayback,
            },
          },
        });
      },
      resolveArtistScreen: (artistKeyValue, sourceAlbumId) => {
        if (
          artist.routeInput.kind !== "artist" ||
          artist.routeInput.artistKey !== artistKeyValue ||
          artist.routeInput.sourceAlbumId !== sourceAlbumId
        ) {
          return pendingRouteResource();
        }
        if (!artist.group) {
          return initialLoading
            ? pendingRouteResource()
            : missingRouteResource();
        }

        const currentTrack = playback.currentTrack;
        const active = Boolean(
          currentTrack &&
          artist.group.albums.some(
            (item) => item.id === currentTrack.albumId,
          ) &&
          (!artist.group.trackFilterArtistKey ||
            artist.group.trackFilterAlbumId !== currentTrack.albumId ||
            artistKey(currentTrack.artist) ===
              artist.group.trackFilterArtistKey),
        );
        const loading =
          artist.action ??
          (artist.shuffleInProgress &&
          artist.activeShuffleArtistKey === artist.group.key
            ? "shuffle"
            : undefined);

        return readyRouteResource({
          model: {
            availability: screens.availabilityModel,
            artist: {
              group: artist.group,
              loading,
              active,
              playing: playback.playing,
            },
            results: {
              ...screens.releaseResultsModel,
              albums: artist.group.albums,
              title: "Releases",
            },
          },
          actions: {
            availability: screens.availabilityActions,
            artist: {
              onBack: artist.onBack,
              onPlay: artist.onPlay,
              onShuffle: artist.onShuffle,
              onQueue: artist.onQueue,
              onTogglePlayback: playback.onTogglePlayback,
            },
            releases: screens.releaseResultsActions,
          },
          refs: screens.refs,
        });
      },
    };
  }, [
    album,
    artist,
    catalog,
    favorites,
    initialLoading,
    playback,
    queryClient,
    screens,
  ]);
}
