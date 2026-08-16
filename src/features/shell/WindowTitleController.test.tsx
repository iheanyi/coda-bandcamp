import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaybackClock } from "@/playbackClock";
import { WindowTitleController } from "./WindowTitleController";
import { applyCurrentNativeWindowTitle } from "./windowTitle";

describe("WindowTitleController", () => {
  beforeEach(() => {
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
  });

  it("ignores a stale native title load after a newer route renders", async () => {
    const setTitle = vi.fn().mockResolvedValue(undefined);
    let resolveOldWindow!: (window: {
      setTitle: typeof setTitle;
    }) => void;
    const oldWindow = new Promise<{ setTitle: typeof setTitle }>(
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
      async () => ({ setTitle }),
    );
    resolveOldWindow({ setTitle });
    await applyOldTitle;

    expect(setTitle).toHaveBeenCalledOnce();
    expect(setTitle).toHaveBeenCalledWith("New release — Coda");
  });
});
