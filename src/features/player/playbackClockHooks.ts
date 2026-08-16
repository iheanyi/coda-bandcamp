import { useCallback, useSyncExternalStore } from "react";
import type { PlaybackClock } from "@/playbackClock";
import { radioAiringIndexesAt } from "@/radioPlayback";
import type { RadioChapter } from "@/types";

export function usePlaybackPosition(playbackClock: PlaybackClock): number {
  return useSyncExternalStore(
    playbackClock.subscribe,
    playbackClock.getSnapshot,
    playbackClock.getSnapshot,
  );
}

export type CurrentRadioChapterState = {
  current?: RadioChapter;
  next?: RadioChapter;
};

export function useCurrentRadioChapter(
  playbackClock: PlaybackClock,
  timeline: readonly RadioChapter[],
): CurrentRadioChapterState {
  const getCurrentIndex = useCallback(
    () =>
      radioAiringIndexesAt(timeline, playbackClock.getSnapshot()).currentIndex,
    [playbackClock, timeline],
  );
  const currentIndex = useSyncExternalStore(
    playbackClock.subscribe,
    getCurrentIndex,
    getCurrentIndex,
  );
  const current = currentIndex >= 0 ? timeline[currentIndex] : undefined;
  const next = current ? timeline[currentIndex + 1] : timeline[0];
  return { current, next };
}
