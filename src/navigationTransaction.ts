export type NavigationIntent = "forward" | "back" | "crossfade";
export type NavigationEntrance =
  | "none"
  | "page-forward"
  | "shared-element";

export const MAX_NAVIGATION_IDENTIFIER_LENGTH = 128;
export const MAX_NAVIGATION_SCROLL_TOP = 10_000_000;

export type NavigationTransactionInput = Readonly<{
  routeKey: string;
  intent: NavigationIntent;
  entrance: NavigationEntrance;
  sourceTrigger?: HTMLElement | null;
  returnScrollTop?: number;
  destinationHeadingId: string;
  sharedElementOwner?: string | null;
}>;

export type NavigationTransaction = Readonly<{
  identity: number;
  routeKey: string;
  intent: NavigationIntent;
  entrance: NavigationEntrance;
  sourceTrigger?: HTMLElement;
  returnScrollTop: number;
  destinationHeadingId: string;
  sharedElementOwner?: string;
}>;

export type NavigationTransactionState = Readonly<{
  latestIdentity: number;
  active?: NavigationTransaction;
}>;

export type NavigationReturnFocus =
  | Readonly<{
      kind: "source" | "fallback";
      target: HTMLElement;
    }>
  | Readonly<{
      kind: "none";
      target: undefined;
    }>;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const URL_SCHEME = /^[a-z][a-z\d+.-]*:\/\//iu;

function boundedIdentifier(value: string, label: string): string {
  if (
    value.length === 0 ||
    value.length > MAX_NAVIGATION_IDENTIFIER_LENGTH ||
    value.trim() !== value ||
    CONTROL_CHARACTERS.test(value) ||
    URL_SCHEME.test(value)
  ) {
    throw new TypeError(`${label} must be a bounded non-URL identifier`);
  }
  return value;
}

function boundedScrollTop(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(
    MAX_NAVIGATION_SCROLL_TOP,
    Math.max(0, value),
  );
}

export function createNavigationTransactionState(): NavigationTransactionState {
  return Object.freeze({ latestIdentity: 0 });
}

export function createNavigationTransaction(
  identity: number,
  input: NavigationTransactionInput,
): NavigationTransaction {
  if (!Number.isSafeInteger(identity) || identity < 1) {
    throw new TypeError("navigation transaction identity must be a positive safe integer");
  }

  return Object.freeze({
    identity,
    routeKey: boundedIdentifier(input.routeKey, "routeKey"),
    intent: input.intent,
    entrance: input.entrance,
    ...(input.sourceTrigger ? { sourceTrigger: input.sourceTrigger } : {}),
    returnScrollTop: boundedScrollTop(input.returnScrollTop),
    destinationHeadingId: boundedIdentifier(
      input.destinationHeadingId,
      "destinationHeadingId",
    ),
    ...(input.sharedElementOwner
      ? {
          sharedElementOwner: boundedIdentifier(
            input.sharedElementOwner,
            "sharedElementOwner",
          ),
        }
      : {}),
  });
}

export function replaceNavigationTransaction(
  state: NavigationTransactionState,
  input: NavigationTransactionInput,
): NavigationTransactionState {
  if (!Number.isSafeInteger(state.latestIdentity) || state.latestIdentity < 0) {
    throw new TypeError("navigation transaction state has an invalid identity");
  }
  if (state.latestIdentity === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("navigation transaction identity limit reached");
  }

  const latestIdentity = state.latestIdentity + 1;
  return Object.freeze({
    latestIdentity,
    active: createNavigationTransaction(latestIdentity, input),
  });
}

export function isLatestNavigationTransaction(
  state: NavigationTransactionState,
  identity: number,
): boolean {
  return state.active?.identity === identity;
}

export function settleNavigationTransaction(
  state: NavigationTransactionState,
  identity: number,
): NavigationTransactionState {
  if (!isLatestNavigationTransaction(state, identity)) return state;
  return Object.freeze({ latestIdentity: state.latestIdentity });
}

export function resolveNavigationReturnFocus(
  transaction: NavigationTransaction,
  fallback?: HTMLElement | null,
): NavigationReturnFocus {
  if (transaction.sourceTrigger?.isConnected) {
    return Object.freeze({
      kind: "source" as const,
      target: transaction.sourceTrigger,
    });
  }
  if (fallback?.isConnected) {
    return Object.freeze({
      kind: "fallback" as const,
      target: fallback,
    });
  }
  return Object.freeze({
    kind: "none" as const,
    target: undefined,
  });
}

export function resolveNavigationReturnScrollTop(
  transaction: NavigationTransaction,
  maximumScrollTop = MAX_NAVIGATION_SCROLL_TOP,
): number {
  return Math.min(
    transaction.returnScrollTop,
    boundedScrollTop(maximumScrollTop),
  );
}
