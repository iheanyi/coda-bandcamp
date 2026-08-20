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

export function getWindowTitle({
  activeArtistName,
  currentRadioChapter,
  currentTrack,
  nowPlayingOpen,
  selectedAlbumTitle,
  view,
}: Readonly<{
  activeArtistName?: string;
  currentRadioChapter?: RadioChapter;
  currentTrack?: Track;
  nowPlayingOpen: boolean;
  selectedAlbumTitle?: string;
  view: CodaPrimaryView;
}>): string {
  const subject =
    nowPlayingOpen && currentTrack
      ? (currentRadioChapter?.title ?? currentTrack.title)
      : (selectedAlbumTitle ??
        activeArtistName ??
        (view === "discover"
          ? "Discover"
          : view === "daily"
            ? "Bandcamp Daily"
            : view === "radio"
              ? BANDCAMP_RADIO_PROVIDER
              : (currentRadioChapter?.title ?? currentTrack?.title)));
  return subject ? `${subject} — ${CODA_APP_NAME}` : CODA_APP_NAME;
}
