import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useCoverArtSource } from "./coverArtSource";
import { isDesktop } from "./lib";
import {
  createMiniPlayerSnapshot,
  MINI_PLAYER_COMMAND_EVENT,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_EVENT,
  parseMiniPlayerCommand,
  type MiniPlayerSnapshot,
} from "./miniPlayer";
import type { PlaybackClock } from "./playbackClock";
import {
  nextRadioChapterTimeInTimeline,
  previousRadioChapterTimeInTimeline,
  radioAiringIndexesAt,
} from "./radioPlayback";
import type { RadioChapter, Track } from "./types";

export type MiniPlayerEventBridge = {
  emitSnapshot: (snapshot: MiniPlayerSnapshot) => Promise<void>;
  listenForRequest: (handler: () => void) => Promise<() => void>;
  listenForCommand: (handler: (payload: unknown) => void) => Promise<() => void>;
};

type MiniPlayerBridgeProps = {
  eventBridge?: MiniPlayerEventBridge;
  track?: Track;
  artwork?: Pick<Track, "coverArt" | "artworkUrl">;
  radioTimeline: readonly RadioChapter[];
  playbackClock: PlaybackClock;
  playing: boolean;
  durationSeconds: number;
  volume: number;
  canPrevious: boolean;
  canNext: boolean;
  onTogglePlayback: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSeek: (positionSeconds: number) => void;
  onSetVolume: (volume: number) => void;
  onShowMain: () => void;
  createArtworkSource?: (coverArt: string) => string;
};

let nativeEventBridgeRequest: Promise<MiniPlayerEventBridge> | undefined;

function nativeEventBridge(): Promise<MiniPlayerEventBridge> {
  if (!nativeEventBridgeRequest) {
    nativeEventBridgeRequest = import("@tauri-apps/api/event").then(
      ({ emitTo, listen }) => ({
        emitSnapshot: (snapshot: MiniPlayerSnapshot) =>
          emitTo("mini-player", MINI_PLAYER_STATE_EVENT, snapshot),
        listenForRequest: (handler: () => void) =>
          listen(MINI_PLAYER_REQUEST_STATE_EVENT, handler),
        listenForCommand: (handler: (payload: unknown) => void) =>
          listen<unknown>(
            MINI_PLAYER_COMMAND_EVENT,
            ({ payload }) => handler(payload),
          ),
      }),
    );
  }
  return nativeEventBridgeRequest;
}

export function MiniPlayerBridge({
  eventBridge,
  track,
  artwork,
  radioTimeline,
  playbackClock,
  playing,
  durationSeconds,
  volume,
  canPrevious,
  canNext,
  onTogglePlayback,
  onPrevious,
  onNext,
  onSeek,
  onSetVolume,
  onShowMain,
  createArtworkSource,
}: MiniPlayerBridgeProps) {
  const bridgeEnabled = Boolean(eventBridge) || isDesktop();
  const positionSeconds = useSyncExternalStore(
    playbackClock.subscribe,
    playbackClock.getSnapshot,
    playbackClock.getSnapshot,
  );
  const { currentIndex } = radioAiringIndexesAt(
    radioTimeline,
    positionSeconds,
  );
  const currentChapter = currentIndex >= 0
    ? radioTimeline[currentIndex]
    : undefined;
  const coverArtId = radioTimeline.length > 0
    ? undefined
    : (track?.coverArt ?? artwork?.coverArt);
  const directArtworkUrl = currentChapter?.artworkUrl ?? (
    coverArtId ? undefined : (track?.artworkUrl ?? artwork?.artworkUrl)
  );
  const subscribedArtworkUrl = useCoverArtSource(coverArtId);
  const resolvedArtworkUrl = directArtworkUrl ?? (
    bridgeEnabled && coverArtId
      ? (createArtworkSource?.(coverArtId) ?? subscribedArtworkUrl)
      : undefined
  );

  const snapshot = useMemo(
    () =>
      createMiniPlayerSnapshot({
        track,
        display: currentChapter
          ? {
              title: currentChapter.title,
              artist: currentChapter.artist,
              album: currentChapter.album ?? track?.album,
              artworkUrl: resolvedArtworkUrl,
            }
          : { artworkUrl: resolvedArtworkUrl },
        playing,
        positionSeconds,
        durationSeconds: track ? durationSeconds : 0,
        volume,
        canPrevious: Boolean(
          track && (
            canPrevious ||
            positionSeconds > 4 ||
            previousRadioChapterTimeInTimeline(
              radioTimeline,
              positionSeconds,
            ) !== undefined
          ),
        ),
        canNext: Boolean(
          track && (
            canNext ||
            nextRadioChapterTimeInTimeline(
              radioTimeline,
              positionSeconds,
            ) !== undefined
          ),
        ),
      }),
    [
      canNext,
      canPrevious,
      currentChapter,
      durationSeconds,
      playing,
      positionSeconds,
      radioTimeline,
      resolvedArtworkUrl,
      track,
      volume,
    ],
  );
  const latestSnapshotRef = useRef(snapshot);
  latestSnapshotRef.current = snapshot;
  const handlersRef = useRef({
    onTogglePlayback,
    onPrevious,
    onNext,
    onSeek,
    onSetVolume,
    onShowMain,
  });
  handlersRef.current = {
    onTogglePlayback,
    onPrevious,
    onNext,
    onSeek,
    onSetVolume,
    onShowMain,
  };

  const bridgeRequest = useMemo(
    () =>
      eventBridge
        ? Promise.resolve(eventBridge)
        : bridgeEnabled
          ? nativeEventBridge()
          : undefined,
    [bridgeEnabled, eventBridge],
  );

  useEffect(() => {
    if (!bridgeRequest) return;
    let disposed = false;
    let disposeRequest: (() => void) | undefined;
    let disposeCommand: (() => void) | undefined;

    void bridgeRequest
      .then(async (bridge) => {
        const [requestDisposer, commandDisposer] = await Promise.all([
          bridge.listenForRequest(() => {
            void bridge.emitSnapshot(latestSnapshotRef.current).catch(() => {
              // The compact window may have closed between request and reply.
            });
          }),
          bridge.listenForCommand((payload) => {
            const command = parseMiniPlayerCommand(payload);
            if (!command) return;
            const handlers = handlersRef.current;
            if (command.type === "play-pause") handlers.onTogglePlayback();
            if (command.type === "previous") handlers.onPrevious();
            if (command.type === "next") handlers.onNext();
            if (
              command.type === "seek" &&
              command.positionSeconds <=
                latestSnapshotRef.current.durationSeconds
            ) {
              handlers.onSeek(command.positionSeconds);
            }
            if (command.type === "volume") handlers.onSetVolume(command.volume);
            if (command.type === "show-main") handlers.onShowMain();
          }),
        ]);
        if (disposed) {
          requestDisposer();
          commandDisposer();
          return;
        }
        disposeRequest = requestDisposer;
        disposeCommand = commandDisposer;
      })
      .catch(() => {
        // The full player remains usable when the optional bridge is unavailable.
      });

    return () => {
      disposed = true;
      disposeRequest?.();
      disposeCommand?.();
    };
  }, [bridgeRequest]);

  useEffect(() => {
    if (!bridgeRequest) return;
    void bridgeRequest
      .then((bridge) => bridge.emitSnapshot(snapshot))
      .catch(() => {
        // The compact window is normally hidden; dropped updates are recoverable.
      });
  }, [bridgeRequest, snapshot]);

  return null;
}
