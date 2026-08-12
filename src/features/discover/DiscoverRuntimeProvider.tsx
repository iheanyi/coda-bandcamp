import type { ReactNode } from "react";

import {
  DiscoverRuntimeContext,
  type DiscoverRuntimeValue,
} from "./DiscoverRuntimeContext";

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
