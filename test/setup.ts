import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterAll, afterEach, vi } from "vitest";

afterEach(() => cleanup());

// @tanstack/virtual-core debounces its "scrolling stopped" notification for
// 150ms (isScrollingResetDelay) with window.setTimeout, and its scroll
// observer cleanup removes event listeners without clearing that pending
// timer. A scroll near the end of a file's last test would otherwise fire the
// timer after Vitest tears down the jsdom window, crashing the run with an
// unhandled "window is not defined" ReferenceError. Components are already
// unmounted here, so waiting out the debounce lets it fire as a no-op while
// the window still exists.
// Only files that dispatch a scroll can leave this debounce pending. Pure
// utility and unrelated component tests should not pay a fixed teardown delay.
let observedScroll = false;
function recordScroll() {
  observedScroll = true;
}
window.addEventListener("scroll", recordScroll, true);

afterAll(async () => {
  window.removeEventListener("scroll", recordScroll, true);
  if (observedScroll) {
    await new Promise((resolve) => setTimeout(resolve, 175));
  }
});

// Coverage instrumentation can push otherwise immediate React effects beyond
// Testing Library's one-second default on the 25,000-item stress fixtures.
// This is only a ceiling; successful queries still resolve as soon as they render.
configure({ asyncUtilTimeout: 5_000 });

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  value: vi.fn().mockResolvedValue(undefined),
});

Object.defineProperty(HTMLMediaElement.prototype, "pause", {
  configurable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  configurable: true,
  value: vi.fn(() => null),
});

if (!window.PointerEvent) {
  class PointerEventShim extends MouseEvent {
    pointerId: number;
    width: number;
    height: number;
    pressure: number;
    tangentialPressure: number;
    tiltX: number;
    tiltY: number;
    twist: number;
    pointerType: string;
    isPrimary: boolean;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.width = init.width ?? 1;
      this.height = init.height ?? 1;
      this.pressure = init.pressure ?? 0;
      this.tangentialPressure = init.tangentialPressure ?? 0;
      this.tiltX = init.tiltX ?? 0;
      this.tiltY = init.tiltY ?? 0;
      this.twist = init.twist ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }

  Object.defineProperty(window, "PointerEvent", {
    configurable: true,
    value: PointerEventShim,
  });
}

if (!HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: () => false,
  });
}

if (!HTMLElement.prototype.setPointerCapture) {
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: () => undefined,
  });
}

if (!HTMLElement.prototype.releasePointerCapture) {
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: () => undefined,
  });
}

if (!window.ResizeObserver) {
  class ResizeObserverShim implements ResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      const contentRect = target.getBoundingClientRect();
      const entry: ResizeObserverEntry = {
        target,
        contentRect,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      };
      this.callback([entry], this);
    }
    unobserve(_target: Element) {}
    disconnect() {}
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverShim,
  });
}

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

const supportsElementGeometry = "getBoundingClientRect" in HTMLElement.prototype;
const geometryProbe = supportsElementGeometry
  ? document.createElement("div").getBoundingClientRect()
  : null;

if (
  !supportsElementGeometry ||
  (geometryProbe !== null && geometryProbe.width === 0 && geometryProbe.height === 0)
) {
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    writable: true,
    value: () => new DOMRect(0, 0, 100, 20),
  });
}
