import { afterEach, describe, expect, it } from "vitest";
import { requireDesktop } from "./desktop";

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});

describe("requireDesktop", () => {
  it("throws a feature-specific desktop-only error in the web fallback", () => {
    expect(() => requireDesktop("Discover")).toThrow(
      "Discover is available in the Coda desktop app.",
    );
  });

  it("is a no-op in the desktop app", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    expect(() => requireDesktop("Discover")).not.toThrow();
  });
});
