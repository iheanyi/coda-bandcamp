import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAppKeyboardShortcuts } from "./useAppKeyboardShortcuts";

describe("useAppKeyboardShortcuts", () => {
  it("routes global transport/search shortcuts and ignores interactive controls", () => {
    const input = document.createElement("input");
    document.body.append(input);
    const searchRef = { current: input };
    const onNext = vi.fn();
    const onPrevious = vi.fn();
    const onTogglePlayback = vi.fn();
    const { unmount } = renderHook(() =>
      useAppKeyboardShortcuts({
        onNext,
        onPrevious,
        onTogglePlayback,
        searchRef,
      }),
    );

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
      window.dispatchEvent(
        new KeyboardEvent("keydown", { altKey: true, key: "ArrowRight" }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { altKey: true, key: "ArrowLeft" }),
      );
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "/" }));
    });
    expect(onTogglePlayback).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);

    act(() => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, code: "Space" }),
      );
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
      );
    });
    expect(onTogglePlayback).toHaveBeenCalledOnce();
    expect(document.activeElement).not.toBe(input);

    unmount();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(onTogglePlayback).toHaveBeenCalledOnce();
  });
});
