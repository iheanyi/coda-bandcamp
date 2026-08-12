import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
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

  it("keeps exactly one current listener through Strict Mode remounts", () => {
    const searchRef = { current: document.createElement("input") };
    const firstToggle = vi.fn();
    const nextToggle = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    );
    const { rerender, unmount } = renderHook(
      ({ onTogglePlayback }) =>
        useAppKeyboardShortcuts({
          onNext: vi.fn(),
          onPrevious: vi.fn(),
          onTogglePlayback,
          searchRef,
        }),
      {
        initialProps: { onTogglePlayback: firstToggle },
        wrapper,
      },
    );

    act(() => {
      for (let event = 0; event < 100; event += 1) {
        window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
      }
    });
    expect(firstToggle).toHaveBeenCalledTimes(100);

    rerender({ onTogglePlayback: nextToggle });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    });
    expect(firstToggle).toHaveBeenCalledTimes(100);
    expect(nextToggle).toHaveBeenCalledOnce();

    unmount();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(nextToggle).toHaveBeenCalledOnce();
  });
});
