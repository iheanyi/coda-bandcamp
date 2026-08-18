import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Channel, type InvokeArgs } from "@tauri-apps/api/core";
import { StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppUpdatePrompt,
  AppUpdateSettings,
} from "./AppUpdater";
import { useAppUpdater } from "./appUpdaterController";
import type { NativeValue } from "./data-bridge/native";
import { PersistentAppOverlays } from "./features/settings/PersistentAppOverlays";
import { usePersistentOverlaysController } from "./features/settings/usePersistentOverlaysController";

type TestUpdateMetadata = Readonly<{
  body?: string;
  currentVersion: string;
  date?: string;
  rawJson: Readonly<Record<string, string>>;
  rid: number;
  version: string;
}>;

type UpdaterChannelEnvelope = Readonly<{
  index: number;
  message: NativeValue;
}>;

type DownloadImplementation = (
  emit: (event: NativeValue) => void,
) => Promise<void>;

const updaterBridge = {
  check: vi.fn<() => Promise<TestUpdateMetadata | null>>(),
  close: vi.fn<() => Promise<void>>(),
  downloadAndInstall: vi.fn<DownloadImplementation>(),
  restart: vi.fn<() => Promise<void>>(),
  version: vi.fn<() => Promise<string>>(),
};

const channelCallbacks = new Map<
  number,
  (envelope: UpdaterChannelEnvelope) => void
>();
const channelIndexes = new WeakMap<Channel<NativeValue>, number>();

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

