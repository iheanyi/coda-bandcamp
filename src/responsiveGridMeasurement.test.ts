import { afterEach, describe, expect, it } from "vitest";
import {
  initialResponsiveGridScrollMargin,
  initialResponsiveGridWidth,
  readResponsiveGridViewport,
  rememberResponsiveGridMeasurement,
  resetResponsiveGridMeasurementCache,
} from "./responsiveGridMeasurement";

describe("responsiveGridMeasurement", () => {
  afterEach(() => {
    resetResponsiveGridMeasurementCache();
  });

  it("reuses the last remembered width and scroll margin", () => {
    rememberResponsiveGridMeasurement({ scrollMargin: 72, width: 800 });

    expect(initialResponsiveGridWidth(null)).toBe(800);
    expect(initialResponsiveGridScrollMargin()).toBe(72);
  });

  it("falls back to the scroll element's clientWidth when nothing is remembered", () => {
    const scroll = document.createElement("div");
    Object.defineProperty(scroll, "clientWidth", { value: 720 });

    expect(initialResponsiveGridWidth(scroll)).toBe(720);
    expect(initialResponsiveGridScrollMargin()).toBe(0);
  });

  it("reads the live scroll viewport so the first virtualizer commit is not 0x0", () => {
    const scroll = document.createElement("div");
    Object.defineProperty(scroll, "clientHeight", { value: 640 });
    Object.defineProperty(scroll, "clientWidth", { value: 800 });
    Object.defineProperty(scroll, "scrollTop", { value: 312, writable: true });

    expect(readResponsiveGridViewport(scroll)).toEqual({
      height: 640,
      offset: 312,
      width: 800,
    });
  });

  it("does not replace a remembered width with a zero measurement", () => {
    rememberResponsiveGridMeasurement({ scrollMargin: 72, width: 800 });
    rememberResponsiveGridMeasurement({ scrollMargin: 0, width: 0 });

    expect(initialResponsiveGridWidth(null)).toBe(800);
    expect(initialResponsiveGridScrollMargin()).toBe(72);
  });
});
