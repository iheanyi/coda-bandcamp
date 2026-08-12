import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type QueueFocusScheduler,
  useQueueFocusController,
} from "./useQueueFocusController";

function createFocusScheduler() {
  const callbacks: Array<() => void> = [];
  const cancelled = new Set<() => void>();
  const schedule: QueueFocusScheduler = (callback) => {
    callbacks.push(callback);
    return () => cancelled.add(callback);
  };
  return {
    flush() {
      for (const callback of callbacks.splice(0)) {
        if (!cancelled.has(callback)) callback();
      }
    },
    schedule,
  };
}

describe("useQueueFocusController", () => {
  it("focuses the drawer after opening and restores the player control after closing", () => {
    const scheduler = createFocusScheduler();
    const setOpen = vi.fn();
    const panel = document.createElement("div");
    panel.tabIndex = -1;
    const control = document.createElement("button");
    document.body.append(panel, control);
    const { result, rerender } = renderHook(
      ({ open }) =>
        useQueueFocusController({
          open,
          scheduleFocus: scheduler.schedule,
          setOpen,
        }),
      { initialProps: { open: false } },
    );
    result.current.panelRef.current = panel;
    result.current.controlRef.current = control;

    act(() => result.current.onOpenChange(true));
    expect(setOpen).toHaveBeenLastCalledWith(true);
    rerender({ open: true });
    act(() => scheduler.flush());
    expect(panel).toHaveFocus();

    act(() => result.current.onOpenChange(false));
    expect(setOpen).toHaveBeenLastCalledWith(false);
    act(() => scheduler.flush());
    expect(control).toHaveFocus();

    panel.remove();
    control.remove();
  });

  it("cancels stale focus restoration when the drawer reopens", () => {
    const scheduler = createFocusScheduler();
    const setOpen = vi.fn();
    const control = document.createElement("button");
    document.body.append(control);
    const { result } = renderHook(() =>
      useQueueFocusController({
        open: true,
        scheduleFocus: scheduler.schedule,
        setOpen,
      }),
    );
    result.current.controlRef.current = control;

    act(() => {
      result.current.onOpenChange(false);
      result.current.onOpenChange(true);
      scheduler.flush();
    });

    expect(control).not.toHaveFocus();
    expect(setOpen.mock.calls).toEqual([[false], [true]]);
    control.remove();
  });

  it("cancels pending panel focus when the drawer closes again", () => {
    const scheduler = createFocusScheduler();
    const panel = document.createElement("div");
    panel.tabIndex = -1;
    document.body.append(panel);
    const { result, rerender } = renderHook(
      ({ open }) =>
        useQueueFocusController({
          open,
          scheduleFocus: scheduler.schedule,
          setOpen: vi.fn(),
        }),
      { initialProps: { open: false } },
    );
    result.current.panelRef.current = panel;

    act(() => result.current.onOpenChange(true));
    rerender({ open: true });
    act(() => result.current.onOpenChange(false));
    act(() => scheduler.flush());

    expect(panel).not.toHaveFocus();
    panel.remove();
  });
});
