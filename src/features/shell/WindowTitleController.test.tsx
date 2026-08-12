import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackClock } from "@/playbackClock";
import { WindowTitleController } from "./WindowTitleController";
import { applyCurrentNativeWindowTitle } from "./windowTitle";

const mocks = vi.hoisted(() => ({
  desktop: false,
  setTitle: vi.fn(),
}));

vi.mock("@/lib", () => ({
  isDesktop: () => mocks.desktop,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setTitle: mocks.setTitle }),
}));

describe("WindowTitleController", () => {
  beforeEach(() => {
    mocks.desktop = false;
    mocks.setTitle.mockReset().mockResolvedValue(undefined);
    document.title = "";
  });

  it("derives the web title from the active route subject", () => {
    render(
      <WindowTitleController
        activeArtistName="Night Archive"
        nowPlayingOpen={false}
        playbackClock={createPlaybackClock()}
        radioTimeline={[]}
        view="library"
      />,
    );

    expect(document.title).toBe("Night Archive — Coda");
    expect(mocks.setTitle).not.toHaveBeenCalled();
  });

  it("ignores a stale native title load after a newer route renders", async () => {
    let resolveOldWindow!: (window: {
      setTitle: typeof mocks.setTitle;
    }) => void;
    const oldWindow = new Promise<{ setTitle: typeof mocks.setTitle }>(
      (resolve) => {
        resolveOldWindow = resolve;
      },
    );
    let currentGeneration = 1;
    const applyOldTitle = applyCurrentNativeWindowTitle(
      "Old release — Coda",
      1,
      () => currentGeneration,
      () => oldWindow,
    );

    currentGeneration = 2;
    await applyCurrentNativeWindowTitle(
      "New release — Coda",
      2,
      () => currentGeneration,
      async () => ({ setTitle: mocks.setTitle }),
    );
    resolveOldWindow({ setTitle: mocks.setTitle });
    await applyOldTitle;

    expect(mocks.setTitle).toHaveBeenCalledOnce();
    expect(mocks.setTitle).toHaveBeenCalledWith("New release — Coda");
  });
});
