import { memo, useEffect, useRef } from "react";
import { useCurrentRadioChapter } from "@/features/player/playbackClockHooks";
import { isDesktop } from "@/lib";
import type { PlaybackClock } from "@/playbackClock";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import type { CodaPrimaryView } from "@/routing/routeMeta";
import type { RadioChapter, Track } from "@/types";

const CODA_APP_NAME = import.meta.env.VITE_CODA_APP_NAME?.trim() || "Coda";

type NativeTitleWindow = Readonly<{
  setTitle: (title: string) => Promise<void>;
}>;

async function loadNativeTitleWindow(): Promise<NativeTitleWindow> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export async function applyCurrentNativeWindowTitle(
  title: string,
  generation: number,
  currentGeneration: () => number,
  loadWindow: () => Promise<NativeTitleWindow> = loadNativeTitleWindow,
): Promise<void> {
  const appWindow = await loadWindow();
  if (currentGeneration() !== generation) return;
  await appWindow.setTitle(title);
}

export type WindowTitleControllerProps = Readonly<{
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
  const subject =
    nowPlayingOpen && currentTrack
      ? currentRadioChapter?.title ?? currentTrack.title
      : selectedAlbumTitle ??
        activeArtistName ??
        (view === "discover"
          ? "Discover"
          : view === "radio"
            ? BANDCAMP_RADIO_PROVIDER
            : currentRadioChapter?.title ?? currentTrack?.title);
  const windowTitle = subject
    ? `${subject} — ${CODA_APP_NAME}`
    : CODA_APP_NAME;

  useEffect(() => {
    const generation = nativeTitleGenerationRef.current + 1;
    nativeTitleGenerationRef.current = generation;
    document.title = windowTitle;
    if (!isDesktop()) return;
    void applyCurrentNativeWindowTitle(
      windowTitle,
      generation,
      () => nativeTitleGenerationRef.current,
    )
      .catch(() => {
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
