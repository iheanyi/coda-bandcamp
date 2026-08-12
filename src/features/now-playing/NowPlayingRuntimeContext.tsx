import { createContext, type ReactNode, useContext } from "react";
import { NowPlayingView, type NowPlayingViewProps } from "@/NowPlayingView";
import type { RouteResource } from "@/routing/routeResource";
import { LibrarySkeleton } from "@/features/library/LibraryScreenPrimitives";

export type NowPlayingRuntimeValue = RouteResource<NowPlayingViewProps>;

const NowPlayingRuntimeContext = createContext<
  NowPlayingRuntimeValue | undefined
>(undefined);

export function NowPlayingRuntimeProvider({
  children,
  value,
}: Readonly<{
  children: ReactNode;
  value: NowPlayingRuntimeValue;
}>) {
  return (
    <NowPlayingRuntimeContext.Provider value={value}>
      {children}
    </NowPlayingRuntimeContext.Provider>
  );
}

export function NowPlayingScreen() {
  const resource = useContext(NowPlayingRuntimeContext);
  if (!resource) {
    throw new Error("The Now Playing route requires its runtime provider");
  }
  if (resource.status === "pending") {
    return <LibrarySkeleton label="Restoring Now Playing" />;
  }
  if (resource.status === "not-found") {
    return (
      <section className="grid min-h-full place-items-center px-6 py-12 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Nothing is playing</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a track from your Collection to open Now Playing.
          </p>
        </div>
      </section>
    );
  }
  return <NowPlayingView {...resource.value} />;
}
