import { createContext, type ReactNode, useContext } from "react";
import type { FavoritesScreenProps } from "@/SavedLibraryView";

export type SavedLibraryRuntimeValue = Readonly<
  Omit<FavoritesScreenProps, "className"> & {
    connected: boolean;
  }
>;

const SavedLibraryRuntimeContext = createContext<
  SavedLibraryRuntimeValue | undefined
>(undefined);

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

export function useSavedLibraryRuntime(): SavedLibraryRuntimeValue {
  const runtime = useContext(SavedLibraryRuntimeContext);
  if (!runtime) {
    throw new Error("Saved routes require a Saved Library runtime provider");
  }
  return runtime;
}
