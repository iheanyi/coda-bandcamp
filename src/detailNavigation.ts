import {
  DETAIL_TRANSITION_DESCRIPTORS,
  type DetailTransitionKey,
  type DetailTransitionMarker,
} from "./detailTransitionDescriptors";
import {
  applyDomEdits,
  type DomEdit,
} from "./features/navigation/domSnapshot";
import {
  findDetailTransitionTrigger,
  findSlottedDetailReturnTrigger,
  resolveDetailTransitionEndpointTargets,
} from "./features/navigation/detailSourceIdentity";
import type { RouteCommitOutcome, RouteCommitResult } from "./features/navigation/routeCommit";
import {
  currentTransitionId,
  isCurrentTransition,
  transitionCodaView,
  type TransitionToken,
} from "./viewTransitions";

export const MAX_DETAIL_RETURN_STATES = 50;
export const MAX_DETAIL_SCROLL_TOP = 10_000_000;
const MAX_FOCUS_ATTEMPTS = 8;
const MAX_VIRTUAL_RETURN_ATTEMPTS = 8;

export type DetailTransitionEndpointTargets = Readonly<{
  owner: HTMLElement;
  secondary?: HTMLElement;
  shared?: HTMLElement;
}>;

export type DetailTransitionSource = Readonly<{
  identity: string;
  sharedIdentityAvailable: boolean;
  sourceTrigger?: HTMLElement;
  targets?: DetailTransitionEndpointTargets;
}>;

export type DetailOpenCommitResult = Readonly<{
  locationKey: string;
  outcome: RouteCommitOutcome;
}>;

export type DetailOpenInput = Readonly<{
  forcePageTransition?: boolean;
  headingFallbackId?: string;
  kind: DetailTransitionKey;
  resetScrollOnOpen?: boolean;
  returnScrollTop?: number;
  source: DetailTransitionSource;
  targetKey: string;
  update: () => DetailOpenCommitResult | Promise<DetailOpenCommitResult>;
}>;

export type DetailCloseInput = Readonly<{
  identity: string;
  kind: DetailTransitionKey;
  requestKey?: string;
  restoreFocus?: boolean;
  targetKey: string;
  update: (
    hasReturnState: boolean,
  ) =>
    | RouteCommitOutcome
    | RouteCommitResult
    | Promise<RouteCommitOutcome | RouteCommitResult>;
}>;

type DetailReturnState = Readonly<{
  headingFallbackId?: string;
  identity: string;
  kind: DetailTransitionKey;
  scrollTop: number;
  sharedIdentityAvailable: boolean;
  slot?: string;
}>;

const closeRequests = new Map<string, Promise<RouteCommitOutcome>>();
const returnStateOrder: string[] = [];
const returnStates = new Map<string, DetailReturnState>();

let activeDomRestore = () => {};
let closeEpoch = 0;
let focusedDestinationKey: string | undefined;
let focusedDestinationTokenId = 0;
let focusFrame: number | undefined;
let focusRequestKey: string | undefined;
let focusTimer: number | undefined;
let pendingScrollTop: number | undefined;

function assertNever(value: never): never {
  throw new TypeError(`Unsupported detail navigation variant: ${String(value)}`);
}

function isAnimationFrameRequester(
  value: typeof globalThis.requestAnimationFrame | undefined,
): value is (callback: FrameRequestCallback) => number {
  return value instanceof Function;
}

function isAnimationFrameCanceller(
  value: typeof globalThis.cancelAnimationFrame | undefined,
): value is (handle: number) => void {
  return value instanceof Function;
}

function cancelScheduledFrame(handle: number | undefined): void {
  if (handle === undefined) return;
  const cancelFrame = globalThis.cancelAnimationFrame;
  if (isAnimationFrameCanceller(cancelFrame)) {
    cancelFrame.call(globalThis, handle);
  }
}

export function libraryScrollRoot(): HTMLElement | null {
  return document.querySelector("[data-coda-library-scroll]");
}

