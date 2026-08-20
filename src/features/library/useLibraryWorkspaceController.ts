import { useCallback, useMemo, type RefObject } from "react";

import type {
  LibraryActionsCommands,
  LibraryActionsState,
} from "@/features/library-actions/useLibraryActionsController";
import { resolveAlbumSummary, type LibraryArtistFallback } from "@/libraryBrowse";
import type { LibraryRouteInput } from "@/routing/libraryRouteInput";
import { libraryRouteChromeVisibility } from "@/routing/libraryRouteInput";
import type { Album, Track } from "@/types";
import type {
  ArtistResultsActions,
  ArtistResultsModel,
  LibraryAvailabilityActions,
  LibraryAvailabilityModel,
  ReleaseResultsActions,
  ReleaseResultsModel,
} from "./LibraryResults";
import type {
  LibraryBrowseActions,
  LibraryBrowseModel,
  LibraryChromeActions,
  LibraryChromeModel,
  LibraryFilterActions,
  LibraryFilterModel,
  LibraryScreenChromeProps,
  LibrarySyncState,
} from "./LibraryScreenChrome";
import {
  deriveReleaseResultsTitle,
  deriveSurpriseScope,
  hasActiveBrowseFilters,
  type LibrarySurpriseScope,
} from "./browseScope";
import type { ArtistNavigationHandler } from "./types";
import {
  useLibraryBrowseController,
  type LibraryBrowseController,
} from "./useLibraryBrowseController";
import { useGenreRailController } from "./useGenreRailController";
import type { LibraryRouteSearchController } from "./useLibraryRouteSearchController";
import type { LibraryRouteScreensRuntime } from "./useLibraryRouteRuntimeAdapter";

type WorkspaceLibraryActions = Readonly<{
  commands: Pick<
    LibraryActionsCommands,
    | "openAlbum"
    | "playAlbum"
    | "playSurprise"
    | "queueAlbum"
    | "queueAlbums"
    | "refreshArtwork"
  >;
  state: Pick<
    LibraryActionsState,
    | "loadingAlbumId"
    | "queueSearchProgress"
    | "randomPickLoading"
    | "selectedAlbum"
  >;
}>;

export type LibraryWorkspaceAvailability = Readonly<{
  commands: Readonly<{
    connect: () => void;
    retryStartup: () => void;
    sync: () => void | Promise<void>;
  }>;
  state: Readonly<{
    artworkRefreshing: boolean;
    connected: boolean;
    libraryError: string;
    syncState: LibrarySyncState;
  }>;
}>;

export type LibraryWorkspaceNavigation = Readonly<{
  openArtist: ArtistResultsActions["onOpen"];
  openArtistFromMetadata: ArtistNavigationHandler;
}>;

export type LibraryWorkspacePlayback = Readonly<{
  currentAlbumId?: string;
  playing: boolean;
  shuffleInProgress: boolean;
  shuffleProgress?: Readonly<{
    done: number;
    total: number;
  }>;
  shuffle: (
    albums: readonly Album[],
    scopeName: string,
    artistScope?: LibraryBrowseController["activeArtist"],
  ) => void;
  toggle: () => void;
}>;

export type LibraryWorkspaceControllerOptions = Readonly<{
  albums: readonly Album[];
  availability: LibraryWorkspaceAvailability;
  fallbackAlbumCandidateTracks: readonly Track[];
  libraryActions: WorkspaceLibraryActions;
  libraryPaneRef: RefObject<HTMLElement | null>;
  navigation: LibraryWorkspaceNavigation;
  playback: LibraryWorkspacePlayback;
  routeInput: LibraryRouteInput;
  search: LibraryRouteSearchController;
  selectedArtistFallback?: LibraryArtistFallback;
}>;

export type LibraryWorkspaceController = Readonly<{
  browse: LibraryBrowseController;
  chrome?: LibraryScreenChromeProps;
  screens: LibraryRouteScreensRuntime;
  state: Readonly<{
    isInitialLoading: boolean;
    surpriseScope: LibrarySurpriseScope;
  }>;
}>;

/**
 * Composes URL-owned browse state with the existing pure browse derivation and
 * exposes the complete Collection/Recent presentation contract. TanStack
 * Query and LibrarySession remain the owners of album data.
 */
