import { afterEach, describe, expect, it, vi } from "vitest";
import { transitionCodaView } from "./viewTransitions";

const originalStartViewTransition = Object.getOwnPropertyDescriptor(
  document,
  "startViewTransition",
);
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  document.documentElement.classList.remove(
    "coda-view-transitioning",
    "coda-view-transitions-supported",
    "coda-transition--now-playing",
    "coda-transition--page-forward",
    "coda-transition--page-back",
    "coda-transition--page-crossfade",
  );
  if (originalStartViewTransition) {
    Object.defineProperty(
      document,
      "startViewTransition",
      originalStartViewTransition,
    );
  } else {
    Reflect.deleteProperty(document, "startViewTransition");
  }
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("transitionCodaView", () => {
  it("updates immediately when the View Transitions API is unavailable", async () => {
    const update = vi.fn();

    await transitionCodaView(update, "page-forward");

    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement).not.toHaveClass("coda-view-transitioning");
  });

  it("exposes the transition direction while the browser captures the new page", async () => {
    const capturedClasses: string[] = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void) => {
        capturedClasses.push(document.documentElement.className);
        update();
        return { finished: Promise.resolve() };
      }),
    });

    await transitionCodaView(vi.fn(), "page-back");

    expect(capturedClasses[0]).toContain("coda-transition--page-back");
    expect(document.documentElement).toHaveClass("coda-view-transitions-supported");
    expect(document.documentElement).not.toHaveClass("coda-transition--page-back");
  });

  it("bypasses automatic motion when reduced motion is requested", async () => {
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    const update = vi.fn();

    await transitionCodaView(update, "page-crossfade");

    expect(update).toHaveBeenCalledOnce();
    expect(startViewTransition).not.toHaveBeenCalled();
  });
});
