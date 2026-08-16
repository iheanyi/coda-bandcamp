import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Channel, type InvokeArgs } from "@tauri-apps/api/core";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppUpdatePrompt,
  AppUpdateSettings,
} from "./AppUpdater";
import { useAppUpdater } from "./appUpdaterController";

type TestUpdateMetadata = Readonly<{
  body?: string;
  currentVersion: string;
  date?: string;
  rawJson: Readonly<Record<string, string>>;
  rid: number;
  version: string;
}>;

type DownloadImplementation = (
  emit: (event: DownloadEvent) => void,
) => Promise<void>;

const updaterBridge = {
  check: vi.fn<() => Promise<TestUpdateMetadata | null>>(),
  close: vi.fn<() => Promise<void>>(),
  downloadAndInstall: vi.fn<DownloadImplementation>(),
  restart: vi.fn<() => Promise<void>>(),
};

function updaterProgressChannel(
  args: InvokeArgs | undefined,
): Channel<DownloadEvent> | undefined {
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

function installDesktopUpdaterBridge(): void {
  let nextCallbackId = 1;
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
              channel.onmessage(event);
            });
            return undefined;
          }
          case "plugin:resources|close":
            await updaterBridge.close();
            return undefined;
          case "plugin:process|restart":
            await updaterBridge.restart();
            return undefined;
          default:
            throw new Error(`Unexpected updater command: ${command}`);
        }
      },
      transformCallback: () => nextCallbackId++,
      unregisterCallback: () => undefined,
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
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
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
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
