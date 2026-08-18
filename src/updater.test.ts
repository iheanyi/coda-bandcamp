import { Channel, type InvokeArgs } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeValue } from "./data-bridge/native";
import {
  checkForAppUpdate,
  getInstalledAppVersion,
  type NativeAppUpdate,
  normalizeAppUpdate,
  restartAfterUpdate,
} from "./updater";

type NativeUpdateMetadata = Readonly<{
  body?: NativeValue;
  currentVersion: string;
  date?: NativeValue;
  rawJson: Readonly<Record<string, string>>;
  rid: number;
  version: NativeValue;
}>;

type UpdaterChannelEnvelope = Readonly<{
  index: number;
  message: NativeValue;
}>;

type DownloadEventEmitter = (event: NativeValue) => void;

const nativeBridge = {
  check: vi.fn<() => Promise<NativeUpdateMetadata | null>>(),
  close: vi.fn<() => Promise<void>>(),
  downloadAndInstall: vi.fn<(emit: DownloadEventEmitter) => Promise<void>>(),
  restart: vi.fn<() => Promise<void>>(),
  version: vi.fn<() => Promise<NativeValue>>(),
};

const channelCallbacks = new Map<
  number,
  (envelope: UpdaterChannelEnvelope) => void
>();
const channelIndexes = new WeakMap<Channel<NativeValue>, number>();
let nextCallbackId = 1;

function updaterProgressChannel(
  args: InvokeArgs | undefined,
): Channel<NativeValue> | undefined {
  if (
    args === undefined ||
    Array.isArray(args) ||
    args instanceof ArrayBuffer ||
    args instanceof Uint8Array
  ) {
    return undefined;
  }
  const value = args.onEvent;
  return value instanceof Channel ? value : undefined;
}

function postChannelMessage(
  channel: Channel<NativeValue>,
  message: NativeValue,
): void {
  const index = channelIndexes.get(channel) ?? 0;
  channelIndexes.set(channel, index + 1);
  const callback = channelCallbacks.get(channel.id);
  queueMicrotask(() => {
    callback?.({ index, message });
  });
}

function installNativeBridge(): void {
  channelCallbacks.clear();
  nextCallbackId = 1;
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      invoke: async (command: string, args?: InvokeArgs) => {
        switch (command) {
          case "plugin:updater|check":
            return nativeBridge.check();
          case "plugin:updater|download_and_install": {
            const channel = updaterProgressChannel(args);
            if (!channel) {
              throw new TypeError("Updater progress channel is missing");
            }
            await nativeBridge.downloadAndInstall((event) => {
              postChannelMessage(channel, event);
            });
            return undefined;
          }
          case "plugin:resources|close":
            return nativeBridge.close();
          case "plugin:process|restart":
            return nativeBridge.restart();
          case "plugin:app|version":
            return nativeBridge.version();
          default:
            throw new Error(`Unexpected updater command: ${command}`);
        }
      },
      transformCallback: (
        callback?: (envelope: UpdaterChannelEnvelope) => void,
      ) => {
        const id = nextCallbackId;
        nextCallbackId += 1;
        if (callback) {
          channelCallbacks.set(id, callback);
        }
        return id;
      },
      unregisterCallback: (id: number) => {
        channelCallbacks.delete(id);
      },
    },
  });
}

function nativeUpdate(
  overrides: Partial<NativeAppUpdate> = {},
): NativeAppUpdate {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    version: "0.2.0",
    ...overrides,
  };
}

function emitDownloadEventsAsync(
  onEvent: ((event: NativeValue) => void) | undefined,
  events: readonly NativeValue[],
): Promise<void> {
  return new Promise((resolve) => {
    for (const event of events) {
      queueMicrotask(() => {
        onEvent?.(event);
      });
    }
    queueMicrotask(resolve);
  });
}

