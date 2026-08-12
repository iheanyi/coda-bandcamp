import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMotionExitWatchdog } from "./useMotionExitWatchdog";

afterEach(() => {
  vi.useRealTimers();
});

describe("useMotionExitWatchdog", () => {
  it("completes a stalled exit exactly once", () => {
    vi.useFakeTimers();
    const onExitComplete = vi.fn();
    const { rerender, result } = renderHook(
      ({ open }) => useMotionExitWatchdog({ onExitComplete, open }),
      { initialProps: { open: true } },
    );

    rerender({ open: false });
    act(() => vi.advanceTimersByTime(499));
    expect(onExitComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onExitComplete).toHaveBeenCalledOnce();

    act(() => result.current());
    act(() => vi.runAllTimers());
    expect(onExitComplete).toHaveBeenCalledOnce();
  });

  it("does not let a stale exit completion tear down a reopened surface", () => {
    vi.useFakeTimers();
    const onExitComplete = vi.fn();
    const { rerender, result } = renderHook(
      ({ open }) => useMotionExitWatchdog({ onExitComplete, open }),
      { initialProps: { open: true } },
    );

    rerender({ open: false });
    rerender({ open: true });
    act(() => result.current());
    act(() => vi.runAllTimers());
    expect(onExitComplete).not.toHaveBeenCalled();

    rerender({ open: false });
    act(() => result.current());
    act(() => vi.runAllTimers());
    expect(onExitComplete).toHaveBeenCalledOnce();
  });

  it("protects Dialog, AlertDialog, and Tooltip from an ABA-delayed first exit", () => {
    vi.useFakeTimers();
    const onExitComplete = vi.fn();
    const { rerender, result } = renderHook(
      ({ open }) => useMotionExitWatchdog({ onExitComplete, open }),
      { initialProps: { open: true } },
    );

    rerender({ open: false });
    const completeFirstExit = result.current;

    rerender({ open: true });
    rerender({ open: false });
    const completeSecondExit = result.current;

    // Motion may deliver the first animation's delayed completion only after
    // the surface has reopened and begun a second exit. It must not complete
    // that newer lifecycle generation.
    act(() => completeFirstExit());
    expect(onExitComplete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(499));
    expect(onExitComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onExitComplete).toHaveBeenCalledOnce();

    act(() => completeSecondExit());
    expect(onExitComplete).toHaveBeenCalledOnce();
  });
});
