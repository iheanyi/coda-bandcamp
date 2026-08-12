import { useQueryClient } from "@tanstack/react-query";
import { Outlet } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";

import { AppSidebar } from "./AppSidebar";
import { useAppUpdater } from "./appUpdaterController";
import { notifyToast } from "@/components/ui/toastManager";
import { useCurrentFavoriteController } from "@/features/favorites/useCurrentFavoriteController";
import { useLocalFavoritesController } from "@/features/favorites/useLocalFavoritesController";
import { LibraryScreenChrome } from "@/features/library/LibraryScreenChrome";
import { MotionLabPanel } from "@/features/motion-lab/MotionLabPanel";
import {
  readMotionLabOpen,
  writeMotionLabOpen,
} from "@/features/motion-lab/motionLabVisibility";
import { useLibraryRouteSearchController } from "@/features/library/useLibraryRouteSearchController";
import { useLibraryWorkspaceController } from "@/features/library/useLibraryWorkspaceController";
import { useLibraryActionsController } from "@/features/library-actions/useLibraryActionsController";
import { useLibrarySession } from "@/features/library-session";
import {
  useDetailNavigationController,
  useRouteDestination,
} from "@/features/navigation";
import { useCodaNavigationController } from "@/features/navigation/useCodaNavigationController";
import { usePlaybackRuntimeController } from "@/features/playback-runtime";
import { PersistentPlayerDock } from "@/features/player/PersistentPlayerDock";
import { PersistentQueueSurface } from "@/features/queue/PersistentQueueSurface";
import { useQueueFocusController } from "@/features/queue/useQueueFocusController";
import { useQueueRecommendationController } from "@/features/queue/useQueueRecommendationController";
import { PersistentAppOverlays } from "@/features/settings/PersistentAppOverlays";
import { usePersistentOverlaysController } from "@/features/settings/usePersistentOverlaysController";
import { AppRouteRuntimeProviders } from "@/features/shell/AppRouteRuntimeProviders";
import { AppShell } from "@/features/shell/AppShell";
import { PersistentPlaybackServices } from "@/features/shell/PersistentPlaybackServices";
import { useAppRouteRuntimes } from "@/features/shell/useAppRouteRuntimes";
import { useAppKeyboardShortcuts } from "@/features/shell/useAppKeyboardShortcuts";
import { useMainWindowController } from "@/features/shell/useMainWindowController";
import { countLabel } from "./countLabel";
import { cachedAlbumTracks, updateLibraryData } from "./libraryQueries";
import { radioShowQueryOptions } from "@/queries/radioQueries";
import type { Album, Track } from "./types";

