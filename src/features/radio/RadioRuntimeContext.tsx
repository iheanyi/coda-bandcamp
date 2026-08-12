import { createContext, type ReactNode, useContext } from "react";

import type { RadioPlaybackProps } from "./radioScreenTypes";

export type RadioRuntimeValue = RadioPlaybackProps;

const RadioRuntimeContext = createContext<RadioRuntimeValue | undefined>(
  undefined,
);

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

export function useRadioRuntime(): RadioRuntimeValue {
  const runtime = useContext(RadioRuntimeContext);
  if (!runtime) {
    throw new Error("Radio routes require a Radio runtime provider");
  }
  return runtime;
}
