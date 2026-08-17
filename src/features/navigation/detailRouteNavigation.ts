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

type MutableIdentifiedDetailOpen = {
  kind: DetailTransitionKey;
  resetScrollOnOpen?: boolean;
  returnScrollTop?: number;
  source: DetailOpenInput["source"];
  targetKey: string;
  update: DetailOpenInput["update"];
};

export function identifiedDetailTargetKey(
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
  const openInput: MutableIdentifiedDetailOpen = {
    kind,
    source: prepareDetailSource(
      kind,
      identity,
      request.sharedIdentityAvailable,
      request.sourceTrigger,
    ),
    targetKey: identifiedDetailTargetKey(kind, identity),
    update,
  };
  if (request.returnScrollTop !== undefined) {
    openInput.returnScrollTop = request.returnScrollTop;
  }
  if (request.resetScrollOnOpen) openInput.resetScrollOnOpen = true;
  return openDetail(openInput);
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
