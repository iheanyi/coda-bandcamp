import { act, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createPlaybackClock } from "@/playbackClock";
import { parseRadioShowIdParam } from "@/routing/routeContracts";

import {
  RadioRouteNavigationProvider,
  type RadioRouteNavigationAdapter,
} from "./RadioRouteNavigationContext";
import type {
  RadioIndexScreenProps,
  RadioSeriesScreenProps,
} from "./RadioArchiveScreen";
import { useRadioRouteNavigation } from "./RadioRouteNavigationState";
import type {
  RadioArchiveScreenProps,
  RadioOpenShowRequest,
} from "./radioScreenTypes";
import type { RadioShowScreenProps } from "./RadioShowScreen";
import { RadioViewCompatibility } from "./RadioViewCompatibility";

type RadioTransition = NonNullable<
  ComponentProps<typeof RadioRouteNavigationProvider>["transition"]
>;

type PendingTransition = Readonly<{
  kind: Parameters<RadioTransition>[1];
  promise: Promise<void>;
  resolve: () => void;
}>;

type PendingTransitions = {
  pending: PendingTransition[];
};

const transitions: PendingTransitions = { pending: [] };

const transition = vi.fn<RadioTransition>(
  (update: () => void | Promise<void>, kind) => {
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    const promise = Promise.resolve()
      .then(update)
      .then(() => completion);
    transitions.pending.push({
      kind,
      promise,
      resolve: resolveCompletion,
    });
    return promise;
  },
);

function CompatibilityArchiveScreen({
  onOpenShow,
  returningArtworkId,
}: RadioArchiveScreenProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const artworkRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  const secondTriggerRef = useRef<HTMLButtonElement>(null);
  const secondArtworkRef = useRef<HTMLSpanElement>(null);
  const secondTitleRef = useRef<HTMLSpanElement>(null);
  return (
    <>
        <button
          aria-label="Open compatibility show"
          data-radio-show-navigation-slot="archive:artwork"
          data-radio-show-open="977"
          onClick={() => {
            const trigger = triggerRef.current;
            if (!trigger) return;
            void onOpenShow({
              returnScrollTop: 91,
              showId: parseRadioShowIdParam(977),
              sourceArtwork: artworkRef.current ?? undefined,
              sourceTitle: titleRef.current ?? undefined,
              sourceTrigger: trigger,
            });
          }}
          ref={triggerRef}
          type="button"
        >
          <span ref={artworkRef}>Artwork</span>
          <span ref={titleRef}>Open compatibility show</span>
        </button>
        <button
          aria-label="Open second compatibility show"
          data-radio-show-navigation-slot="archive:artwork"
          data-radio-show-open="978"
          onClick={() => {
            const trigger = secondTriggerRef.current;
            if (!trigger) return;
            void onOpenShow({
              returnScrollTop: 92,
              showId: parseRadioShowIdParam(978),
              sourceArtwork: secondArtworkRef.current ?? undefined,
              sourceTitle: secondTitleRef.current ?? undefined,
              sourceTrigger: trigger,
            });
          }}
          ref={secondTriggerRef}
          type="button"
        >
          <span ref={secondArtworkRef}>Second artwork</span>
          <span ref={secondTitleRef}>Open second compatibility show</span>
        </button>
        <output data-testid="compat-returning">
          {returningArtworkId ?? "none"}
        </output>
    </>
  );
}

function CompatibilityIndexScreen(props: RadioIndexScreenProps) {
  return <CompatibilityArchiveScreen {...props} />;
}

function CompatibilitySeriesScreen({
  seriesId: _seriesId,
  ...props
}: RadioSeriesScreenProps) {
  return <CompatibilityArchiveScreen {...props} />;
}

function CompatibilityShowScreen({ onBack }: RadioShowScreenProps) {
  return (
    <button onClick={onBack} type="button">
      Close compatibility show
    </button>
  );
}

const showId = parseRadioShowIdParam(977);
const secondShowId = parseRadioShowIdParam(978);

