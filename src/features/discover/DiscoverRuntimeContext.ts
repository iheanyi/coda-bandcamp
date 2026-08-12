import { createContext, useContext } from "react";

import type { DiscoverScreenProps } from "@/DiscoverView";

export type DiscoverRuntimeValue = Readonly<
  Pick<
    DiscoverScreenProps,
    | "currentTrackId"
    | "onOpenArtist"
    | "onOpenRelease"
    | "onPlay"
    | "onQueue"
    | "onTogglePlayback"
    | "playing"
  > & {
    onCloseRelease: () => void;
  }
>;

export const DiscoverRuntimeContext = createContext<
  DiscoverRuntimeValue | undefined
>(undefined);

export function useDiscoverRuntime(): DiscoverRuntimeValue {
  const runtime = useContext(DiscoverRuntimeContext);
  if (!runtime) {
    throw new Error("Discover routes require a Discover runtime provider");
  }
  return runtime;
}