function postUpdaterChannelEvent(
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

function installDesktopUpdaterBridge(): void {
  let nextCallbackId = 1;
  channelCallbacks.clear();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      convertFileSrc: (path: string, protocol: string) => `${protocol}:${path}`,
      invoke: async (command: string, args?: InvokeArgs) => {
        switch (command) {
          case "plugin:updater|check":
            return updaterBridge.check();
          case "plugin:updater|download_and_install": {
            const channel = updaterProgressChannel(args);
            if (!channel) {
              throw new TypeError("Updater progress channel is missing");
            }
            await updaterBridge.downloadAndInstall((event) => {
              postUpdaterChannelEvent(channel, event);
            });
            return undefined;
          }
          case "plugin:resources|close":
            await updaterBridge.close();
            return undefined;
          case "plugin:process|restart":
            await updaterBridge.restart();
            return undefined;
          case "plugin:app|version":
            return updaterBridge.version();
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

function removeDesktopUpdaterBridge(): void {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
}

function UpdaterHarness() {
  const updater = useAppUpdater();
  return (
    <>
      <button type="button">Return to library</button>
      <AppUpdateSettings updater={updater} />
      <AppUpdatePrompt updater={updater} />
    </>
  );
}

function OverlaysUpdaterHarness({ openSettings }: { openSettings: boolean }) {
  const updater = useAppUpdater();
  const controller = usePersistentOverlaysController({
    loadLastFmStatus: async () => ({ configured: false, connected: false }),
  });

  useEffect(() => {
    if (openSettings) controller.commands.openConnection();
  }, [controller.commands, openSettings]);

  return (
    <PersistentAppOverlays
      connected={false}
      controller={controller}
      notify={() => undefined}
      onConnected={() => undefined}
      onDisconnected={async () => undefined}
      updater={updater}
    />
  );
}

function renderUpdater(strict = false) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const content = (
    <QueryClientProvider client={queryClient}>
      <UpdaterHarness />
    </QueryClientProvider>
  );

  return render(strict ? <StrictMode>{content}</StrictMode> : content);
}

function renderOverlaysUpdater(openSettings = true) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <OverlaysUpdaterHarness openSettings={openSettings} />
    </QueryClientProvider>,
  );
}

function createUpdate(
  overrides: Partial<TestUpdateMetadata> = {},
): TestUpdateMetadata {
  return {
    currentVersion: "0.1.0",
    rawJson: {},
    rid: 1,
    version: "0.2.0",
    date: "2026-07-28",
    body: "Playback is smoother and update delivery is ready.",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("app updater experience", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_CODA_UPDATER_ENABLED", "1");
    installDesktopUpdaterBridge();
    updaterBridge.check.mockReset();
    updaterBridge.close.mockReset().mockResolvedValue(undefined);
    updaterBridge.downloadAndInstall.mockReset().mockResolvedValue(undefined);
    updaterBridge.restart.mockReset().mockResolvedValue(undefined);
    updaterBridge.version.mockReset().mockResolvedValue("0.1.0");
  });

  afterEach(() => {
    removeDesktopUpdaterBridge();
    vi.unstubAllEnvs();
  });

  it("checks once in Strict Mode and lets the user defer an available update", async () => {
    updaterBridge.check.mockResolvedValue(createUpdate());

    renderUpdater(true);

    expect(
      await screen.findByRole("dialog", { name: "Coda 0.2.0 is ready" }),
    ).toBeInTheDocument();
    expect(updaterBridge.check).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Coda 0.2.0 is ready" }),
      ).not.toBeInTheDocument();
    });
    expect(updaterBridge.close).toHaveBeenCalledOnce();
  });

  it("focuses the explicit update action, dismisses with Escape, and restores prior focus", async () => {
    const user = userEvent.setup();
    const updateCheck = deferred<TestUpdateMetadata | null>();
    updaterBridge.check.mockReturnValue(updateCheck.promise);

    renderUpdater();
    const returnButton = screen.getByRole("button", {
      name: "Return to library",
    });
    returnButton.focus();
    expect(returnButton).toHaveFocus();

    await act(async () => {
      updateCheck.resolve(createUpdate());
    });
    await screen.findByRole("dialog", { name: "Coda 0.2.0 is ready" });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Update now" }),
      ).toHaveFocus();
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(returnButton).toHaveFocus();
  });

  it("reports download progress and rejects dismissal until installation finishes", async () => {
    const user = userEvent.setup();
    let finishDownload: (() => void) | undefined;
    updaterBridge.downloadAndInstall.mockImplementation(
      async (emit) => {
        emit({ event: "Started", data: { contentLength: 100 } });
        emit({ event: "Progress", data: { chunkLength: 42 } });
        await new Promise<void>((resolve) => {
          finishDownload = resolve;
        });
      },
    );
    updaterBridge.check.mockResolvedValue(createUpdate());

    renderUpdater();
    const prompt = await screen.findByRole("dialog", {
      name: "Coda 0.2.0 is ready",
    });

    await user.click(screen.getByRole("button", { name: "Update now" }));
    expect(
      await screen.findByText("Downloading update… 42%"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("progressbar", {
        name: "Downloading update… 42%",
      }),
    ).toHaveAttribute("aria-valuenow", "42");
    expect(prompt).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();
    expect(updaterBridge.restart).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    await user.click(document.body);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await act(async () => {
      finishDownload?.();
    });
    expect(
      await screen.findByRole("button", { name: "Restart Coda" }),
    ).toBeEnabled();
  });

  it("keeps installing when a download progress event is malformed", async () => {
    const user = userEvent.setup();
    let finishDownload: (() => void) | undefined;
    updaterBridge.downloadAndInstall.mockImplementation(async (emit) => {
      emit({ event: "Started", data: { contentLength: 100 } });
      emit({ event: "Progress", data: { chunkLength: 42 } });
      emit({ event: "Compromised" });
      emit({ event: "Progress", data: { chunkLength: 58 } });
      emit({ event: "Finished" });
      await new Promise<void>((resolve) => {
        finishDownload = resolve;
      });
    });
    updaterBridge.check.mockResolvedValue(createUpdate());

    renderUpdater();
    await user.click(
      await screen.findByRole("button", { name: "Update now" }),
    );

    expect(
      await screen.findByText("Downloading update… 42%"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Downloading update… 100%"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Later" })).toBeDisabled();
    expect(updaterBridge.restart).not.toHaveBeenCalled();

    await act(async () => {
      finishDownload?.();
    });
    expect(
      await screen.findByRole("button", { name: "Restart Coda" }),
    ).toBeEnabled();
  });

  it("supports a manual check that confirms the current version", async () => {
    updaterBridge.check.mockResolvedValue(null);

    renderUpdater();
    const checkButton = await screen.findByRole("button", {
      name: "Check for updates",
    });
    expect(updaterBridge.check).toHaveBeenCalledOnce();

    fireEvent.click(checkButton);

    expect(await screen.findByText("Coda is up to date.")).toBeInTheDocument();
    expect(updaterBridge.check).toHaveBeenCalledTimes(2);
  });

  it("shows an actionable message when a manual check fails", async () => {
    updaterBridge.check
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("private updater detail"));

    renderUpdater();
    const checkButton = await screen.findByRole("button", {
      name: "Check for updates",
    });
    expect(updaterBridge.check).toHaveBeenCalledOnce();
    fireEvent.click(checkButton);

    expect(
      await screen.findByText(
        "Coda couldn’t check for updates. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("private updater detail")).not.toBeInTheDocument();
  });

  it("keeps an automatic check failure silent until the user asks to retry", async () => {
    updaterBridge.check.mockRejectedValue(
      new Error("private automatic updater detail"),
    );

    renderUpdater();

    expect(
      await screen.findByRole("button", { name: "Check for updates" }),
    ).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByText("private automatic updater detail"),
    ).not.toBeInTheDocument();
  });

  it("shows an actionable error and allows deferral when installation fails", async () => {
    const user = userEvent.setup();
    updaterBridge.downloadAndInstall
      .mockRejectedValueOnce(new Error("private installer detail"))
      .mockResolvedValueOnce(undefined);
    updaterBridge.check.mockResolvedValue(createUpdate());

    renderUpdater();
    await user.click(
      await screen.findByRole("button", { name: "Update now" }),
    );

    expect(
      await screen.findByText(
        "Coda couldn’t finish the update. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("private installer detail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Later" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("button", { name: "Restart Coda" }),
    ).toBeEnabled();
    expect(updaterBridge.downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it("retries a failed restart without downloading and installing again", async () => {
    const user = userEvent.setup();
    updaterBridge.restart
      .mockRejectedValueOnce(new Error("private relaunch detail"))
      .mockResolvedValueOnce(undefined);
    updaterBridge.check.mockResolvedValue(createUpdate());

    renderUpdater();
    await user.click(
      await screen.findByRole("button", { name: "Update now" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Restart Coda" }),
    );

    expect(
      await screen.findByText(
        "Coda couldn’t finish the update. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("private relaunch detail")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(updaterBridge.restart).toHaveBeenCalledTimes(2);
    });
    expect(updaterBridge.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("does not check or render update controls in a browser", async () => {
    removeDesktopUpdaterBridge();
    updaterBridge.check.mockResolvedValue(createUpdate());

    renderUpdater();

    await act(async () => {
      await Promise.resolve();
    });
    expect(updaterBridge.check).not.toHaveBeenCalled();
    expect(updaterBridge.version).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Coda 0.1.0")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not call updater APIs in the development and automation flavor", async () => {
    vi.stubEnv("VITE_CODA_UPDATER_ENABLED", "0");
    updaterBridge.check.mockResolvedValue(createUpdate());

    renderUpdater();

    await act(async () => {
      await Promise.resolve();
    });
    expect(updaterBridge.check).not.toHaveBeenCalled();
    expect(updaterBridge.version).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Coda 0.1.0")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the installed version in the settings updater section", async () => {
    updaterBridge.check.mockResolvedValue(null);

    renderUpdater();

    expect(await screen.findByText("Coda 0.1.0")).toBeInTheDocument();
    expect(updaterBridge.version).toHaveBeenCalledOnce();
  });

  it("shows an update prompt above an open settings dialog after a manual check", async () => {
    const user = userEvent.setup();
    updaterBridge.check
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createUpdate());

    renderOverlaysUpdater();

    const settings = await screen.findByRole("dialog", {
      name: "Bring in your collection",
    });
    expect(
      screen.queryByRole("dialog", { name: "Coda 0.2.0 is ready" }),
    ).not.toBeInTheDocument();

    await user.click(
      await screen.findByRole("button", { name: "Check for updates" }),
    );

    const prompt = await screen.findByRole("dialog", {
      name: "Coda 0.2.0 is ready",
    });
    expect(settings).toBeInTheDocument();
    expect(prompt).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Update now" })).toHaveFocus();
    });

    await user.click(screen.getByRole("button", { name: "Later" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Coda 0.2.0 is ready" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("dialog", { name: "Bring in your collection" }),
    ).toBeInTheDocument();
  });

  it("shows the startup update prompt while settings are closed", async () => {
    updaterBridge.check.mockResolvedValue(createUpdate());

    renderOverlaysUpdater(false);

    const prompt = await screen.findByRole("dialog", {
      name: "Coda 0.2.0 is ready",
    });
    expect(prompt).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Bring in your collection" }),
    ).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Update now" })).toHaveFocus();
    });

    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("closes only the update prompt when Escape is pressed above settings", async () => {
    const user = userEvent.setup();
    updaterBridge.check
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createUpdate());

    renderOverlaysUpdater();
    await user.click(
      await screen.findByRole("button", { name: "Check for updates" }),
    );
    await screen.findByRole("dialog", { name: "Coda 0.2.0 is ready" });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Update now" })).toHaveFocus();
    });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Coda 0.2.0 is ready" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("dialog", { name: "Bring in your collection" }),
    ).toBeInTheDocument();
  });
});
