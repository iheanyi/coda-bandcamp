import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";

import { PlaybackIcon } from "./playback-icon";

describe("PlaybackIcon", () => {
  it("settles on the latest transport state after rapid changes", async () => {
    const view = (playing: boolean) => (
      <CodaMotionProvider>
        <PlaybackIcon playing={playing} />
      </CodaMotionProvider>
    );
    const { container, rerender } = render(view(true));

    rerender(view(false));
    rerender(view(true));

    const icon = container.querySelector('[data-slot="playback-icon"]');
    expect(icon).toHaveAttribute("data-playing", "true");
    await waitFor(() => {
      expect(icon?.querySelector(".lucide-pause")).toBeInTheDocument();
      expect(icon?.querySelector(".lucide-play")).not.toBeInTheDocument();
    });
  });
});