function boundedScrollTop(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(MAX_DETAIL_SCROLL_TOP, Math.max(0, value));
}

function applyOwnedDomEdits(edits: readonly DomEdit[]): () => void {
  activeDomRestore();
  const restore = applyDomEdits(edits);
  activeDomRestore = restore;
  return restore;
}

function markerEdit(
  element: HTMLElement,
  marker: DetailTransitionMarker,
  identity: string,
): DomEdit {
  switch (marker.kind) {
    case "attribute":
      return { element, kind: "attribute", name: marker.name, value: identity };
    case "class":
      return { className: marker.name, element, kind: "class" };
    default:
      return assertNever(marker);
  }
}

function endpointMarkerEdits(
  kind: DetailTransitionKey,
  endpoint: "return" | "source",
  targets: DetailTransitionEndpointTargets,
  identity: string,
): DomEdit[] {
  const definition = DETAIL_TRANSITION_DESCRIPTORS[kind].markerEndpoints[endpoint];
  const edits: DomEdit[] = [];
  if ("shared" in definition && definition.shared && targets.shared) {
    edits.push(markerEdit(targets.shared, definition.shared, identity));
  }
  if ("secondary" in definition && definition.secondary && targets.secondary) {
    edits.push(markerEdit(targets.secondary, definition.secondary, identity));
  }
  return edits;
}

function paintedAncestorEdits(
  element: HTMLElement,
  scrollRoot: HTMLElement | null,
): DomEdit[] {
  const edits: DomEdit[] = [];
  let candidate: HTMLElement | null = element;
  while (candidate && candidate !== scrollRoot) {
    if (
      window.getComputedStyle(candidate).getPropertyValue("content-visibility") ===
      "auto"
    ) {
      edits.push({
        element: candidate,
        kind: "style",
        name: "content-visibility",
        value: "visible",
      });
    }
    candidate = candidate.parentElement;
  }
  return edits;
}

function nextDomOpportunity(): Promise<void> {
  return new Promise((resolve) => {
    const requestFrame = globalThis.requestAnimationFrame;
    if (isAnimationFrameRequester(requestFrame)) {
      requestFrame.call(globalThis, () => resolve());
      return;
    }
    queueMicrotask(resolve);
  });
}

async function awaitVirtualReturnTrigger(
  token: TransitionToken,
  findTrigger: () => HTMLElement | undefined,
  scrollRoot: HTMLElement | null,
  scrollTop: number,
): Promise<HTMLElement | undefined> {
  if (!token.isCurrent()) return undefined;
  if (scrollRoot) scrollRoot.scrollTop = scrollTop;
  for (let attempt = 0; attempt <= MAX_VIRTUAL_RETURN_ATTEMPTS; attempt += 1) {
    if (!token.isCurrent()) return undefined;
    const trigger = findTrigger();
    if (trigger?.isConnected) return trigger;
    if (attempt === MAX_VIRTUAL_RETURN_ATTEMPTS) return undefined;
    await nextDomOpportunity();
  }
  return undefined;
}

function cancelScheduledFocus(): void {
  focusRequestKey = undefined;
  cancelScheduledFrame(focusFrame);
  if (focusTimer !== undefined) window.clearTimeout(focusTimer);
  focusFrame = undefined;
  focusTimer = undefined;
}

function scheduleFocus(
  key: string,
  resolveTarget: () => HTMLElement | undefined,
  finish: (focused: boolean) => void,
  isCurrent: () => boolean,
): void {
  if (focusRequestKey === key) return;
  cancelScheduledFocus();
  focusRequestKey = key;
  let attempts = 0;
  const settle = (focused: boolean) => {
    if (focusRequestKey !== key) return;
    focusRequestKey = undefined;
    focusFrame = undefined;
    focusTimer = undefined;
    finish(focused);
  };
  const run = () => {
    if (focusRequestKey !== key) return;
    if (!isCurrent()) {
      settle(false);
      return;
    }
    const target = resolveTarget();
    if (target?.isConnected) {
      target.focus({ preventScroll: true });
      settle(true);
      return;
    }
    if (attempts >= MAX_FOCUS_ATTEMPTS) {
      settle(false);
      return;
    }
    attempts += 1;
    const requestFrame = window.requestAnimationFrame;
    if (isAnimationFrameRequester(requestFrame)) {
      focusFrame = requestFrame.call(window, run);
    } else {
      focusTimer = window.setTimeout(run, 0);
    }
  };
  run();
}

