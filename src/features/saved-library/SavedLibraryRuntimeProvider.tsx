import type { ReactNode } from "react";

import {
  SavedLibraryRuntimeContext,
  type SavedLibraryRuntimeValue,
} from "./SavedLibraryRuntimeContext";

export function SavedLibraryRuntimeProvider({
  children,
  value,
}: Readonly<{
  children: ReactNode;
  value: SavedLibraryRuntimeValue;
}>) {
  return (
    <SavedLibraryRuntimeContext.Provider value={value}>
      {children}
    </SavedLibraryRuntimeContext.Provider>
  );
}
