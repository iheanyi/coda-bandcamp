import type { ReactNode } from "react";

import { DiscoverRuntimeProvider } from "@/features/discover/DiscoverRuntimeProvider";
import { LibraryRouteRuntimeProvider } from "@/features/library/LibraryRouteRuntimeProvider";
import { NowPlayingRuntimeProvider } from "@/features/now-playing/NowPlayingRuntimeContext";
import { PlaybackRuntimeProvider } from "@/features/playback-runtime";
import type { PlaybackRuntimeController } from "@/features/playback-runtime/types";
import { RadioRuntimeProvider } from "@/features/radio/RadioRuntimeProvider";
import { SavedLibraryRuntimeProvider } from "@/features/saved-library/SavedLibraryRuntimeProvider";

import type { AppRouteRuntimes } from "./useAppRouteRuntimes";

export type AppRouteRuntimeProvidersProps = Readonly<{
  children: ReactNode;
  playback: PlaybackRuntimeController;
  runtimes: AppRouteRuntimes;
}>;

/** Keeps route-runtime provider ordering out of the application composition UI. */
export function AppRouteRuntimeProviders({
  children,
  playback,
  runtimes,
}: AppRouteRuntimeProvidersProps) {
  return (
    <PlaybackRuntimeProvider controller={playback}>
      <LibraryRouteRuntimeProvider runtime={runtimes.library}>
        <DiscoverRuntimeProvider value={runtimes.discover}>
          <SavedLibraryRuntimeProvider value={runtimes.savedLibrary}>
            <RadioRuntimeProvider value={runtimes.radio}>
              <NowPlayingRuntimeProvider value={runtimes.nowPlaying}>
                {children}
              </NowPlayingRuntimeProvider>
            </RadioRuntimeProvider>
          </SavedLibraryRuntimeProvider>
        </DiscoverRuntimeProvider>
      </LibraryRouteRuntimeProvider>
    </PlaybackRuntimeProvider>
  );
}