// Keep non-component exports in focused modules so Fast Refresh preserves App state.
export default function App() {
  const [motionLabOpen, setMotionLabOpenState] = useState(readMotionLabOpen);
  const setMotionLabOpen = useCallback((open: boolean) => {
    setMotionLabOpenState(open);
    writeMotionLabOpen(open);
  }, []);
  const queryClient = useQueryClient();
  const routeDestination = useRouteDestination();
  const detailNavigation = useDetailNavigationController(routeDestination);
  const nowPlayingOpen = routeDestination.nowPlayingOpen;
  const libraryRouteInput = routeDestination.libraryRouteInput;
  const view = routeDestination.primaryView;
  const collectionSearch = routeDestination.collectionSearch;
  const librarySearch = useLibraryRouteSearchController({
    routeInput: libraryRouteInput,
    search: collectionSearch,
  });
  const searchRef = librarySearch.refs.search;
  const {
    albums: librarySessionAlbums,
    commands: librarySessionCommands,
    state: librarySessionState,
  } = useLibrarySession();
  const albums = useMemo(
    () => [...librarySessionAlbums],
    [librarySessionAlbums],
  );
  const connected = librarySessionState.connection === "connected";
  const syncState = librarySessionState.sync.status;
  const libraryError = librarySessionState.sync.error;
  const artworkRefreshing = librarySessionState.artwork.refreshing;
  const appUpdater = useAppUpdater();
  const overlays = usePersistentOverlaysController();
  const { closeConnection, openAddToPlaylist, openConnection } =
    overlays.commands;
  const mainWindow = useMainWindowController();
  const setAlbums = useCallback(
    (update: React.SetStateAction<Album[]>) =>
      updateLibraryData(queryClient, update),
    [queryClient],
  );
  const lastFmStatus = overlays.state.lastFmStatus;
  const loadPlaybackShuffleAlbumTracks = useCallback(
    async (album: Album) =>
      (await librarySessionCommands.ensureAlbum(album))?.tracks ?? [],
    [librarySessionCommands],
  );
  const keepPlaybackAlbumSummary = useCallback((album: Album) => album, []);
  const ignorePlaybackRecoveredAlbums = useCallback(
    (_albums: ReadonlyMap<string, Album>) => undefined,
    [],
  );
  const shuffleEntireLibraryRef = useRef<() => void>(() => undefined);
  const shuffleEntireLibrary = useCallback(
    () => shuffleEntireLibraryRef.current(),
    [],
  );
  const playback = usePlaybackRuntimeController({
    connected,
    lastFmConnected: lastFmStatus.connected,
    albums,
    notify: notifyToast,
    progressiveShuffle: {
      connected,
      getConnectionGeneration: librarySessionCommands.generation.current,
      loadAlbumTracks: loadPlaybackShuffleAlbumTracks,
      recoverAlbum: keepPlaybackAlbumSummary,
      applyRecoveredAlbums: ignorePlaybackRecoveredAlbums,
    },
    onShuffleEntireLibrary: shuffleEntireLibrary,
    adapters: {
      audio: {
        loadRadioShow: (showId) =>
          queryClient.fetchQuery(radioShowQueryOptions(showId)),
      },
    },
  });
  const { queue, currentTrack, open: queueOpen } = playback.queue;
  const { playing } = playback.transport;
  const {
    playTrack: playTrackRuntime,
    playTracks: playTracksRuntime,
    queueTrack: queueTrackRuntime,
    queueTracks: queueTracksRuntime,
    clearQueue: clearQueueRuntime,
  } = playback.queueCommands;
  const { toggle: togglePlayback, previous, next } = playback.transportCommands;
  useAppKeyboardShortcuts({
    onNext: next,
    onPrevious: previous,
    onTogglePlayback: togglePlayback,
    onToggleMotionLab: () => setMotionLabOpen(!motionLabOpen),
    searchRef,
  });
  const {
    progress: libraryShuffleProgress,
    cancel: cancelLibraryShuffle,
    shuffle: startLibraryShuffle,
  } = playback.shuffle;
  shuffleEntireLibraryRef.current = () =>
    playback.shuffle.shuffle(albums, "the entire library");
  const libraryActions = useLibraryActionsController({
    albums,
    artworkRefreshing,
    connected,
    detailNavigation,
    notify: notifyToast,
    playback: {
      cancelShuffle: cancelLibraryShuffle,
      playTrack: playTrackRuntime,
      playTracks: playTracksRuntime,
      queueTracks: queueTracksRuntime,
      startShuffle: startLibraryShuffle,
    },
    queryClient,
    selectedAlbumId:
      libraryRouteInput.kind === "album"
        ? libraryRouteInput.albumId
        : undefined,
    session: librarySessionCommands,
    updateAlbums: setAlbums,
  });
  const { loadingAlbumId, randomPickLoading, selectedAlbum } =
    libraryActions.state;
  const {
    acceptConnectedLibrary,
    clearSelectedAlbum,
    disconnect: disconnectLibrary,
    openAlbum,
    playRandomTrack,
    queueAlbum,
  } = libraryActions.commands;
  const navigation = useCodaNavigationController({
    albums,
    clearSelectedAlbum,
    currentTrack,
    destination: routeDestination,
    detailNavigation,
    notify: notifyToast,
    openAlbum,
    prepareArtistSearch: librarySearch.commands.prepareArtistSearch,
    queue,
  });
  const libraryPaneRef = navigation.scrollRootRef;
  const { discoverDetail, selectedArtistFallback } = navigation.state;
  const {
    album: { openFromTrack: openTrackAlbum },
    artist: { openGroup: openArtist, openName: browseArtist },
    nowPlaying: { open: openNowPlaying },
    radio: {
      chapterLinks: getRadioChapterLocalLinks,
      openExternal: openRadioItem,
      openSeries: browseRadioSeries,
      openShow: openRadioShow,
    },
    sidebar: {
      beforeDiscoverNavigate,
      navigatePrimary: navigatePrimaryDestination,
    },
    resetTransientNavigation,
  } = navigation.commands;
  const queueFocus = useQueueFocusController({
    open: queueOpen,
    setOpen: playback.queueCommands.setOpen,
  });
  const localFavoritesController = useLocalFavoritesController({
    albums,
    connected,
    notify: notifyToast,
    queue,
    selectedAlbum,
  });
  const { favoriteAlbumIds, favoriteRadioShowIds, favoriteTrackIds } =
    localFavoritesController;
  const notify = notifyToast;
  const currentFavorite = useCurrentFavoriteController({
    currentTrack,
    favorites: localFavoritesController,
    notify,
  });
  const queueRecommendation = useQueueRecommendationController({
    albums,
    currentTrack,
    favoriteAlbumIds,
    onPlayRandomTrack: playRandomTrack,
    onQueueAlbum: queueAlbum,
    open: queueOpen,
  });
  const syncLibrary = librarySessionCommands.sync;
  const retryLibraryStartup = useCallback(() => {
    void librarySessionCommands.retryStartup();
  }, [librarySessionCommands]);

  const fallbackAlbumCandidateTracks = useMemo(() => {
    if (!selectedArtistFallback) return [];
    const fallbackAlbum = albums.find(
      (album) => album.id === selectedArtistFallback.albumId,
    );
    if (!fallbackAlbum) return [];
    return (
      cachedAlbumTracks(queryClient, fallbackAlbum) ??
      fallbackAlbum.tracks ??
      queue.filter((track) => track.albumId === fallbackAlbum.id)
    );
  }, [albums, queryClient, queue, selectedArtistFallback]);
  const playTrack = playTrackRuntime;

  const playTracks = useCallback(
    (tracks: Track[]) => {
      if (!tracks.length) return;
      playTracksRuntime(tracks);
      notify(`Playing ${countLabel(tracks.length, "track")}`, "good");
    },
    [notify, playTracksRuntime],
  );

  const queueTracks = useCallback(
    (tracks: Track[]) => {
      if (!tracks.length) return;
      queueTracksRuntime(tracks);
      notify(`${countLabel(tracks.length, "track")} added to queue`, "good");
    },
    [notify, queueTracksRuntime],
  );

  const queueTrack = useCallback(
    (track: Track) => {
      queueTrackRuntime(track);
      notify(`${track.title} added to queue`, "good");
    },
    [notify, queueTrackRuntime],
  );

  const clearQueue = useCallback(() => {
    clearQueueRuntime();
    if (!currentTrack) clearSelectedAlbum();
  }, [clearQueueRuntime, clearSelectedAlbum, currentTrack]);

  const handleDisconnect = useCallback(async () => {
    await disconnectLibrary();
    await playback.sessionCommands.clear();
    resetTransientNavigation();
    librarySearch.commands.clearFilters();
    closeConnection();
  }, [
    closeConnection,
    disconnectLibrary,
    librarySearch.commands,
    playback.sessionCommands,
    resetTransientNavigation,
  ]);
  const handleConnected = useCallback(
    (library: Album[]) => {
      acceptConnectedLibrary(library);
      playback.sessionCommands.setReady(true);
    },
    [acceptConnectedLibrary, playback.sessionCommands],
  );
  const libraryWorkspace = useLibraryWorkspaceController({
    albums,
    availability: {
      commands: {
        connect: openConnection,
        retryStartup: retryLibraryStartup,
        sync: syncLibrary,
      },
      state: {
        artworkRefreshing,
        connected,
        libraryError,
        syncState,
      },
    },
    fallbackAlbumCandidateTracks,
    libraryActions,
    libraryPaneRef,
    navigation: {
      openArtist,
      openArtistFromMetadata: browseArtist,
    },
    playback: {
      currentAlbumId: currentTrack?.albumId,
      playing,
      shuffle: startLibraryShuffle,
      shuffleInProgress: Boolean(libraryShuffleProgress),
      shuffleProgress: libraryShuffleProgress,
      toggle: togglePlayback,
    },
    routeInput: libraryRouteInput,
    search: librarySearch,
    selectedArtistFallback,
  });
  const { activeArtist } = libraryWorkspace.browse;
  const playerVisible = !nowPlayingOpen || queueOpen;
  const routeRuntimes = useAppRouteRuntimes({
    favorites: {
      controller: localFavoritesController,
      onAddToPlaylist: openAddToPlaylist,
      onToggleCurrent: currentFavorite.toggle,
    },
    library: {
      actions: libraryActions,
      albums,
      routeInput: libraryRouteInput,
      workspace: libraryWorkspace,
    },
    navigation,
    notify,
    playback: {
      actions: {
        playTrack,
        playTracks,
        queueTrack,
        queueTracks,
        toggle: togglePlayback,
      },
      controller: playback,
    },
    queue: {
      controlRef: queueFocus.controlRef,
      recommendation: queueRecommendation,
    },
  });

  return (
    <AppRouteRuntimeProviders playback={playback} runtimes={routeRuntimes}>
      <AppShell
        nowPlayingOpen={nowPlayingOpen}
        route={{
          sidebar: (
            <AppSidebar
              connected={connected}
              onConnect={openConnection}
              onDiscoverNavigate={beforeDiscoverNavigate}
              onNavigate={navigatePrimaryDestination}
            />
          ),
          chrome: libraryWorkspace.chrome ? (
            <LibraryScreenChrome {...libraryWorkspace.chrome} />
          ) : undefined,
          outlet: <Outlet />,
          libraryPaneRef,
        }}
        queue={{
          open: queueOpen,
          onOpenChange: queueFocus.onOpenChange,
          panel: (
            <PersistentQueueSurface
              focus={queueFocus}
              getRadioChapterLocalLinks={getRadioChapterLocalLinks}
              loadingAlbumId={loadingAlbumId}
              navigation={{
                onAlbum: openTrackAlbum,
                onArtist: browseArtist,
                onNowPlaying: openNowPlaying,
                onOpenRadioItem: openRadioItem,
                onRadioSeries: browseRadioSeries,
                onRecommendationAlbum: openAlbum,
              }}
              onClear={clearQueue}
              playback={playback}
              playerVisible={playerVisible}
              recommendation={queueRecommendation}
              recommendationPlayLoading={randomPickLoading}
            />
          ),
        }}
        playback={{
          dock: (
            <PersistentPlayerDock
              favorites={{
                onAddToPlaylist: openAddToPlaylist,
                onToggleCurrent: currentFavorite.toggle,
                radioShowIds: favoriteRadioShowIds,
                trackIds: favoriteTrackIds,
              }}
              getRadioChapterLocalLinks={getRadioChapterLocalLinks}
              loadingAlbumId={loadingAlbumId}
              navigation={{
                onAlbum: openTrackAlbum,
                onArtist: browseArtist,
                onNowPlaying: openNowPlaying,
                onOpenRadioItem: openRadioItem,
              }}
              nowPlayingOpen={nowPlayingOpen}
              playback={playback}
              queueControlRef={queueFocus.controlRef}
              visible={playerVisible}
            />
          ),
        }}
        persistentServices={
          <PersistentPlaybackServices
            activeArtistName={activeArtist?.name}
            albums={albums}
            nowPlayingOpen={nowPlayingOpen}
            playback={playback}
            selectedAlbumTitle={
              discoverDetail?.releaseTitle ?? selectedAlbum?.title
            }
            showMainWindow={mainWindow.showMainWindow}
            view={view}
          />
        }
        overlays={
          <>
            <MotionLabPanel
              open={motionLabOpen}
              onOpenChange={setMotionLabOpen}
            />
            <PersistentAppOverlays
              connected={connected}
              controller={overlays}
              notify={notify}
              onConnected={handleConnected}
              onDisconnected={handleDisconnect}
              updater={appUpdater}
            />
          </>
        }
      />
    </AppRouteRuntimeProviders>
  );
}
