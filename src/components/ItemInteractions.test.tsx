import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CardActionOverlay,
  RowActionGroup,
  RowPlaybackAction,
} from "./ItemInteractions";
import { Button } from "./ui/button";

describe("shared item interactions", () => {
  it("keeps the card overlay in an absolute, pointer-safe layer", () => {
    render(
      <article className="group/card relative">
        <CardActionOverlay visible>
          <Button aria-label="Play release">Play</Button>
        </CardActionOverlay>
      </article>,
    );

    const overlay = screen.getByRole("button", {
      name: "Play release",
    }).parentElement?.parentElement;
    expect(overlay).toHaveAttribute("data-slot", "card-action-overlay");
    expect(overlay).toHaveAttribute("data-visible", "true");
    expect(overlay).toHaveClass("absolute", "pointer-events-none");
    expect(overlay?.firstElementChild).toHaveAttribute(
      "data-slot",
      "card-action-overlay-content",
    );
  });

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

  it("provides a stable action group slot", () => {
    render(
      <RowActionGroup>
        <Button aria-label="Queue track">Queue</Button>
        <Button aria-label="Favorite track">Favorite</Button>
      </RowActionGroup>,
    );

    const group = screen.getByRole("button", {
      name: "Queue track",
    }).parentElement;
    expect(group).toHaveAttribute("data-slot", "row-action-group");
    expect(group).toHaveClass("grid");
    expect(
      screen.getByRole("button", { name: "Favorite track" }),
    ).toBeVisible();
  });
});
