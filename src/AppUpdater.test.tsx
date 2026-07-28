import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppUpdate } from "./updater";

const updaterMocks = vi.hoisted(() => ({
  checkForAppUpdate: vi.fn(),
  desktop: true,
  restartAfterUpdate: vi.fn(),
}));

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
  useAppUpdater,
} from "./AppUpdater";

function UpdaterHarness() {
  const updater = useAppUpdater();
  return (
    <>
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

describe("app updater experience", () => {
  beforeEach(() => {
    updaterMocks.desktop = true;
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

  it("reports download progress and relaunches only after installation finishes", async () => {
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

    fireEvent.click(
      screen.getByRole("button", { name: "Download and install" }),
    );
    expect(
      await screen.findByText("Downloading update… 42%"),
    ).toBeInTheDocument();
    expect(prompt).toHaveAttribute("aria-busy", "true");
    expect(updaterMocks.restartAfterUpdate).not.toHaveBeenCalled();

    await act(async () => {
      finishDownload?.();
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Restart Coda" }),
    );

    await waitFor(() => {
      expect(updaterMocks.restartAfterUpdate).toHaveBeenCalledOnce();
    });
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
});
