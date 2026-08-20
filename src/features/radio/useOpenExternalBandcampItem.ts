import { useCallback } from "react";

import { formatErrorMessage } from "@/formatError";

export function useOpenExternalBandcampItem(
  openExternal: (url: string) => Promise<void>,
  setActionError: (message: string) => void,
) {
  return useCallback(
    (url: string) => {
      setActionError("");
      void openExternal(url).catch((cause) => {
        setActionError(formatErrorMessage(cause));
      });
    },
    [openExternal, setActionError],
  );
}