describe("updater boundary", () => {
  beforeEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    nativeBridge.check.mockReset();
    nativeBridge.close.mockReset().mockResolvedValue(undefined);
    nativeBridge.downloadAndInstall.mockReset().mockResolvedValue(undefined);
    nativeBridge.restart.mockReset().mockResolvedValue(undefined);
    nativeBridge.version.mockReset().mockResolvedValue("0.1.0");
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("keeps browser builds inert without loading native plugins", async () => {
    await expect(checkForAppUpdate()).resolves.toBeUndefined();
    await expect(getInstalledAppVersion()).resolves.toBeUndefined();
    await expect(restartAfterUpdate()).resolves.toBeUndefined();
  });

  it("exposes only bounded update metadata and wrapped operations", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    const updateWithPrivateMetadata = {
      ...nativeUpdate({
        body: "  Playback fixes  ",
        close,
        date: "  2026-08-16  ",
        downloadAndInstall,
        version: "  0.3.0  ",
      }),
      rawJson: { privateField: "not exposed" },
    };
    const update = normalizeAppUpdate(updateWithPrivateMetadata);

    expect(update).toEqual({
      version: "0.3.0",
      date: "2026-08-16",
      body: "Playback fixes",
      downloadAndInstall: expect.any(Function),
      close: expect.any(Function),
    });
    await update.close();
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["non-text", ["0.3.0"]],
    ["empty", " \t "],
    ["oversized", "v".repeat(65)],
  ])("rejects a %s update version", (_label, version) => {
    expect(() => normalizeAppUpdate(nativeUpdate({ version }))).toThrow(
      "Invalid native response for updater check result.version",
    );
  });

  it("accepts absent optional native metadata", () => {
    expect(normalizeAppUpdate(nativeUpdate())).toMatchObject({
      version: "0.2.0",
      body: undefined,
      date: undefined,
    });
    expect(normalizeAppUpdate(nativeUpdate({
      body: undefined,
      date: undefined,
    }))).toMatchObject({
      version: "0.2.0",
      body: undefined,
      date: undefined,
    });
    expect(normalizeAppUpdate(nativeUpdate({
      body: null,
      date: null,
    }))).toMatchObject({
      version: "0.2.0",
      body: undefined,
      date: undefined,
    });
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "  \t "],
    ["layout-whitespace-only", " \n\r\n "],
  ])(
    "treats a %s generated-manifest body as absent so fallback copy renders",
    (_label, body) => {
      expect(normalizeAppUpdate(nativeUpdate({ body }))).toMatchObject({
        version: "0.2.0",
        body: undefined,
      });
    },
  );

  it.each([
    ["non-text body", { body: { release: "notes" } }, "body"],
    ["oversized body", { body: "b".repeat(16_001) }, "body"],
    ["non-text date", { date: 2_026_081_5 }, "date"],
    ["empty date", { date: " \t " }, "date"],
    ["oversized date", { date: "d".repeat(65) }, "date"],
  ])("rejects a %s", (_label, metadata, field) => {
    expect(() => normalizeAppUpdate(nativeUpdate(metadata))).toThrow(
      `Invalid native response for updater check result.${field}`,
    );
  });

  it("ignores inherited optional metadata and rejects accessors", () => {
    const inheritedDate = { ...nativeUpdate() };
    Object.setPrototypeOf(inheritedDate, { date: "2026-08-16" });
    let bodyReads = 0;
    const accessorBody = { ...nativeUpdate() };
    Object.defineProperty(accessorBody, "body", {
      get() {
        bodyReads += 1;
        return "Playback fixes";
      },
    });

    expect(normalizeAppUpdate(inheritedDate)).toMatchObject({
      version: "0.2.0",
      date: undefined,
    });
    expect(() => normalizeAppUpdate(accessorBody)).toThrow(
      "Invalid native response for updater check result.body",
    );
    expect(bodyReads).toBe(0);
  });

  it("normalizes native download events to bounded percentages", async () => {
    const update = normalizeAppUpdate(
      nativeUpdate({
        downloadAndInstall: vi.fn(async (onEvent) => {
          await emitDownloadEventsAsync(onEvent, [
            { event: "Started", data: { contentLength: 100 } },
            { event: "Progress", data: { chunkLength: 25 } },
            { event: "Progress", data: { chunkLength: 75 } },
            { event: "Finished" },
          ]);
        }),
      }),
    );
    const percentages: number[] = [];

    await update.downloadAndInstall((percentage) => {
      percentages.push(percentage);
    });

    expect(percentages).toEqual([0, 25, 100]);
  });

  it("ignores additive download event fields from the updater plugin", async () => {
    const update = normalizeAppUpdate(
      nativeUpdate({
        downloadAndInstall: vi.fn(async (onEvent) => {
          await emitDownloadEventsAsync(onEvent, [
            {
              event: "Started",
              data: { contentLength: 100, extraLength: 4 },
              pluginField: "started",
            },
            {
              event: "Progress",
              data: { chunkLength: 50, extraChunk: 1 },
            },
            { event: "Finished", data: {}, checksum: "abc" },
          ]);
        }),
      }),
    );
    const percentages: number[] = [];

    await update.downloadAndInstall((percentage) => {
      percentages.push(percentage);
    });

    expect(percentages).toEqual([0, 50]);
  });

  it.each([
    ["an unknown variant", { event: "Compromised" }],
    ["missing Started data", { event: "Started" }],
    [
      "a malformed content length",
      { event: "Started", data: { contentLength: "100" } },
    ],
    [
      "a malformed progress chunk",
      { event: "Progress", data: { chunkLength: -1 } },
    ],
  ])("contains %s without cancelling or completing the install", async (
    _label,
    nativeEvent,
  ) => {
    let finishInstall: (() => void) | undefined;
    let emit: DownloadEventEmitter | undefined;
    const update = normalizeAppUpdate(
      nativeUpdate({
        downloadAndInstall: vi.fn(async (onEvent) => {
          emit = onEvent;
          await new Promise<void>((resolve) => {
            finishInstall = resolve;
          });
        }),
      }),
    );
    const percentages: number[] = [];
    const install = update.downloadAndInstall((percentage) => {
      percentages.push(percentage);
    });

    await Promise.resolve();
    emit?.({ event: "Started", data: { contentLength: 100 } });
    await Promise.resolve();
    emit?.({ event: "Progress", data: { chunkLength: 40 } });
    await Promise.resolve();
    emit?.(nativeEvent);
    await Promise.resolve();
    emit?.({ event: "Progress", data: { chunkLength: 60 } });
    emit?.({ event: "Finished" });
    await Promise.resolve();

    expect(percentages).toEqual([0, 40]);
    finishInstall?.();
    await expect(install).resolves.toBeUndefined();
    expect(percentages).toEqual([0, 40]);
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

  it("installs through the native channel without treating progress as lifecycle", async () => {
    nativeBridge.check.mockResolvedValue({
      currentVersion: "0.2.0",
      rawJson: {},
      rid: 7,
      version: "0.3.0",
    });
    nativeBridge.downloadAndInstall.mockImplementation(async (emit) => {
      emit({ event: "Started", data: { contentLength: 100 } });
      emit({ event: "Progress", data: { chunkLength: 25 } });
      emit({ event: "Finished" });
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
    });
    installNativeBridge();

    const update = await checkForAppUpdate();
    const percentages: number[] = [];
    await update?.downloadAndInstall((percentage) => {
      percentages.push(percentage);
    });

    expect(percentages).toEqual([0, 25]);
  });

  it("contains a malformed native channel event without rejecting the install", async () => {
    nativeBridge.check.mockResolvedValue({
      currentVersion: "0.2.0",
      rawJson: {},
      rid: 7,
      version: "0.3.0",
    });
    nativeBridge.downloadAndInstall.mockImplementation(async (emit) => {
      emit({ event: "Started", data: { contentLength: 100 } });
      emit({ event: "Progress", data: { chunkLength: 40 } });
      emit({ event: "Compromised" });
      emit({ event: "Progress", data: { chunkLength: 60 } });
      emit({ event: "Finished" });
      await new Promise<void>((resolve) => {
        queueMicrotask(resolve);
      });
    });
    installNativeBridge();

    const update = await checkForAppUpdate();
    const percentages: number[] = [];
    await expect(
      update?.downloadAndInstall((percentage) => {
        percentages.push(percentage);
      }),
    ).resolves.toBeUndefined();
    expect(percentages).toEqual([0, 40]);
  });

  it.each([
    ["version", { version: " " }],
    ["date", { date: 2_026_081_6 }],
    ["body", { body: { notes: "Playback fixes" } }],
  ])("surfaces malformed native %s metadata as an unavailable check", async (
    field,
    malformedMetadata,
  ) => {
    nativeBridge.check.mockResolvedValue({
      currentVersion: "0.2.0",
      rawJson: {},
      rid: 7,
      version: "0.3.0",
      ...malformedMetadata,
    });
    installNativeBridge();

    await expect(checkForAppUpdate()).rejects.toThrow(
      `Invalid native response for updater check result.${field}`,
    );
  });

  it("relaunches through the native process bridge", async () => {
    installNativeBridge();

    await restartAfterUpdate();

    expect(nativeBridge.restart).toHaveBeenCalledOnce();
  });

  it("returns a bounded installed app version", async () => {
    nativeBridge.version.mockResolvedValue(" 0.7.1 ");
    installNativeBridge();

    await expect(getInstalledAppVersion()).resolves.toBe("0.7.1");
    expect(nativeBridge.version).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", undefined],
    ["null", null],
    ["non-text", ["0.7.1"]],
    ["empty", " \t "],
    ["oversized", "v".repeat(65)],
    ["control characters", "0.7.1\n"],
  ])("rejects a %s installed app version", async (_label, version) => {
    nativeBridge.version.mockResolvedValue(version);
    installNativeBridge();

    await expect(getInstalledAppVersion()).resolves.toBeUndefined();
  });
});
