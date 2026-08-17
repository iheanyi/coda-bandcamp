import { describe, expect, it, vi } from "vitest";
import { createSystemArtworkDataUrl } from "./systemArtwork";

describe("system artwork", () => {
  it("renders Coda's generated cover language into a square PNG", () => {
    const addColorStop = vi.fn();
    const context = {
      createLinearGradient: vi.fn(() => ({ addColorStop })),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn(() => ({ width: 140 })),
      fillStyle: "",
      font: "",
      letterSpacing: "",
      textBaseline: "",
    };
    const canvas = document.createElement("canvas");
    const getContext = vi.fn(() => context);
    const toDataURL = vi.fn(() => "data:image/png;base64,Y29kYS1jb3Zlcg==");
    Object.defineProperties(canvas, {
      getContext: { configurable: true, value: getContext },
      toDataURL: { configurable: true, value: toDataURL },
    });

    const result = createSystemArtworkDataUrl(
      {
        title: "First Light",
        artist: "Night Archive",
        palette: ["#dd6549", "#202326"],
      },
      () => canvas,
    );

    expect(result).toBe("data:image/png;base64,Y29kYS1jb3Zlcg==");
    expect(canvas).toMatchObject({ width: 600, height: 600 });
    expect(toDataURL).toHaveBeenCalledExactlyOnceWith("image/png");
  });

  it("fails closed when canvas rendering is unavailable", () => {
    const canvas = document.createElement("canvas");
    const getContext = vi.fn(() => null);
    const toDataURL = vi.fn();
    Object.defineProperties(canvas, {
      getContext: { configurable: true, value: getContext },
      toDataURL: { configurable: true, value: toDataURL },
    });

    expect(
      createSystemArtworkDataUrl(
        {
          title: "First Light",
          artist: "Night Archive",
          palette: ["#dd6549", "#202326"],
        },
        () => canvas,
      ),
    ).toBeUndefined();
    expect(toDataURL).not.toHaveBeenCalled();
  });
});
