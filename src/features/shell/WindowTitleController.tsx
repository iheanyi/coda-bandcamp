import { memo, useEffect, useRef } from "react";
import { useCurrentRadioChapter } from "@/features/player/playbackClockHooks";
import { isDesktop } from "@/lib";
import type { PlaybackClock } from "@/playbackClock";
import type { CodaPrimaryView } from "@/routing/routeMeta";
import type { RadioChapter, Track } from "@/types";
import { applyCurrentNativeWindowTitle, getWindowTitle } from "./windowTitle";

type WindowTitleControllerProps = Readonly<{
  playbackClock: PlaybackClock;
  currentTrack?: Track;
  radioTimeline: readonly RadioChapter[];
  nowPlayingOpen: boolean;
  selectedAlbumTitle?: string;
  activeArtistName?: string;
  view: CodaPrimaryView;
}>;

export const WindowTitleController = memo(function WindowTitleController({
  playbackClock,
  currentTrack,
  radioTimeline,
  nowPlayingOpen,
  selectedAlbumTitle,
  activeArtistName,
  view,
}: WindowTitleControllerProps) {
  const { current: currentRadioChapter } = useCurrentRadioChapter(
    playbackClock,
    radioTimeline,
  );
  const nativeTitleGenerationRef = useRef(0);
  const windowTitle = getWindowTitle({
    activeArtistName,
    currentRadioChapter,
    currentTrack,
    nowPlayingOpen,
    selectedAlbumTitle,
    view,
  });

  useEffect(() => {
    const generation = nativeTitleGenerationRef.current + 1;
    nativeTitleGenerationRef.current = generation;
    document.title = windowTitle;
    if (!isDesktop()) return;
    void applyCurrentNativeWindowTitle(
      windowTitle,
      generation,
      () => nativeTitleGenerationRef.current,
    ).catch(() => {
      // The static native title remains a safe fallback.
    });
    return () => {
      if (nativeTitleGenerationRef.current === generation) {
        nativeTitleGenerationRef.current += 1;
      }
    };
  }, [windowTitle]);

  return null;
});
