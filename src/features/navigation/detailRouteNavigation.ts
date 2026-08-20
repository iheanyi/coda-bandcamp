import {
  closeDetail,
  openDetail,
  type DetailCloseInput,
  type DetailOpenInput,
} from "@/detailNavigation";
import type { DetailTransitionKey } from "@/detailTransitionDescriptors";
import type { RouteCommitOutcome } from "@/features/navigation/routeCommit";

import { prepareDetailSource } from "./detailSourceIdentity";

export type IdentifiedDetailOpenRequest = Readonly<{
  returnScrollTop?: number;
  resetScrollOnOpen?: boolean;
  sharedIdentityAvailable: boolean;
  sourceTrigger?: HTMLElement;
}>;

function identifiedDetailTargetKey(
  kind: DetailTransitionKey,
  identity: string,
): string {
  return `${kind}:${identity}`;
}

export function openIdentifiedDetail(
  kind: DetailTransitionKey,
  identity: string,
  request: IdentifiedDetailOpenRequest,
  update: DetailOpenInput["update"],
): Promise<RouteCommitOutcome> {
  return openDetail({
    kind,
    source: prepareDetailSource(
      kind,
      identity,
      request.sharedIdentityAvailable,
      request.sourceTrigger,
    ),
    targetKey: identifiedDetailTargetKey(kind, identity),
    update,
    returnScrollTop: request.returnScrollTop,
    resetScrollOnOpen: request.resetScrollOnOpen,
  });
}

export function closeIdentifiedDetail(
  kind: DetailTransitionKey,
  identity: string,
  update: DetailCloseInput["update"],
): Promise<RouteCommitOutcome> {
  const targetKey = identifiedDetailTargetKey(kind, identity);
  return closeDetail({
    identity,
    kind,
    requestKey: `target:${targetKey}`,
    targetKey,
    update,
  });
}
