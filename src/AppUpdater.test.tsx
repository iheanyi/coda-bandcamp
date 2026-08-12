import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdate } from "./updater";

const updaterMocks = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn(),
  desktop: true,
  enabled: true,
  restartAfterUpdate: vi.fn(),
}));

vi.mock("./appFlavor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./appFlavor")>();
  return {
    ...actual,
    isAppUpdaterEnabled: () => updaterMocks.enabled,
  };
});

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    isDesktop: () => updaterMocks.desktop,
  };
});

vi.mock("./updater", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./updater")>();
  return {
    ...actual,
    checkForAppUpdate: updaterMocks.checkForAppUpdate,
    restartAfterUpdate: updaterMocks.restartAfterUpdate,
  };
});

import {
  AppUpdatePrompt,
  AppUpdateSettings,
} from "./AppUpdater";
import { useAppUpdater } from "./appUpdaterController";

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

function createUpdate(overrides: Partial<AppUpdate> = {}): AppUpdate {
  return {
    version: "0.2.0",
    date: "2026-07-28",
    body: "Playback is smoother and update delivery is ready.",
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("app updater experience", () => {
  beforeEach(() => {
    updaterMocks.desktop = true;
    updaterMocks.enabled = true;
    updaterMocks.checkForAppUpdate.mockReset();
    updaterMocks.restartAfterUpdate.mockReset();
    updaterMocks.restartAfterUpdate.mockResolvedValue(undefined);
  });

  it("checks once in Strict Mode and lets the user defer an available update", async () => {
    const update = createUpdate();
    updaterMocks.checkForAppUpdate.mockResolvedValue(update);

    renderUpdater(true);

    expect(
      await screen.findByRole("dialog", { name: "Coda 0.2.0 is ready" }),
    ).toBeInTheDocument();
    expect(updaterMocks.checkForAppUpdate).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Later" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Coda 0.2.0 is ready" }),
      ).not.toBeInTheDocument();
    });
    expect(update.close).toHaveBeenCalledOnce();
  });

  it("focuses the explicit update action, dismisses with Escape, and restores prior focus", async () => {
    const user = userEvent.setup();
    const updateCheck = deferred<AppUpdate | undefined>();
    updaterMocks.checkForAppUpdate.mockReturnValue(updateCheck.promise);

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
    const downloadAndInstall = vi.fn(
      async (onProgress: (percentage: number) => void) => {
        onProgress(42);
        await new Promise<void>((resolve) => {
          finishDownload = resolve;
        });
      },
    );
    updaterMocks.checkForAppUpdate.mockResolvedValue(
      createUpdate({ downloadAndInstall }),
    );

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
    expect(updaterMocks.restartAfterUpdate).not.toHaveBeenCalled();

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
    updaterMocks.checkForAppUpdate.mockResolvedValue(undefined);

    renderUpdater();
    const checkButton = await screen.findByRole("button", {
      name: "Check for updates",
    });
    expect(updaterMocks.checkForAppUpdate).toHaveBeenCalledOnce();

    fireEvent.click(checkButton);

    expect(await screen.findByText("Coda is up to date.")).toBeInTheDocument();
    expect(updaterMocks.checkForAppUpdate).toHaveBeenCalledTimes(2);
  });

  it("shows an actionable message when a manual check fails", async () => {
    updaterMocks.checkForAppUpdate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("private updater detail"));

    renderUpdater();
    const checkButton = await screen.findByRole("button", {
      name: "Check for updates",
    });
    expect(updaterMocks.checkForAppUpdate).toHaveBeenCalledOnce();
    fireEvent.click(checkButton);

    expect(
      await screen.findByText(
        "Coda couldn’t check for updates. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("private updater detail")).not.toBeInTheDocument();
  });

  it("keeps an automatic check failure silent until the user asks to retry", async () => {
    updaterMocks.checkForAppUpdate.mockRejectedValue(
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
    const downloadAndInstall = vi
      .fn()
      .mockRejectedValueOnce(new Error("private installer detail"))
      .mockResolvedValueOnce(undefined);
    updaterMocks.checkForAppUpdate.mockResolvedValue(
      createUpdate({ downloadAndInstall }),
    );

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
    expect(downloadAndInstall).toHaveBeenCalledTimes(2);
  });

  it("retries a failed restart without downloading and installing again", async () => {
    const user = userEvent.setup();
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined);
    updaterMocks.restartAfterUpdate
      .mockRejectedValueOnce(new Error("private relaunch detail"))
      .mockResolvedValueOnce(undefined);
    updaterMocks.checkForAppUpdate.mockResolvedValue(
      createUpdate({ downloadAndInstall }),
    );

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
      expect(updaterMocks.restartAfterUpdate).toHaveBeenCalledTimes(2);
    });
    expect(downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("does not check or render update controls in a browser", async () => {
    updaterMocks.desktop = false;
    updaterMocks.checkForAppUpdate.mockResolvedValue(createUpdate());

    renderUpdater();

    await act(async () => {
      await Promise.resolve();
    });
    expect(updaterMocks.checkForAppUpdate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not call updater APIs in the development and automation flavor", async () => {
    updaterMocks.enabled = false;
    updaterMocks.checkForAppUpdate.mockResolvedValue(createUpdate());

    renderUpdater();

    await act(async () => {
      await Promise.resolve();
    });
    expect(updaterMocks.checkForAppUpdate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Check for updates" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
