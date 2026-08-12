import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getLastFmStatus } from "@/lib";
import type { LastFmStatus, Track } from "@/types";

const INITIAL_LAST_FM_STATUS: LastFmStatus = Object.freeze({
  configured: false,
  connected: false,
});

export type PlaylistDialogState = Readonly<{
  generation: number;
  open: boolean;
  tracks: Track[];
}>;

export type PersistentOverlaysController = Readonly<{
  commands: Readonly<{
    closeConnection: () => void;
    closePlaylist: () => void;
    completePlaylistExit: (generation: number) => void;
    openAddToPlaylist: (tracks: readonly Track[]) => void;
    openConnection: () => void;
    setLastFmStatus: (status: LastFmStatus) => void;
  }>;
  state: Readonly<{
    connectionOpen: boolean;
    lastFmStatus: LastFmStatus;
    playlist?: PlaylistDialogState;
  }>;
}>;

export type PersistentOverlaysControllerOptions = Readonly<{
  loadLastFmStatus?: () => Promise<LastFmStatus>;
}>;

/** Owns root overlay visibility without coupling dialog internals to App. */
export function usePersistentOverlaysController({
  loadLastFmStatus = getLastFmStatus,
}: PersistentOverlaysControllerOptions = {}): PersistentOverlaysController {
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistDialogState>();
  const [lastFmStatus, setLastFmStatus] = useState<LastFmStatus>(
    INITIAL_LAST_FM_STATUS,
  );
  const playlistGenerationRef = useRef(0);

  useEffect(() => {
    let active = true;
    void loadLastFmStatus().then(
      (status) => {
        if (active) setLastFmStatus(status);
      },
      () => {
        // Last.fm is optional; Bandcamp playback remains available.
      },
    );
    return () => {
      active = false;
    };
  }, [loadLastFmStatus]);

  const openConnection = useCallback(() => setConnectionOpen(true), []);
  const closeConnection = useCallback(() => setConnectionOpen(false), []);
  const openAddToPlaylist = useCallback((tracks: readonly Track[]) => {
    if (!tracks.length) return;
    const generation = playlistGenerationRef.current + 1;
    playlistGenerationRef.current = generation;
    setPlaylist({
      generation,
      open: true,
      tracks: [...tracks],
    });
  }, []);
  const closePlaylist = useCallback(() => {
    setPlaylist((current) =>
      current ? { ...current, open: false } : current,
    );
  }, []);
  const completePlaylistExit = useCallback((generation: number) => {
    setPlaylist((current) =>
      current?.generation === generation && !current.open
        ? undefined
        : current,
    );
  }, []);

  return useMemo(
    () => ({
      commands: {
        closeConnection,
        closePlaylist,
        completePlaylistExit,
        openAddToPlaylist,
        openConnection,
        setLastFmStatus,
      },
      state: {
        connectionOpen,
        lastFmStatus,
        playlist,
      },
    }),
    [
      closeConnection,
      closePlaylist,
      completePlaylistExit,
      connectionOpen,
      lastFmStatus,
      openAddToPlaylist,
      openConnection,
      playlist,
    ],
  );
}