function putReturnState(key: string, state: DetailReturnState): void {
  const existing = returnStateOrder.indexOf(key);
  if (existing >= 0) returnStateOrder.splice(existing, 1);
  returnStates.set(key, state);
  returnStateOrder.push(key);
  while (returnStateOrder.length > MAX_DETAIL_RETURN_STATES) {
    const oldest = returnStateOrder.shift();
    if (oldest !== undefined) forgetReturnState(oldest);
  }
}

function aliasReturnState(aliasKey: string, state: DetailReturnState): void {
  if (returnStateOrder.includes(aliasKey)) return;
  returnStates.set(aliasKey, state);
}

function forgetReturnState(key: string): DetailReturnState | undefined {
  const state = returnStates.get(key);
  if (!state) return undefined;
  const aliasedKeys: string[] = [];
  for (const [storedKey, stored] of returnStates.entries()) {
    if (stored === state) aliasedKeys.push(storedKey);
  }
  for (const storedKey of aliasedKeys) returnStates.delete(storedKey);
  const orderIndex = returnStateOrder.indexOf(key);
  if (orderIndex >= 0) returnStateOrder.splice(orderIndex, 1);
  for (let index = returnStateOrder.length - 1; index >= 0; index -= 1) {
    const orderedKey = returnStateOrder[index];
    if (orderedKey !== undefined && !returnStates.has(orderedKey)) {
      returnStateOrder.splice(index, 1);
    }
  }
  return state;
}

function takeReturnState(key: string): DetailReturnState | undefined {
  return forgetReturnState(key);
}

function lookupReturnState(key: string): DetailReturnState | undefined {
  return returnStates.get(key);
}

function triggerSlot(trigger: HTMLElement | undefined, kind: DetailTransitionKey): string | undefined {
  const slotAttribute =
    DETAIL_TRANSITION_DESCRIPTORS[kind].domIdentity.trigger.slotAttribute;
  if (!slotAttribute || !trigger) return undefined;
  return trigger.getAttribute(slotAttribute) ?? undefined;
}

function sharedReturnSlots(kind: DetailTransitionKey): readonly string[] | undefined {
  const descriptor = DETAIL_TRANSITION_DESCRIPTORS[kind];
  return "sharedReturnSlots" in descriptor ? descriptor.sharedReturnSlots : undefined;
}

function canReverseShared(state: DetailReturnState | undefined): boolean {
  if (!state?.sharedIdentityAvailable) return false;
  const slots = sharedReturnSlots(state.kind);
  if (!slots) return true;
  return state.slot !== undefined && slots.includes(state.slot);
}

function liveCompactPlayerArtwork(): HTMLElement | undefined {
  return (
    document.querySelector<HTMLElement>(".player__art-link") ??
    document.querySelector<HTMLElement>("[data-player-album-link]") ??
    undefined
  );
}

function activeElementNeedsFocusRestore(): boolean {
  const active = document.activeElement;
  if (!(active instanceof Node)) return true;
  if (active === document.body || active === document.documentElement) {
    return true;
  }
  return !active.isConnected;
}

