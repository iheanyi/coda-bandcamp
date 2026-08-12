import { createContext, useContext } from "react";

import type { RadioPlaybackProps } from "./radioScreenTypes";

export type RadioRuntimeValue = RadioPlaybackProps;

export const RadioRuntimeContext = createContext<RadioRuntimeValue | undefined>(
  undefined,
);

export function useRadioRuntime(): RadioRuntimeValue {
  const runtime = useContext(RadioRuntimeContext);
  if (!runtime) {
    throw new Error("Radio routes require a Radio runtime provider");
  }
  return runtime;
}
