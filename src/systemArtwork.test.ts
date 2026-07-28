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
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => "data:image/png;base64,Y29kYS1jb3Zlcg=="),
    };

    const result = createSystemArtworkDataUrl(
      {
        title: "First Light",
        artist: "Night Archive",
        palette: ["#dd6549", "#202326"],
      },
      () => canvas as unknown as HTMLCanvasElement,
    );

    expect(result).toBe("data:image/png;base64,Y29kYS1jb3Zlcg==");
    expect(canvas).toMatchObject({ width: 600, height: 600 });
    expect(addColorStop).toHaveBeenNthCalledWith(1, 0, "#202326");
    expect(addColorStop).toHaveBeenNthCalledWith(2, 1, "#dd6549");
    expect(context.fillText).toHaveBeenCalledWith("FL", 54, 144);
    expect(context.fillText).toHaveBeenCalledWith(
      "NIGHT ARCHIVE",
      54,
      552,
      492,
    );
    expect(canvas.toDataURL).toHaveBeenCalledExactlyOnceWith("image/png");
  });

  it("fails closed when canvas rendering is unavailable", () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => null),
      toDataURL: vi.fn(),
    };

    expect(
      createSystemArtworkDataUrl(
        {
          title: "First Light",
          artist: "Night Archive",
          palette: ["#dd6549", "#202326"],
        },
        () => canvas as unknown as HTMLCanvasElement,
      ),
    ).toBeUndefined();
    expect(canvas.toDataURL).not.toHaveBeenCalled();
  });
});
