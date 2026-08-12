import type { ReactNode } from "react";

import {
  RadioRuntimeContext,
  type RadioRuntimeValue,
} from "./RadioRuntimeContext";

export function RadioRuntimeProvider({
  children,
  value,
}: Readonly<{
  children: ReactNode;
  value: RadioRuntimeValue;
}>) {
  return (
    <RadioRuntimeContext.Provider value={value}>
      {children}
    </RadioRuntimeContext.Provider>
  );
}
