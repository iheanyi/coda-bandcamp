import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  recommendQueueAlbum,
  type QueueRecommendation,
} from "@/queueRecommendation";
import type { Album, Track } from "@/types";

export type QueueRecommendationControllerOptions = Readonly<{
  albums: readonly Album[];
  currentTrack?: Track;
  favoriteAlbumIds: ReadonlySet<string>;
  onPlayRandomTrack: (
    albums: readonly Album[],
    scopeName: string,
  ) => void | Promise<void>;
  onQueueAlbum: (album: Album) => Promise<boolean>;
  open: boolean;
}>;

export type QueueRecommendationController = Readonly<{
  commands: Readonly<{
    addToQueue: () => Promise<void>;
    play: () => void;
    showAnother: () => void;
  }>;
  state: Readonly<{
    queueLoading: boolean;
    value?: QueueRecommendation;
  }>;
}>;

/**
 * Owns the queue drawer's local recommendation lifecycle. The recommendation
 * is derived entirely from bounded library metadata; accepting it delegates
 * hydration to the library action controller and never stores media URLs.
 */
export function useQueueRecommendationController({
  albums,
  currentTrack,
  favoriteAlbumIds,
  onPlayRandomTrack,
  onQueueAlbum,
  open,
}: QueueRecommendationControllerOptions): QueueRecommendationController {
  const [nonce, setNonce] = useState(0);
  const [acceptedAlbumIds, setAcceptedAlbumIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const [queueLoadingAlbumId, setQueueLoadingAlbumId] = useState<string>();
  const lastPlayedTrackRef = useRef<Track | undefined>(undefined);
  const activeQueueRequestRef = useRef<
    Readonly<{ albumId: string; generation: number }> | undefined
  >(undefined);
  const queueRequestGenerationRef = useRef(0);

  useEffect(() => {
    if (currentTrack) lastPlayedTrackRef.current = currentTrack;
  }, [currentTrack]);

  useEffect(
    () => () => {
      queueRequestGenerationRef.current += 1;
      activeQueueRequestRef.current = undefined;
    },
    [],
  );

  const recommendation = useMemo(
    () =>
      open
        ? recommendQueueAlbum(
            albums,
            currentTrack ?? lastPlayedTrackRef.current,
            favoriteAlbumIds,
            nonce,
            acceptedAlbumIds,
          )
        : undefined,
    [
      acceptedAlbumIds,
      albums,
      currentTrack,
      favoriteAlbumIds,
      nonce,
      open,
    ],
  );
  const recommendationRef = useRef(recommendation);
  recommendationRef.current = recommendation;

  const addToQueue = useCallback(async () => {
    const current = recommendationRef.current;
    if (!current || activeQueueRequestRef.current) return;

    const request = {
      albumId: current.album.id,
      generation: queueRequestGenerationRef.current + 1,
    };
    queueRequestGenerationRef.current = request.generation;
    activeQueueRequestRef.current = request;
    setQueueLoadingAlbumId(request.albumId);
    try {
      const added = await onQueueAlbum(current.album);
      if (activeQueueRequestRef.current !== request || !added) return;
      setAcceptedAlbumIds((albumIds) => {
        const nextAlbumIds = new Set(albumIds);
        nextAlbumIds.add(request.albumId);
        return nextAlbumIds;
      });
      setNonce((currentNonce) => currentNonce + 1);
    } finally {
      if (activeQueueRequestRef.current === request) {
        activeQueueRequestRef.current = undefined;
        setQueueLoadingAlbumId(undefined);
      }
    }
  }, [onQueueAlbum]);

  const play = useCallback(() => {
    const current = recommendationRef.current;
    if (!current) return;
    void onPlayRandomTrack([current.album], current.album.title);
  }, [onPlayRandomTrack]);

  const showAnother = useCallback(() => {
    if (activeQueueRequestRef.current) return;
    setNonce((currentNonce) => currentNonce + 1);
  }, []);

  return useMemo(
    () => ({
      commands: {
        addToQueue,
        play,
        showAnother,
      },
      state: {
        queueLoading: queueLoadingAlbumId !== undefined,
        value: recommendation,
      },
    }),
    [
      addToQueue,
      play,
      queueLoadingAlbumId,
      recommendation,
      showAnother,
    ],
  );
}
