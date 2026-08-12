import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  type MainWindowAdapter,
  useMainWindowController,
} from "./useMainWindowController";

function createAdapter(supported = true) {
  const appWindow = {
    setFocus: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    unminimize: vi.fn().mockResolvedValue(undefined),
  };
  const adapter: MainWindowAdapter = {
    load: vi.fn().mockResolvedValue(appWindow),
    supported: () => supported,
  };
  return { adapter, appWindow };
}

describe("useMainWindowController", () => {
  it("reveals and focuses the native window on startup and on request", async () => {
    const { adapter, appWindow } = createAdapter();
    const { result } = renderHook(() => useMainWindowController(adapter));

    await waitFor(() => expect(adapter.load).toHaveBeenCalledOnce());
    expect(appWindow.unminimize).toHaveBeenCalledOnce();
    expect(appWindow.show).toHaveBeenCalledOnce();
    expect(appWindow.setFocus).toHaveBeenCalledOnce();

    act(() => result.current.showMainWindow());
    await waitFor(() => expect(adapter.load).toHaveBeenCalledTimes(2));
    expect(appWindow.unminimize).toHaveBeenCalledTimes(2);
    expect(appWindow.show).toHaveBeenCalledTimes(2);
    expect(appWindow.setFocus).toHaveBeenCalledTimes(2);
  });

  it("does not load native APIs when desktop support is unavailable", () => {
    const { adapter } = createAdapter(false);
    const { result } = renderHook(() => useMainWindowController(adapter));

    act(() => result.current.showMainWindow());
    expect(adapter.load).not.toHaveBeenCalled();
  });
});