function findReturnTrigger(state: DetailReturnState): HTMLElement | undefined {
  const slotted = findDetailTransitionTrigger(
    state.kind,
    state.identity,
    state.slot,
  );
  if (slotted) return slotted;
  if (state.kind === "now-playing") return liveCompactPlayerArtwork();
  if (state.slot === "player-album") {
    return (
      document.querySelector<HTMLElement>("[data-player-album-link]") ?? undefined
    );
  }
  if (state.slot) {
    const scoped = findSlottedDetailReturnTrigger(
      state.kind,
      state.identity,
      state.slot,
    );
    if (scoped) return scoped;
    if (sharedReturnSlots(state.kind)?.includes(state.slot)) {
      // Shared slots reverse-morph release-identified artwork or titles; a
      // wrong-identity slot match would focus and mark another card, so
      // recover through the stored identity instead.
      return findDetailTransitionTrigger(state.kind, state.identity);
    }
    const slotAttribute =
      DETAIL_TRANSITION_DESCRIPTORS[state.kind].domIdentity.trigger.slotAttribute;
    if (slotAttribute) {
      const bySlot = document.querySelector<HTMLElement>(
        `[${slotAttribute}="${state.slot}"]`,
      );
      if (bySlot) return bySlot;
    }
    return (
      document.querySelector<HTMLElement>(
        `[data-navigation-slot="${state.slot}"]`,
      ) ?? undefined
    );
  }
  return findDetailTransitionTrigger(state.kind, state.identity);
}

function commitOutcome(
  result: RouteCommitOutcome | RouteCommitResult | undefined,
): RouteCommitOutcome {
  if (result === undefined) return "failed";
  if (
    result === "rendered" ||
    result === "same-location" ||
    result === "timeout" ||
    result === "failed"
  ) {
    return result;
  }
  return result.outcome;
}

function closeCommitSucceeded(outcome: RouteCommitOutcome): boolean {
  return outcome === "rendered";
}

function openCommitSucceeded(
  result: DetailOpenCommitResult | undefined,
): result is DetailOpenCommitResult {
  return result !== undefined && result.outcome === "rendered";
}

function openReturnStateKey(
  result: DetailOpenCommitResult,
  targetKey: string,
): string | undefined {
  if (!openCommitSucceeded(result)) return undefined;
  return result.locationKey || `target:${targetKey}`;
}

function settleInFlightCloses(): Promise<void> {
  const pending = [...closeRequests.values()];
  if (pending.length === 0) return Promise.resolve();
  return Promise.all(pending).then(() => undefined);
}

function consumeReturnState(
  requestKey: string,
  targetKey: string,
  stored: DetailReturnState | undefined,
): void {
  if (!stored) return;
  if (lookupReturnState(requestKey) === stored) takeReturnState(requestKey);
  if (lookupReturnState(`target:${targetKey}`) === stored) {
    takeReturnState(`target:${targetKey}`);
  }
  if (lookupReturnState(targetKey) === stored) takeReturnState(targetKey);
}

export async function openDetail(input: DetailOpenInput): Promise<RouteCommitOutcome> {
  abortDetailNavigationWork();
  const descriptor = DETAIL_TRANSITION_DESCRIPTORS[input.kind];
  const useShared = Boolean(
    input.source.sharedIdentityAvailable && !input.forcePageTransition,
  );
  const returnScrollTop = boundedScrollTop(
    input.returnScrollTop ?? libraryScrollRoot()?.scrollTop,
  );
  const slot = triggerSlot(input.source.sourceTrigger, input.kind);
  const sourceEdits =
    useShared && input.source.targets
      ? endpointMarkerEdits(
          input.kind,
          "source",
          input.source.targets,
          input.source.identity,
        )
      : [];
  const restoreSource = applyOwnedDomEdits(sourceEdits);
  let outcome: RouteCommitOutcome = "failed";

  try {
    await transitionCodaView(
      async (token) => {
        if (!token.isCurrent()) return;
        const result = await input.update();
        outcome = commitOutcome(result);
        if (!token.isCurrent() || !openCommitSucceeded(result)) return;
        const returnKey = openReturnStateKey(result, input.targetKey);
        if (!returnKey) return;
        const state = Object.freeze({
          headingFallbackId: input.headingFallbackId,
          identity: input.source.identity,
          kind: input.kind,
          scrollTop: returnScrollTop,
          sharedIdentityAvailable: input.source.sharedIdentityAvailable,
          slot,
        });
        putReturnState(returnKey, state);
        const aliasKey = `target:${input.targetKey}`;
        if (aliasKey !== returnKey) aliasReturnState(aliasKey, state);
        if (input.resetScrollOnOpen) {
          const scrollRoot = libraryScrollRoot();
          if (scrollRoot) scrollRoot.scrollTop = 0;
        }
      },
      useShared ? descriptor.openKind : "page-forward",
      true,
    );
    return outcome;
  } finally {
    if (activeDomRestore === restoreSource) {
      restoreSource();
      activeDomRestore = () => {};
    }
  }
}

