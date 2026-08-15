import { memo, useLayoutEffect, useRef } from "react";
import { useCurrentRadioChapter } from "@/features/player/playbackClockHooks";
import { isDesktop } from "@/lib";
import {
  getWindowTitle,
  publishDocumentTitle,
  publishNativeWindowTitle,
  type WindowTitleControllerProps,
} from "./windowTitle";

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
  const publishedTitleRef = useRef<string>(undefined);
  const windowTitle = getWindowTitle({
    activeArtistName,
    currentRadioChapter,
    currentTrack,
    nowPlayingOpen,
    selectedAlbumTitle,
    view,
  });

  useLayoutEffect(() => {
    if (publishedTitleRef.current === windowTitle) return;
    publishedTitleRef.current = windowTitle;
    publishDocumentTitle(windowTitle);
    if (!isDesktop()) return;
    const generation = nativeTitleGenerationRef.current + 1;
    nativeTitleGenerationRef.current = generation;
    void publishNativeWindowTitle(
      windowTitle,
      generation,
      () => nativeTitleGenerationRef.current,
    );
    return () => {
      if (nativeTitleGenerationRef.current === generation) {
        nativeTitleGenerationRef.current += 1;
      }
    };
  }, [windowTitle]);

  return null;
});
