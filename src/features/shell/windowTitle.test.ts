import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getWindowTitle,
  publishDocumentTitle,
  publishNativeWindowTitle,
  resetNativeTitleWindowCache,
} from "./windowTitle";

describe("window title", () => {
  beforeEach(() => {
    resetNativeTitleWindowCache();
  });

  it("writes the document title before returning", () => {
    publishDocumentTitle("Knxwledge. — Coda");
    expect(document.title).toBe("Knxwledge. — Coda");
  });

  it("uses the artist name when no album is the active route", () => {
    expect(
      getWindowTitle({
        activeArtistName: "Knxwledge.",
        nowPlayingOpen: false,
        view: "library",
      }),
    ).toBe("Knxwledge. — Coda");
  });

  it("prefers the active album over an artist name", () => {
    expect(
      getWindowTitle({
        activeArtistName: "Knxwledge.",
        nowPlayingOpen: false,
        selectedAlbumTitle: "HX.26",
        view: "library",
      }),
    ).toBe("HX.26 — Coda");
  });

  it("invokes setTitle on a cached window without waiting to load again", async () => {
    const setTitle = vi.fn().mockResolvedValue(undefined);
    const loadWindow = vi.fn(async () => ({ setTitle }));

    publishNativeWindowTitle("HX.26 — Coda", 1, () => 1, loadWindow);
    expect(setTitle).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(setTitle).toHaveBeenCalledWith("HX.26 — Coda"),
    );

    setTitle.mockClear();
    loadWindow.mockClear();
    publishNativeWindowTitle("Knxwledge. — Coda", 2, () => 2, loadWindow);
    expect(setTitle).toHaveBeenCalledWith("Knxwledge. — Coda");
    expect(loadWindow).not.toHaveBeenCalled();
  });
});
