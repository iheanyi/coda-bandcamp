import { afterEach, describe, expect, it } from "vitest";
import {
  createNavigationTransaction,
  createNavigationTransactionState,
  isLatestNavigationTransaction,
  MAX_NAVIGATION_IDENTIFIER_LENGTH,
  MAX_NAVIGATION_SCROLL_TOP,
  replaceNavigationTransaction,
  resolveNavigationReturnFocus,
  resolveNavigationReturnScrollTop,
  settleNavigationTransaction,
  type NavigationTransactionInput,
} from "./navigationTransaction";

const baseInput: NavigationTransactionInput = {
  routeKey: "album:soft-focus",
  intent: "forward",
  entrance: "page-forward",
  returnScrollTop: 312,
  destinationHeadingId: "album-detail-heading",
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("navigation transactions", () => {
  it("retains a connected keyboard source and bounded return position", () => {
    const source = document.createElement("button");
    source.textContent = "Open Soft Focus";
    document.body.append(source);
    source.focus();

    const state = replaceNavigationTransaction(
      createNavigationTransactionState(),
      { ...baseInput, sourceTrigger: source },
    );
    const transaction = state.active!;

    expect(resolveNavigationReturnFocus(transaction)).toEqual({
      kind: "source",
      target: source,
    });
    expect(resolveNavigationReturnScrollTop(transaction, 1_000)).toBe(312);
  });

  it("uses a deterministic connected fallback after the source unmounts", () => {
    const source = document.createElement("button");
    const fallback = document.createElement("button");
    document.body.append(source, fallback);
    const transaction = createNavigationTransaction(1, {
      ...baseInput,
      sourceTrigger: source,
    });

    source.remove();

    expect(resolveNavigationReturnFocus(transaction, fallback)).toEqual({
      kind: "fallback",
      target: fallback,
    });

    fallback.remove();
    expect(resolveNavigationReturnFocus(transaction, fallback)).toEqual({
      kind: "none",
      target: undefined,
    });
  });

  it("gives rapid replacements latest-wins identity and settlement", () => {
    const initial = createNavigationTransactionState();
    const firstState = replaceNavigationTransaction(initial, baseInput);
    const first = firstState.active!;
    const secondState = replaceNavigationTransaction(firstState, {
      ...baseInput,
      routeKey: "artist:night-archive",
      destinationHeadingId: "artist-detail-heading",
    });
    const second = secondState.active!;

    expect(first.identity).toBe(1);
    expect(second.identity).toBe(2);
    expect(isLatestNavigationTransaction(secondState, first.identity)).toBe(false);
    expect(isLatestNavigationTransaction(secondState, second.identity)).toBe(true);
    expect(settleNavigationTransaction(secondState, first.identity)).toBe(secondState);

    const settled = settleNavigationTransaction(secondState, second.identity);
    expect(settled).toEqual({ latestIdentity: 2 });
    expect(isLatestNavigationTransaction(settled, second.identity)).toBe(false);
  });

  it("keeps only bounded scalar coordination data", () => {
    const transaction = createNavigationTransaction(1, {
      ...baseInput,
      returnScrollTop: Number.POSITIVE_INFINITY,
      entrance: "shared-element",
      sharedElementOwner: "now-playing-artwork",
      serverPayload: { credentials: "not-navigation-state" },
      collection: ["not", "retained"],
    } as NavigationTransactionInput & {
      serverPayload: object;
      collection: string[];
    });

    expect(transaction.returnScrollTop).toBe(0);
    expect(transaction.entrance).toBe("shared-element");
    expect(transaction.sharedElementOwner).toBe("now-playing-artwork");
    expect(transaction).not.toHaveProperty("serverPayload");
    expect(transaction).not.toHaveProperty("collection");

    expect(createNavigationTransaction(2, {
      ...baseInput,
      returnScrollTop: MAX_NAVIGATION_SCROLL_TOP + 1,
    }).returnScrollTop).toBe(MAX_NAVIGATION_SCROLL_TOP);
    expect(createNavigationTransaction(3, {
      ...baseInput,
      returnScrollTop: -1,
    }).returnScrollTop).toBe(0);

    expect(() => createNavigationTransaction(4, {
      ...baseInput,
      routeKey: "x".repeat(MAX_NAVIGATION_IDENTIFIER_LENGTH + 1),
    })).toThrow(/bounded/);
    expect(() => createNavigationTransaction(5, {
      ...baseInput,
      destinationHeadingId: "bad\nheading",
    })).toThrow(/bounded/);
    expect(() => createNavigationTransaction(6, {
      ...baseInput,
      sharedElementOwner: "https://example.com/artwork",
    })).toThrow(/non-URL/);
  });
});