async function performClose(input: DetailCloseInput): Promise<RouteCommitOutcome> {
  cancelScheduledFocus();
  focusedDestinationKey = undefined;
  const epoch = closeEpoch;
  const requestKey = input.requestKey ?? `target:${input.targetKey}`;
  const stored =
    lookupReturnState(requestKey) ??
    lookupReturnState(`target:${input.targetKey}`) ??
    lookupReturnState(input.targetKey);
  const reversesShared = canReverseShared(stored);
  const returnScrollTop = stored ? stored.scrollTop : 0;
  pendingScrollTop = returnScrollTop;
  let focusApplied = false;
  let restoreReturn = () => {};
  let returnFocusTarget: HTMLElement | undefined;
  let returnMarkersApplied = false;
  let returnPrepared = false;
  let outcome: RouteCommitOutcome = "failed";

  const closeStillCurrent = (token: TransitionToken) =>
    token.isCurrent() && epoch === closeEpoch;

  const applyReturnMarkers = (trigger: HTMLElement | undefined) => {
    if (returnMarkersApplied) return true;
    if (!stored || !reversesShared || !trigger?.isConnected) return false;
    const scrollRoot = libraryScrollRoot();
    const targets = resolveDetailTransitionEndpointTargets(
      stored.kind,
      trigger,
      stored.identity,
    );
    restoreReturn = applyOwnedDomEdits([
      ...paintedAncestorEdits(targets.owner, scrollRoot),
      ...endpointMarkerEdits(input.kind, "return", targets, input.identity),
    ]);
    returnMarkersApplied = true;
    return true;
  };

  const applyReturnFocus = async (token: TransitionToken) => {
    if (input.restoreFocus === false || focusApplied || !closeStillCurrent(token)) {
      return;
    }
    let focusTarget: HTMLElement | undefined;
    if (stored?.headingFallbackId) {
      const headingId = stored.headingFallbackId;
      focusTarget = await awaitVirtualReturnTrigger(
        token,
        () => document.getElementById(headingId) ?? undefined,
        null,
        0,
      );
    } else if (stored) {
      const trigger = await awaitVirtualReturnTrigger(
        token,
        () => findReturnTrigger(stored),
        libraryScrollRoot(),
        returnScrollTop,
      );
      if (trigger?.isConnected) focusTarget = trigger;
    }
    if (!closeStillCurrent(token)) return;
    if (focusTarget?.isConnected) {
      focusTarget.focus({ preventScroll: true });
      returnFocusTarget = focusTarget;
    }
    focusApplied = true;
  };

  const reassertReturnFocus = (token: TransitionToken) => {
    if (input.restoreFocus === false || !closeStillCurrent(token)) return;
    if (!returnFocusTarget?.isConnected) return;
    if (!activeElementNeedsFocusRestore()) return;
    returnFocusTarget.focus({ preventScroll: true });
  };

  const prepareCommittedReturn = async (token: TransitionToken) => {
    if (returnPrepared || !closeStillCurrent(token)) return;
    returnPrepared = true;
    const scrollRoot = libraryScrollRoot();
    if (scrollRoot) scrollRoot.scrollTop = returnScrollTop;
    if (!stored || !reversesShared) {
      await applyReturnFocus(token);
      return;
    }
    if (!applyReturnMarkers(findReturnTrigger(stored))) {
      const returnTrigger = await awaitVirtualReturnTrigger(
        token,
        () => findReturnTrigger(stored),
        scrollRoot,
        returnScrollTop,
      );
      if (!returnTrigger || !closeStillCurrent(token)) {
        await applyReturnFocus(token);
        return;
      }
      applyReturnMarkers(returnTrigger);
    }
    if (!closeStillCurrent(token)) return;
    await applyReturnFocus(token);
  };

  const descriptor = DETAIL_TRANSITION_DESCRIPTORS[input.kind];
  try {
    await transitionCodaView(
      async (token) => {
        if (!closeStillCurrent(token)) return;
        const commitResult = await input.update(Boolean(stored));
        outcome = commitOutcome(commitResult);
        if (!closeStillCurrent(token)) {
          pendingScrollTop = undefined;
          return;
        }
        if (closeCommitSucceeded(outcome)) {
          await prepareCommittedReturn(token);
          // WebKit can clobber focus onto body during snapshot teardown.
          void token.settled.then(() => reassertReturnFocus(token));
        }
      },
      reversesShared ? descriptor.closeKind : "page-back",
      true,
    );
    if (closeCommitSucceeded(outcome) && epoch === closeEpoch) {
      consumeReturnState(requestKey, input.targetKey, stored);
    } else {
      pendingScrollTop = undefined;
    }
    return outcome;
  } catch (cause) {
    if (closeCommitSucceeded(outcome) && epoch === closeEpoch) {
      consumeReturnState(requestKey, input.targetKey, stored);
    } else {
      pendingScrollTop = undefined;
    }
    throw cause;
  } finally {
    if (activeDomRestore === restoreReturn) {
      restoreReturn();
      activeDomRestore = () => {};
    }
  }
}

