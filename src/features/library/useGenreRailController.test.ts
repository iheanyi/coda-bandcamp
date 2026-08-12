import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useGenreRailController } from "./useGenreRailController";

function genreRail({
  clientWidth = 200,
  scrollLeft = 0,
  scrollWidth = 600,
}: Readonly<{
  clientWidth?: number;
  scrollLeft?: number;
  scrollWidth?: number;
}> = {}) {
  const rail = document.createElement("nav");
  Object.defineProperties(rail, {
    clientWidth: { configurable: true, value: clientWidth },
    scrollLeft: { configurable: true, value: scrollLeft, writable: true },
    scrollWidth: { configurable: true, value: scrollWidth },
  });
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    if (typeof options.left === "number") rail.scrollLeft = options.left;
  });
  Object.defineProperty(rail, "scrollTo", {
    configurable: true,
    value: scrollTo,
  });
  return { rail, scrollTo };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("genre rail controller", () => {
  it("derives both overflow affordances from the current rail geometry", () => {
    const { result } = renderHook(() =>
      useGenreRailController({ genre: "Ambient", genres: ["Ambient"] }),
    );
    const { rail } = genreRail();

    act(() => result.current.onScroll(rail));
    expect(result.current.edges).toEqual({ start: false, end: true });

    rail.scrollLeft = 175;
    act(() => result.current.onScroll(rail));
    expect(result.current.edges).toEqual({ start: true, end: true });

    rail.scrollLeft = 400;
    act(() => result.current.onScroll(rail));
    expect(result.current.edges).toEqual({ start: true, end: false });
  });

  it("scrolls a bounded page and respects reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      addEventListener: vi.fn(),
      addListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      removeEventListener: vi.fn(),
      removeListener: vi.fn(),
    });
    const { result } = renderHook(() =>
      useGenreRailController({ genre: "Ambient", genres: ["Ambient"] }),
    );
    const { rail, scrollTo } = genreRail({ scrollLeft: 40 });
    result.current.ref.current = rail;

    act(() => result.current.scroll(1));

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", left: 200 });
  });

  it("resets All to the leading chip and resynchronizes on resize", () => {
    const { result, rerender } = renderHook(
      ({ genre, genres }) => useGenreRailController({ genre, genres }),
      {
        initialProps: {
          genre: "Ambient",
          genres: ["Ambient"],
        },
      },
    );
    const { rail, scrollTo } = genreRail({ scrollLeft: 220 });
    result.current.ref.current = rail;

    rerender({ genre: "All", genres: ["Ambient", "Jazz"] });

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", left: 0 });
    expect(rail.scrollLeft).toBe(0);
    expect(result.current.edges).toEqual({ start: false, end: true });

    rail.scrollLeft = 400;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(result.current.edges).toEqual({ start: true, end: false });
  });
});
