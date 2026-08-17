import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRadioShowIdParam } from "@/routing/routeContracts";
import { installDocumentViewTransitionHarness } from "@/test/documentViewTransitionHarness";

import {
  RadioRouteNavigationProvider,
  type RadioRouteNavigationAdapter,
} from "./RadioRouteNavigationContext";
import { useRadioRouteNavigation } from "./RadioRouteNavigationState";
import type { RadioOpenShowRequest } from "./radioScreenTypes";

let transitionHarness: ReturnType<
  typeof installDocumentViewTransitionHarness
>;

const showId = parseRadioShowIdParam(977);
const secondShowId = parseRadioShowIdParam(978);
const RENDERED_RADIO_COMMIT = {
  locationKey: "radio-rendered",
  outcome: "rendered" as const,
};

function openRequest(
  trigger: HTMLElement,
  returnScrollTop = 44,
): RadioOpenShowRequest {
  return {
    returnScrollTop,
    sharedIdentityAvailable: true,
    showId,
    sourceTrigger: trigger,
  };
}

function ProviderHarness({
  returnScrollTop = 44,
}: {
  returnScrollTop?: number;
}) {
  const navigation = useRadioRouteNavigation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        aria-label="Open provider show"
        data-radio-show-navigation-slot="provider:artwork"
        data-radio-show-open={showId}
        onClick={() => {
          if (!triggerRef.current) return;
          void navigation.openShow(openRequest(triggerRef.current, returnScrollTop));
        }}
        ref={triggerRef}
        type="button"
      >
        <span data-radio-show-artwork={showId}>
          Provider artwork
        </span>
        <span data-radio-show-title={showId}>
          <span data-slot="overflow-marquee-text">
            Open provider show
          </span>
        </span>
      </button>
      <button onClick={() => void navigation.closeShow(showId)} type="button">
        Close provider show
      </button>
    </>
  );
}

function DistinctProviderHarness() {
  const navigation = useRadioRouteNavigation();
  const firstTriggerRef = useRef<HTMLButtonElement>(null);
  const secondTriggerRef = useRef<HTMLButtonElement>(null);
  const open = (
    requestShowId: typeof showId,
    trigger: HTMLButtonElement | null,
  ) => {
    if (!trigger) return;
    void navigation.openShow({
      returnScrollTop: 44,
      sharedIdentityAvailable: true,
      showId: requestShowId,
      sourceTrigger: trigger,
    });
  };

  return (
    <>
      <button
        aria-label="Open first provider show"
        data-radio-show-open={showId}
        onClick={() =>
          open(showId, firstTriggerRef.current)
        }
        ref={firstTriggerRef}
        type="button"
      >
        <span data-radio-show-artwork={showId}>
          First provider artwork
        </span>
        <span data-radio-show-title={showId}>
          <span data-slot="overflow-marquee-text">
            Open first provider show
          </span>
        </span>
      </button>
      <button
        aria-label="Open second provider show"
        data-radio-show-open={secondShowId}
        onClick={() =>
          open(secondShowId, secondTriggerRef.current)
        }
        ref={secondTriggerRef}
        type="button"
      >
        <span data-radio-show-artwork={secondShowId}>
          Second provider artwork
        </span>
        <span data-radio-show-title={secondShowId}>
          <span data-slot="overflow-marquee-text">
            Open second provider show
          </span>
        </span>
      </button>
    </>
  );
}

function createAdapter(): RadioRouteNavigationAdapter {
  return {
    goBack: vi.fn().mockResolvedValue(RENDERED_RADIO_COMMIT),
    goToIndex: vi.fn().mockResolvedValue(RENDERED_RADIO_COMMIT),
    goToSeries: vi.fn().mockResolvedValue(RENDERED_RADIO_COMMIT),
    goToShow: vi.fn().mockResolvedValue(RENDERED_RADIO_COMMIT),
  };
}

