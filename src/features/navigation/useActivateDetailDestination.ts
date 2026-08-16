import { useLayoutEffect } from "react";

import {
  activateDetailDestination,
  clearDestinationFocus,
} from "@/detailNavigation";
import type { DetailTransitionKey } from "@/detailTransitionDescriptors";

export function useActivateDetailDestination(
  kind: DetailTransitionKey,
  targetKey: string,
  ready = true,
): void {
  useLayoutEffect(() => {
    if (!ready) return;
    activateDetailDestination(kind, targetKey);
    return () => {
      clearDestinationFocus();
    };
  }, [kind, ready, targetKey]);
}