function openRequest(
  trigger: HTMLElement,
  artwork: HTMLElement,
  title: HTMLElement,
  returnScrollTop = 44,
): RadioOpenShowRequest {
  return {
    returnScrollTop,
    showId,
    sourceArtwork: artwork,
    sourceTitle: title,
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
  const artworkRef = useRef<HTMLSpanElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);
  return (
    <>
      <button
        aria-label="Open provider show"
        data-radio-show-navigation-slot="provider:artwork"
        data-radio-show-open={showId}
        onClick={() => {
          if (!triggerRef.current || !artworkRef.current || !titleRef.current) {
            return;
          }
          void navigation.openShow(
            openRequest(
              triggerRef.current,
              artworkRef.current,
              titleRef.current,
              returnScrollTop,
            ),
          );
        }}
        ref={triggerRef}
        type="button"
      >
        <span ref={artworkRef}>Provider artwork</span>
        <span ref={titleRef}>Open provider show</span>
      </button>
      <button onClick={() => void navigation.closeShow(showId)} type="button">
        Close provider show
      </button>
      <output data-testid="provider-returning">
        {navigation.returningArtworkId ?? "none"}
      </output>
    </>
  );
}

function DistinctProviderHarness() {
  const navigation = useRadioRouteNavigation();
  const firstTriggerRef = useRef<HTMLButtonElement>(null);
  const firstArtworkRef = useRef<HTMLSpanElement>(null);
  const firstTitleRef = useRef<HTMLSpanElement>(null);
  const secondTriggerRef = useRef<HTMLButtonElement>(null);
  const secondArtworkRef = useRef<HTMLSpanElement>(null);
  const secondTitleRef = useRef<HTMLSpanElement>(null);
  const open = (
    requestShowId: typeof showId,
    trigger: HTMLButtonElement | null,
    artwork: HTMLSpanElement | null,
    title: HTMLSpanElement | null,
  ) => {
    if (!trigger || !artwork || !title) return;
    void navigation.openShow({
      returnScrollTop: 44,
      showId: requestShowId,
      sourceArtwork: artwork,
      sourceTitle: title,
      sourceTrigger: trigger,
    });
  };

  return (
    <>
      <button
        aria-label="Open first provider show"
        onClick={() =>
          open(
            showId,
            firstTriggerRef.current,
            firstArtworkRef.current,
            firstTitleRef.current,
          )
        }
        ref={firstTriggerRef}
        type="button"
      >
        <span ref={firstArtworkRef}>First provider artwork</span>
        <span ref={firstTitleRef}>Open first provider show</span>
      </button>
      <button
        aria-label="Open second provider show"
        onClick={() =>
          open(
            secondShowId,
            secondTriggerRef.current,
            secondArtworkRef.current,
            secondTitleRef.current,
          )
        }
        ref={secondTriggerRef}
        type="button"
      >
        <span ref={secondArtworkRef}>Second provider artwork</span>
        <span ref={secondTitleRef}>Open second provider show</span>
      </button>
    </>
  );
}

function createAdapter(): RadioRouteNavigationAdapter {
  return {
    goBack: vi.fn().mockResolvedValue(undefined),
    goToIndex: vi.fn().mockResolvedValue(undefined),
    goToSeries: vi.fn().mockResolvedValue(undefined),
    goToShow: vi.fn().mockResolvedValue(undefined),
  };
}

async function settleTransition(index: number) {
  const pendingTransition = transitions.pending[index];
  if (!pendingTransition) {
    throw new Error(`Expected pending Radio transition ${index}`);
  }
  await act(async () => {
    pendingTransition.resolve();
    await pendingTransition.promise;
  });
}

const compatibilityPlaybackProps = {
  favoriteShowIds: new Set<number>(),
  onPlay: vi.fn(),
  onPlayAt: vi.fn(),
  onQueue: vi.fn(),
  onToggleFavorite: vi.fn(),
  onTogglePlayback: vi.fn(),
  playbackClock: createPlaybackClock(0),
  playing: false,
};

beforeEach(() => {
  transitions.pending.length = 0;
});

