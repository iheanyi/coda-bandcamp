import type { ReactNode } from "react";

import {
  LibraryRouteRuntimeContext,
  type LibraryRouteRuntime,
} from "./LibraryRouteRuntime";

export function LibraryRouteRuntimeProvider({
  children,
  runtime,
}: Readonly<{
  children: ReactNode;
  runtime: LibraryRouteRuntime;
}>) {
  return (
    <LibraryRouteRuntimeContext.Provider value={runtime}>
      {children}
    </LibraryRouteRuntimeContext.Provider>
  );
}
