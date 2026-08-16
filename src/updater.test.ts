import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkForAppUpdate,
  type NativeAppUpdate,
  normalizeAppUpdate,
  restartAfterUpdate,
} from "./updater";

type NativeUpdateMetadata = Readonly<{
  body?: unknown;
  currentVersion: string;
  date?: unknown;
  rawJson: Readonly<Record<string, string>>;
  rid: number;
  version: unknown;
}>;

const nativeBridge = {
  check: vi.fn<() => Promise<NativeUpdateMetadata | null>>(),
  close: vi.fn<() => Promise<void>>(),
  restart: vi.fn<() => Promise<void>>(),
};

function installNativeBridge(): void {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: async (command: string) => {
        switch (command) {
          case "plugin:updater|check":
            return nativeBridge.check();
          case "plugin:resources|close":
            return nativeBridge.close();
          case "plugin:process|restart":
            return nativeBridge.restart();
          default:
            throw new Error(`Unexpected updater command: ${command}`);
        }
      },
      transformCallback: () => 1,
      unregisterCallback: () => undefined,
    },
  });
}

function nativeUpdate(
  overrides: Partial<NativeAppUpdate> = {},
): NativeAppUpdate {
  return {
    body: undefined,
    close: vi.fn().mockResolvedValue(undefined),
    date: undefined,
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    version: "0.2.0",
    ...overrides,
  };
}

describe("updater boundary", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    nativeBridge.check.mockReset();
    nativeBridge.close.mockReset().mockResolvedValue(undefined);
    nativeBridge.restart.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("keeps browser builds inert without loading native plugins", async () => {
    await expect(checkForAppUpdate()).resolves.toBeUndefined();
    await expect(restartAfterUpdate()).resolves.toBeUndefined();
  });

  it("exposes only bounded update metadata and wrapped operations", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const updateWithPrivateMetadata = {
      ...nativeUpdate({
        body: `  ${"b".repeat(20_000)}  `,
        close,
        date: `  ${"d".repeat(100)}  `,
        downloadAndInstall,
        version: `  ${"v".repeat(100)}  `,
      }),
      version: `  ${"v".repeat(100)}  `,
      rawJson: { privateField: "not exposed" },
    };
    const update = normalizeAppUpdate(updateWithPrivateMetadata);

    expect(update).toEqual({
      version: "v".repeat(64),
      date: "d".repeat(64),
      body: "b".repeat(16_000),
      downloadAndInstall: expect.any(Function),
      close: expect.any(Function),
    });
    await update.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("omits null and malformed optional native metadata", () => {
    expect(
      normalizeAppUpdate(
        nativeUpdate({
          body: null,
          date: null,
        }),
      ),
    ).toMatchObject({
      version: "0.2.0",
      body: undefined,
      date: undefined,
    });
    expect(
      normalizeAppUpdate(
        nativeUpdate({
          body: { release: "notes" },
          date: 2_026_081_5,
          version: ["0.3.0"],
        }),
      ),
    ).toMatchObject({
      version: "",
      body: undefined,
      date: undefined,
    });
  });

  it("normalizes native download events to bounded percentages", async () => {
    const update = normalizeAppUpdate(
      nativeUpdate({
        downloadAndInstall: vi.fn(async (onEvent) => {
          onEvent?.({ event: "Started", data: { contentLength: 100 } });
          onEvent?.({ event: "Progress", data: { chunkLength: 25 } });
          onEvent?.({ event: "Progress", data: { chunkLength: -50 } });
          onEvent?.({ event: "Progress", data: { chunkLength: 150 } });
          onEvent?.({ event: "Finished" });
        }),
      }),
    );
    const percentages: number[] = [];

    await update.downloadAndInstall((percentage) => {
      percentages.push(percentage);
    });

    expect(percentages).toEqual([0, 25, 25, 100, 100]);
  });

  it("loads and normalizes updates through the native updater bridge", async () => {
    nativeBridge.check.mockResolvedValue({
      body: null,
      currentVersion: "0.2.0",
      date: null,
      rawJson: {},
      rid: 7,
      version: " 0.3.0 ",
    });
    installNativeBridge();

    const update = await checkForAppUpdate();

    expect(nativeBridge.check).toHaveBeenCalledOnce();
    expect(update).toMatchObject({
      version: "0.3.0",
      body: undefined,
      date: undefined,
    });
    await update?.close();
    expect(nativeBridge.close).toHaveBeenCalledOnce();
  });

  it("relaunches through the native process bridge", async () => {
    installNativeBridge();

    await restartAfterUpdate();

    expect(nativeBridge.restart).toHaveBeenCalledOnce();
  });
});
