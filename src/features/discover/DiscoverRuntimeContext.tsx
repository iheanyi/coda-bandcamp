import { createContext, type ReactNode, useContext } from "react";
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

const DiscoverRuntimeContext = createContext<DiscoverRuntimeValue | undefined>(
  undefined,
);

export function DiscoverRuntimeProvider({
  children,
  value,
}: Readonly<{
  children: ReactNode;
  value: DiscoverRuntimeValue;
}>) {
  return (
    <DiscoverRuntimeContext.Provider value={value}>
      {children}
    </DiscoverRuntimeContext.Provider>
  );
}

export function useDiscoverRuntime(): DiscoverRuntimeValue {
  const runtime = useContext(DiscoverRuntimeContext);
  if (!runtime) {
    throw new Error("Discover routes require a Discover runtime provider");
  }
  return runtime;
}
