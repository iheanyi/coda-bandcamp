import { createContext, useContext } from "react";

import type { FavoritesScreenProps } from "@/SavedLibraryView";

export type SavedLibraryRuntimeValue = Readonly<
  Omit<FavoritesScreenProps, "className"> & {
    connected: boolean;
  }
>;

export const SavedLibraryRuntimeContext = createContext<
  SavedLibraryRuntimeValue | undefined
>(undefined);

export function useSavedLibraryRuntime(): SavedLibraryRuntimeValue {
  const runtime = useContext(SavedLibraryRuntimeContext);
  if (!runtime) {
    throw new Error("Saved routes require a Saved Library runtime provider");
  }
  return runtime;
}
