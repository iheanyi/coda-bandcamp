import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RowPlaybackAction } from "./ItemInteractions";

describe("shared item interactions", () => {
  it("keeps the position and playback glyph mounted in one row action", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <RowPlaybackAction
        active={false}
        ariaLabel="Play In Motion"
        onClick={onClick}
        playing={false}
        position={3}
      />,
    );

    const action = screen.getByRole("button", { name: "Play In Motion" });
    expect(action).toHaveAttribute("data-slot", "row-playback-action");
    expect(
      action.querySelector('[data-slot="row-position"]'),
    ).toHaveTextContent("3");
    expect(action.querySelector('[data-slot="playback-icon"]')).toBeTruthy();
    expect(action).not.toHaveAttribute("data-active");
    fireEvent.click(action);
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <RowPlaybackAction
        active
        ariaLabel="Pause In Motion"
        onClick={onClick}
        playing
        position={3}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Pause In Motion" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Pause In Motion" }),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen
        .getByRole("button", { name: "Pause In Motion" })
        .querySelector('[data-slot="row-position"]'),
    ).toHaveTextContent("3");
  });
});
