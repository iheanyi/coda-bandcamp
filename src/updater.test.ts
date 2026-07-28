import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nativePluginMocks = vi.hoisted(() => ({
  check: vi.fn(),
  relaunch: vi.fn(),
  updaterLoads: 0,
  processLoads: 0,
}));

vi.mock("@tauri-apps/plugin-updater", () => {
  nativePluginMocks.updaterLoads += 1;
  return { check: nativePluginMocks.check };
});

vi.mock("@tauri-apps/plugin-process", () => {
  nativePluginMocks.processLoads += 1;
  return { relaunch: nativePluginMocks.relaunch };
});

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

function setDesktopRuntime(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

function clearDesktopRuntime(): void {
  delete (window as TauriWindow).__TAURI_INTERNALS__;
}

describe("updater boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    nativePluginMocks.check.mockReset();
    nativePluginMocks.relaunch.mockReset();
    nativePluginMocks.updaterLoads = 0;
    nativePluginMocks.processLoads = 0;
    clearDesktopRuntime();
  });

  afterEach(clearDesktopRuntime);

  it("keeps browser builds inert without loading native plugins", async () => {
    const { checkForAppUpdate, restartAfterUpdate } = await import("./updater");

    await expect(checkForAppUpdate()).resolves.toBeUndefined();
    await expect(restartAfterUpdate()).resolves.toBeUndefined();
    expect(nativePluginMocks.updaterLoads).toBe(0);
    expect(nativePluginMocks.processLoads).toBe(0);
  });

  it("returns undefined when the native updater has no release", async () => {
    setDesktopRuntime();
    nativePluginMocks.check.mockResolvedValue(null);
    const { checkForAppUpdate } = await import("./updater");

    await expect(checkForAppUpdate()).resolves.toBeUndefined();
  });

  it("exposes only bounded update metadata and wrapped operations", async () => {
    setDesktopRuntime();
    const close = vi.fn().mockResolvedValue(undefined);
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    nativePluginMocks.check.mockResolvedValue({
      available: true,
      currentVersion: "0.1.0",
      version: `  ${"v".repeat(100)}  `,
      date: `  ${"d".repeat(100)}  `,
      body: `  ${"b".repeat(20_000)}  `,
      rawJson: { privateField: "not exposed" },
      download: vi.fn(),
      install: vi.fn(),
      downloadAndInstall,
      close,
    });
    const { checkForAppUpdate } = await import("./updater");

    const update = await checkForAppUpdate();

    expect(update).toEqual({
      version: "v".repeat(64),
      date: "d".repeat(64),
      body: "b".repeat(16_000),
      downloadAndInstall: expect.any(Function),
      close: expect.any(Function),
    });
    await update?.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("normalizes native download events to bounded percentages", async () => {
    setDesktopRuntime();
    nativePluginMocks.check.mockResolvedValue({
      available: true,
      currentVersion: "0.1.0",
      version: "0.2.0",
      rawJson: {},
      download: vi.fn(),
      install: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
      downloadAndInstall: vi.fn(async (onEvent) => {
        onEvent?.({ event: "Started", data: { contentLength: 100 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 25 } });
        onEvent?.({ event: "Progress", data: { chunkLength: -50 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 150 } });
        onEvent?.({ event: "Finished" });
      }),
    });
    const { checkForAppUpdate } = await import("./updater");
    const update = await checkForAppUpdate();
    const percentages: number[] = [];

    await update?.downloadAndInstall((percentage) => {
      percentages.push(percentage);
    });

    expect(percentages).toEqual([0, 25, 25, 100, 100]);
  });

  it("loads the process plugin only when a native restart is requested", async () => {
    setDesktopRuntime();
    nativePluginMocks.relaunch.mockResolvedValue(undefined);
    const { restartAfterUpdate } = await import("./updater");

    expect(nativePluginMocks.processLoads).toBe(0);
    await restartAfterUpdate();

    expect(nativePluginMocks.processLoads).toBe(1);
    expect(nativePluginMocks.relaunch).toHaveBeenCalledOnce();
  });
});