export function closeDetail(input: DetailCloseInput): Promise<RouteCommitOutcome> {
  const key = input.requestKey ?? `${input.kind}:${input.targetKey}:${input.identity}`;
  const active = closeRequests.get(key);
  if (active) return active;
  const request = performClose(input).finally(() => {
    if (closeRequests.get(key) === request) closeRequests.delete(key);
  });
  closeRequests.set(key, request);
  return request;
}

export function activateDetailDestination(
  kind: DetailTransitionKey,
  targetKey: string,
): void {
  const destinationKey = `${kind}:${targetKey}`;
  const tokenId = currentTransitionId();
  if (
    focusedDestinationKey === destinationKey &&
    focusedDestinationTokenId === tokenId
  ) {
    return;
  }
  const headingId = DETAIL_TRANSITION_DESCRIPTORS[kind].destinationHeadingId;
  scheduleFocus(
    `destination:${destinationKey}`,
    () => document.getElementById(headingId) ?? undefined,
    (focused) => {
      if (!focused || !isCurrentTransition(tokenId)) return;
      focusedDestinationKey = destinationKey;
      focusedDestinationTokenId = tokenId;
    },
    () => isCurrentTransition(tokenId),
  );
}

export function restoreDetailScroll(discardIfMissing = false): void {
  const scrollRoot = libraryScrollRoot();
  if (!scrollRoot) {
    if (discardIfMissing) pendingScrollTop = undefined;
    return;
  }
  const scrollTop = pendingScrollTop;
  pendingScrollTop = undefined;
  if (scrollTop !== undefined) scrollRoot.scrollTop = scrollTop;
}

function abortDetailNavigationWork(): void {
  closeEpoch += 1;
  cancelScheduledFocus();
  activeDomRestore();
  activeDomRestore = () => {};
  focusedDestinationKey = undefined;
  focusedDestinationTokenId = 0;
  pendingScrollTop = undefined;
}

export function cancelDetailNavigation(): Promise<void> {
  abortDetailNavigationWork();
  return settleInFlightCloses();
}

export function resetDetailNavigation(): void {
  abortDetailNavigationWork();
  closeRequests.clear();
  returnStateOrder.length = 0;
  returnStates.clear();
}

export function detailReturnStateCount(): number {
  return returnStateOrder.length;
}

export function clearDestinationFocus(): void {
  focusedDestinationKey = undefined;
  focusedDestinationTokenId = 0;
  cancelScheduledFocus();
}