export function useLibraryWorkspaceController({
  albums,
  availability,
  fallbackAlbumCandidateTracks,
  libraryActions,
  libraryPaneRef,
  navigation,
  playback,
  routeInput,
  search,
  selectedArtistFallback,
}: LibraryWorkspaceControllerOptions): LibraryWorkspaceController {
  const collectionSearch = search.state.search;
  const selectedArtist =
    routeInput.kind === "artist" ? routeInput.artistKey : undefined;
  const recent = routeInput.kind === "recent";
  const browse = useLibraryBrowseController({
    albums,
    browseMode: collectionSearch.mode,
    deferredQuery: search.state.deferredQuery,
    fallbackAlbumCandidateTracks,
    genre: collectionSearch.genre,
    ignoreDeferredArtistQuery:
      Boolean(selectedArtist) &&
      (search.state.deferredQuery === "" ||
        search.state.ignoreDeferredArtistQuery),
    selectedArtist,
    selectedArtistFallback,
    sort: collectionSearch.sort,
    view: recent ? "recent" : "library",
  });
  const genreRail = useGenreRailController({
    genre: collectionSearch.genre,
    genres: browse.orderedGenreTabs,
  });
  const isInitialLoading =
    availability.state.syncState === "checking" ||
    (availability.state.connected &&
      availability.state.syncState === "syncing" &&
      !albums.length &&
      !availability.state.libraryError);
  const hasActiveFilters = hasActiveBrowseFilters({
    query: collectionSearch.q,
    genre: collectionSearch.genre,
    mode: collectionSearch.mode,
    selectedArtist,
  });
  const selectedAlbum =
    routeInput.kind === "album"
      ? resolveAlbumSummary(
          routeInput.albumId,
          albums,
          libraryActions.state.selectedAlbum,
        )
      : undefined;
  const surpriseScope = useMemo<LibrarySurpriseScope>(
    () =>
      deriveSurpriseScope({
        activeArtist: browse.activeArtist,
        effectiveBrowseMode: browse.effectiveBrowseMode,
        genre: collectionSearch.genre,
        query: collectionSearch.q,
        recent,
        routeKind: routeInput.kind,
        selectedAlbum,
        visibleAlbums: browse.visibleAlbums,
      }),
    [
      browse.activeArtist,
      browse.effectiveBrowseMode,
      browse.visibleAlbums,
      collectionSearch.genre,
      collectionSearch.q,
      recent,
      routeInput.kind,
      selectedAlbum,
    ],
  );
  const releaseTitle = deriveReleaseResultsTitle({
    activeArtist: browse.activeArtist,
    genre: collectionSearch.genre,
    mode: browse.effectiveBrowseMode,
  });

  const playSurprise = useCallback(() => {
    void libraryActions.commands.playSurprise(
      surpriseScope.albums,
      surpriseScope.name,
      surpriseScope.artist,
    );
  }, [libraryActions.commands, surpriseScope]);
  const shuffleVisible = useCallback(() => {
    playback.shuffle(
      surpriseScope.albums,
      surpriseScope.name,
      surpriseScope.artist,
    );
  }, [playback, surpriseScope]);
  const sync = useCallback(() => {
    void availability.commands.sync();
  }, [availability.commands]);
  const refreshArtwork = useCallback(() => {
    void libraryActions.commands.refreshArtwork();
  }, [libraryActions.commands]);
  const openAlbum = useCallback<ReleaseResultsActions["onOpen"]>(
    (album, trigger) => {
      void libraryActions.commands.openAlbum(album, trigger);
    },
    [libraryActions.commands],
  );
  const playAlbum = useCallback<ReleaseResultsActions["onPlay"]>(
    (album) => {
      void libraryActions.commands.playAlbum(album);
    },
    [libraryActions.commands],
  );
  const queueAlbum = useCallback<ReleaseResultsActions["onQueue"]>(
    (album) => {
      void libraryActions.commands.queueAlbum(album);
    },
    [libraryActions.commands],
  );
  const queueVisibleAlbums = useCallback(() => {
    void libraryActions.commands.queueAlbums(browse.visibleAlbums);
  }, [browse.visibleAlbums, libraryActions.commands]);
  const scopeActionsBusy =
    playback.shuffleInProgress ||
    libraryActions.state.randomPickLoading ||
    availability.state.syncState === "syncing";

  const catalogAvailability = {
    connected: availability.state.connected,
    releaseCount: albums.length,
    syncState: availability.state.syncState,
    libraryError: availability.state.libraryError,
  };
  const chromeModel: LibraryChromeModel = {
    kind: recent ? "recent" : "collection",
    ...catalogAvailability,
    query: collectionSearch.q,
    surprise: {
      available: Boolean(surpriseScope.albums.length),
      scopeName: surpriseScope.name,
      loading: libraryActions.state.randomPickLoading,
      disabled: scopeActionsBusy,
    },
    shuffle: {
      available: Boolean(surpriseScope.albums.length),
      label: surpriseScope.shuffleLabel,
      scopeName: surpriseScope.name,
      progress: playback.shuffleProgress,
      disabled: scopeActionsBusy,
    },
    artwork: {
      refreshing: availability.state.artworkRefreshing,
      disabled:
        availability.state.artworkRefreshing ||
        availability.state.syncState === "syncing",
    },
  };
  const chromeActions: LibraryChromeActions = {
    onQueryChange: search.commands.changeQuery,
    onSurprise: playSurprise,
    onShuffle: shuffleVisible,
    onRefreshArtwork: refreshArtwork,
    onSync: sync,
    onConnect: availability.commands.connect,
  };
  const availabilityModel: LibraryAvailabilityModel = {
    ...catalogAvailability,
    isInitialLoading,
  };
  const availabilityActions: LibraryAvailabilityActions = {
    onSync: sync,
    onRetryStartup: availability.commands.retryStartup,
    onConnect: availability.commands.connect,
  };
  const browseModel: LibraryBrowseModel = {
    mode: collectionSearch.mode,
    releaseCount: albums.length,
    counts: browse.counts,
  };
  const browseActions: LibraryBrowseActions = {
    onChooseMode: search.commands.chooseBrowseMode,
  };
  const filterModel: LibraryFilterModel = {
    kind: recent ? "recent" : "collection",
    genre: collectionSearch.genre,
    genres: browse.orderedGenreTabs,
    edges: genreRail.edges,
    trailingControl: recent
      ? "recent"
      : browse.effectiveBrowseMode === "artists" && !selectedArtist
        ? "artists"
        : "sort",
    sort: collectionSearch.sort,
  };
  const filterActions: LibraryFilterActions = {
    onGenreChange: search.commands.changeGenre,
    onGenreRailScroll: genreRail.onScroll,
    onScrollGenres: genreRail.scroll,
    onSortChange: search.commands.changeSort,
  };
  const releaseResultsModel: ReleaseResultsModel = {
    title: releaseTitle,
    albums: browse.visibleAlbums,
    currentAlbumId: playback.currentAlbumId,
    loadingAlbumId: libraryActions.state.loadingAlbumId,
    playing: playback.playing,
    hasSearchQuery: Boolean(search.state.deferredQuery),
    queueProgress: libraryActions.state.queueSearchProgress,
    browseMode: browse.effectiveBrowseMode,
    hasActiveFilters,
  };
  const releaseResultsActions: ReleaseResultsActions = {
    onOpen: openAlbum,
    onPlay: playAlbum,
    onQueue: queueAlbum,
    onArtist: navigation.openArtistFromMetadata,
    onTogglePlayback: playback.toggle,
    onQueueSearchResults: queueVisibleAlbums,
    onClearFilters: search.commands.clearFilters,
  };
  const artistResultsModel: ArtistResultsModel = {
    genre: collectionSearch.genre,
    groups: browse.artistGroups,
    hasActiveFilters,
  };
  const artistResultsActions: ArtistResultsActions = {
    onOpen: navigation.openArtist,
    onClearFilters: search.commands.clearFilters,
  };
  const screens: LibraryRouteScreensRuntime = {
    artistResultsActions,
    artistResultsModel,
    availabilityActions,
    availabilityModel,
    browseMode: browse.effectiveBrowseMode,
    refs: { libraryPane: libraryPaneRef },
    releaseResultsActions,
    releaseResultsModel,
  };
  const visibility = libraryRouteChromeVisibility(routeInput);
  let chrome: LibraryScreenChromeProps | undefined;
  if (routeInput.kind !== "inactive") {
    const activeChrome: LibraryScreenChromeProps = {
      model: chromeModel,
      actions: chromeActions,
      refs: {
        search: search.refs.search,
        genreRail: genreRail.ref,
      },
    };
    if (visibility.browse) {
      activeChrome.browse = { model: browseModel, actions: browseActions };
    }
    if (visibility.filter) {
      activeChrome.filter = { model: filterModel, actions: filterActions };
    }
    chrome = activeChrome;
  }

  const state = { isInitialLoading, surpriseScope };
  return {
    browse,
    chrome,
    screens,
    state,
  };
}
