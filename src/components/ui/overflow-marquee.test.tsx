import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverflowMarquee } from "./overflow-marquee";

class ResizeObserverMock implements ResizeObserver {
  static callback: ResizeObserverCallback | undefined;

  constructor(callback: ResizeObserverCallback) {
    ResizeObserverMock.callback = callback;
  }

  disconnect() {}
  observe() {}
  unobserve() {}
}

describe("OverflowMarquee", () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    globalThis.ResizeObserver = ResizeObserverMock;
  });

  afterEach(() => {
    globalThis.ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  it("keeps an ellipsis at rest and only renders hover marquee text when the title overflows", () => {
    render(<OverflowMarquee text="A deliberately long release title" />);

    const viewport = screen.getByTestId("overflow-marquee");
    const restingText = screen.getByText("A deliberately long release title");
    Object.defineProperties(restingText, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 280 },
    });
    act(() => {
      ResizeObserverMock.callback?.([], {} as ResizeObserver);
    });

    expect(viewport).toHaveAttribute("data-overflowing", "true");
    expect(restingText).toHaveClass("truncate");
    expect(restingText).toHaveAttribute(
      "title",
      "A deliberately long release title",
    );
    expect(screen.getByTestId("overflow-marquee-track")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("does not add marquee duplication or a title when the text fits", () => {
    render(<OverflowMarquee text="Short title" />);

    const restingText = screen.getByText("Short title");
    Object.defineProperties(restingText, {
      clientWidth: { configurable: true, value: 120 },
      scrollWidth: { configurable: true, value: 120 },
    });
    act(() => {
      ResizeObserverMock.callback?.([], {} as ResizeObserver);
    });

    expect(screen.getByTestId("overflow-marquee")).not.toHaveAttribute(
      "data-overflowing",
    );
    expect(restingText).not.toHaveAttribute("title");
    expect(screen.queryByTestId("overflow-marquee-track"))
      .not.toBeInTheDocument();
  });
});