describe("Radio transition race cleanup", () => {
  it("keeps exactly one provider source lease across distinct-show activations", async () => {
    render(
      <RadioRouteNavigationProvider
        adapter={createAdapter()}
        transition={transition}
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
        transition={transition}
      >
        <ProviderHarness />
      </RadioRouteNavigationProvider>,
    );

    const open = screen.getByRole("button", { name: "Open provider show" });
    fireEvent.click(open);
    fireEvent.click(open);

    const artwork = screen.getByText("Provider artwork");
    const title = screen.getByText("Open provider show");
    expect(artwork).toHaveAttribute(
      "data-coda-radio-artwork-source",
      String(showId),
    );
    expect(title).toHaveAttribute(
      "data-coda-radio-title-source",
      String(showId),
    );

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
        transition={transition}
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
    expect(screen.getByTestId("provider-returning")).toHaveTextContent("977");

    fireEvent.click(open);
    await settleTransition(2);
    fireEvent.click(close);
    await act(async () => Promise.resolve());
    expect(screen.getByTestId("provider-returning")).toHaveTextContent("977");

    await settleTransition(1);
    expect(screen.getByTestId("provider-returning")).toHaveTextContent("977");

    await settleTransition(3);
    expect(screen.getByTestId("provider-returning")).toHaveTextContent("none");
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
          transition={transition}
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

  it("keeps compatibility source markers leased across overlapping opens", async () => {
    render(
      <RadioViewCompatibility
        {...compatibilityPlaybackProps}
        IndexScreen={CompatibilityIndexScreen}
        onRequestedShowChange={vi.fn()}
        onSelectSeries={vi.fn()}
        SeriesScreen={CompatibilitySeriesScreen}
        ShowScreen={CompatibilityShowScreen}
        transition={transition}
      />,
    );

    const open = screen.getByRole("button", {
      name: "Open compatibility show",
    });
    fireEvent.click(open);
    fireEvent.click(open);

    const artwork = screen.getByText("Artwork");
    const title = screen.getByText("Open compatibility show");
    expect(artwork).toHaveAttribute(
      "data-coda-radio-artwork-source",
      String(showId),
    );
    expect(title).toHaveAttribute(
      "data-coda-radio-title-source",
      String(showId),
    );

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

  it("keeps exactly one compatibility source lease across distinct-show activations", async () => {
    render(
      <RadioViewCompatibility
        {...compatibilityPlaybackProps}
        IndexScreen={CompatibilityIndexScreen}
        onRequestedShowChange={vi.fn()}
        onSelectSeries={vi.fn()}
        SeriesScreen={CompatibilitySeriesScreen}
        ShowScreen={CompatibilityShowScreen}
        transition={transition}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open compatibility show" }),
    );
    const firstArtwork = screen.getByText("Artwork");
    const firstTitle = screen.getByText("Open compatibility show");
    expect(firstArtwork).toHaveAttribute(
      "data-coda-radio-artwork-source",
      String(showId),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open second compatibility show",
      }),
    );
    const secondArtwork = screen.getByText("Second artwork");
    const secondTitle = screen.getByText("Open second compatibility show");
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

  it("does not let an older compatibility close clear a newer same-show return", async () => {
    function ControlledCompatibility() {
      const [requestedShowId, setRequestedShowId] = useState<number>();
      return (
        <RadioViewCompatibility
          {...compatibilityPlaybackProps}
          IndexScreen={CompatibilityIndexScreen}
          onRequestedShowChange={setRequestedShowId}
          onSelectSeries={vi.fn()}
          requestedShowId={requestedShowId}
          SeriesScreen={CompatibilitySeriesScreen}
          ShowScreen={CompatibilityShowScreen}
          transition={transition}
        />
      );
    }

    render(<ControlledCompatibility />);
    fireEvent.click(
      screen.getByRole("button", { name: "Open compatibility show" }),
    );
    await screen.findByRole("button", { name: "Close compatibility show" });
    await settleTransition(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Close compatibility show" }),
    );
    await screen.findByRole("button", { name: "Open compatibility show" });
    expect(screen.getByTestId("compat-returning")).toHaveTextContent("977");

    fireEvent.click(
      screen.getByRole("button", { name: "Open compatibility show" }),
    );
    await screen.findByRole("button", { name: "Close compatibility show" });
    await settleTransition(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Close compatibility show" }),
    );
    await screen.findByRole("button", { name: "Open compatibility show" });
    expect(screen.getByTestId("compat-returning")).toHaveTextContent("977");

    await settleTransition(1);
    expect(screen.getByTestId("compat-returning")).toHaveTextContent("977");

    await settleTransition(3);
    expect(screen.getByTestId("compat-returning")).toHaveTextContent("none");
  });
});