async function settleTransition(index: number) {
  const pendingTransition = transitionHarness.transitions[index];
  if (!pendingTransition) {
    throw new Error(`Expected pending Radio transition ${index}`);
  }
  await act(async () => {
    pendingTransition.resolve();
    await pendingTransition.finished;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transitionHarness = installDocumentViewTransitionHarness();
});

afterEach(() => {
  transitionHarness.restore();
});

describe("Radio transition race cleanup", () => {
  it("keeps the coordinator active through Strict Mode effect replay", async () => {
    const adapter = createAdapter();

    render(
      <StrictMode>
        <RadioRouteNavigationProvider adapter={adapter}>
          <ProviderHarness />
        </RadioRouteNavigationProvider>
      </StrictMode>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open provider show" }),
    );

    await waitFor(() => expect(adapter.goToShow).toHaveBeenCalledWith(showId));
    await settleTransition(0);
  });

  it("keeps exactly one provider source lease across distinct-show activations", async () => {
    render(
      <RadioRouteNavigationProvider
        adapter={createAdapter()}
      >
        <DistinctProviderHarness />
      </RadioRouteNavigationProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open first provider show" }),
    );
    const firstArtwork = screen.getByText("First provider artwork");
    const firstTitle = screen.getByText("Open first provider show");
    expect(firstArtwork).toHaveAttribute(
      "data-coda-radio-artwork-source",
      String(showId),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open second provider show" }),
    );
    const secondArtwork = screen.getByText("Second provider artwork");
    const secondTitle = screen.getByText("Open second provider show");
    expect(firstArtwork).not.toHaveAttribute(
      "data-coda-radio-artwork-source",
    );
    expect(firstTitle).not.toHaveAttribute("data-coda-radio-title-source");
    expect(secondArtwork).toHaveAttribute(
      "data-coda-radio-artwork-source",
      String(secondShowId),
    );
    expect(secondTitle).toHaveAttribute(
      "data-coda-radio-title-source",
      String(secondShowId),
    );

    await settleTransition(0);
    expect(secondArtwork).toHaveAttribute(
      "data-coda-radio-artwork-source",
      String(secondShowId),
    );
    expect(secondTitle).toHaveAttribute(
      "data-coda-radio-title-source",
      String(secondShowId),
    );

    await settleTransition(1);
    expect(secondArtwork).not.toHaveAttribute(
      "data-coda-radio-artwork-source",
    );
    expect(secondTitle).not.toHaveAttribute("data-coda-radio-title-source");
  });

  it("keeps provider source markers leased when the older transition settles first", async () => {
    render(
      <RadioRouteNavigationProvider
        adapter={createAdapter()}
      >
        <ProviderHarness />
      </RadioRouteNavigationProvider>,
    );

    const open = screen.getByRole("button", { name: "Open provider show" });
    await act(() => {
      fireEvent.click(open);
      fireEvent.click(open);
    });

    const artwork = screen.getByText("Provider artwork");
    const title = screen.getByText("Open provider show");
    await vi.waitFor(() => {
      expect(artwork).toHaveAttribute(
        "data-coda-radio-artwork-source",
        String(showId),
      );
      expect(title).toHaveAttribute(
        "data-coda-radio-title-source",
        String(showId),
      );
    });

    await settleTransition(0);
    expect(artwork).toHaveAttribute(
      "data-coda-radio-artwork-source",
      String(showId),
    );
    expect(title).toHaveAttribute(
      "data-coda-radio-title-source",
      String(showId),
    );

    await settleTransition(1);
    expect(artwork).not.toHaveAttribute("data-coda-radio-artwork-source");
    expect(title).not.toHaveAttribute("data-coda-radio-title-source");
  });

  it("does not let an older provider close clear a newer same-show return", async () => {
    render(
      <RadioRouteNavigationProvider
        adapter={createAdapter()}
      >
        <ProviderHarness />
      </RadioRouteNavigationProvider>,
    );

    const open = screen.getByRole("button", { name: "Open provider show" });
    const close = screen.getByRole("button", {
      name: "Close provider show",
    });
    fireEvent.click(open);
    await settleTransition(0);

    fireEvent.click(close);
    await act(async () => Promise.resolve());
    const artwork = screen.getByText("Provider artwork");
    const title = screen.getByText("Open provider show");
    await vi.waitFor(() => {
      expect(artwork).toHaveAttribute(
        "data-coda-radio-artwork-return",
        String(showId),
      );
      expect(title).toHaveAttribute(
        "data-coda-radio-title-return",
        String(showId),
      );
    });

    fireEvent.click(open);
    expect(artwork).not.toHaveAttribute("data-coda-radio-artwork-return");
    expect(title).not.toHaveAttribute("data-coda-radio-title-return");
    await settleTransition(2);
    fireEvent.click(close);
    await act(async () => Promise.resolve());
    expect(artwork).toHaveAttribute(
      "data-coda-radio-artwork-return",
      String(showId),
    );
    expect(title).toHaveAttribute(
      "data-coda-radio-title-return",
      String(showId),
    );

    await settleTransition(1);
    expect(artwork).toHaveAttribute(
      "data-coda-radio-artwork-return",
      String(showId),
    );
    expect(title).toHaveAttribute(
      "data-coda-radio-title-return",
      String(showId),
    );

    await settleTransition(3);
    expect(artwork).not.toHaveAttribute("data-coda-radio-artwork-return");
    expect(title).not.toHaveAttribute("data-coda-radio-title-return");
  });

  it("waits for the exact virtualized archive slot, paints it, and restores scroll and focus", async () => {
    const scrollTop = 4_800;
    let replacement: HTMLButtonElement | undefined;
    let replacementArtwork: HTMLSpanElement | undefined;
    let replacementTitle: HTMLSpanElement | undefined;
    let replacementCard: HTMLElement | undefined;
    const adapter = createAdapter();
    vi.mocked(adapter.goBack).mockImplementation(async () => {
      window.requestAnimationFrame(() => {
        const scrollRoot = document.querySelector<HTMLElement>(
          "[data-coda-library-scroll]",
        );
        const card = document.createElement("article");
        card.style.setProperty("content-visibility", "auto");
        const artwork = document.createElement("span");
        artwork.dataset.radioShowArtwork = String(showId);
        const titleRoot = document.createElement("h3");
        titleRoot.dataset.radioShowTitle = String(showId);
        const title = document.createElement("span");
        title.dataset.slot = "overflow-marquee-text";
        title.textContent = "Deferred show title";
        titleRoot.append(title);
        const trigger = document.createElement("button");
        trigger.dataset.radioShowOpen = String(showId);
        trigger.dataset.radioShowNavigationSlot = "provider:artwork";
        trigger.textContent = "Deferred exact show trigger";
        card.append(artwork, titleRoot, trigger);
        scrollRoot?.append(card);
        replacement = trigger;
        replacementArtwork = artwork;
        replacementTitle = title;
        replacementCard = card;
      });
      return RENDERED_RADIO_COMMIT;
    });

    render(
      <div data-coda-library-scroll>
        <button
          data-radio-show-navigation-slot="wrong-slot"
          data-radio-show-open={showId}
          type="button"
        >
          Same-show decoy
        </button>
        <RadioRouteNavigationProvider
          adapter={adapter}
        >
          <ProviderHarness returnScrollTop={scrollTop} />
        </RadioRouteNavigationProvider>
      </div>,
    );

    const source = screen.getByRole("button", { name: "Open provider show" });
    fireEvent.click(source);
    await settleTransition(0);
    source.remove();
    const scrollRoot = document.querySelector<HTMLElement>(
      "[data-coda-library-scroll]",
    );
    if (scrollRoot) scrollRoot.scrollTop = 0;

    fireEvent.click(
      screen.getByRole("button", { name: "Close provider show" }),
    );

    await vi.waitFor(() => {
      expect(replacementArtwork).toHaveAttribute(
        "data-coda-radio-artwork-return",
        String(showId),
      );
      expect(replacementTitle).toHaveAttribute(
        "data-coda-radio-title-return",
        String(showId),
      );
    });
    expect(scrollRoot?.scrollTop).toBe(scrollTop);
    expect(replacementCard?.style.getPropertyValue("content-visibility")).toBe(
      "visible",
    );
    expect(
      screen.getByRole("button", { name: "Same-show decoy" }),
    ).not.toHaveFocus();

    await settleTransition(1);

    expect(replacement).toHaveFocus();
    expect(replacementArtwork).not.toHaveAttribute(
      "data-coda-radio-artwork-return",
    );
    expect(replacementTitle).not.toHaveAttribute(
      "data-coda-radio-title-return",
    );
    expect(replacementCard?.style.getPropertyValue("content-visibility")).toBe(
      "auto",
    );
  });

  it("coalesces rapid Radio Back requests into one close transaction", async () => {
    const adapter = createAdapter();
    render(
      <RadioRouteNavigationProvider
        adapter={adapter}
      >
        <ProviderHarness />
      </RadioRouteNavigationProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open provider show" }));
    await settleTransition(0);

    const close = screen.getByRole("button", {
      name: "Close provider show",
    });
    fireEvent.click(close);
    fireEvent.click(close);
    await act(async () => Promise.resolve());

    expect(transitionHarness.transitions.map(({ kind }) => kind)).toEqual([
      "radio-detail",
      "radio-detail-close",
    ]);
    expect(adapter.goBack).toHaveBeenCalledOnce();

    await settleTransition(1);
  });
});
