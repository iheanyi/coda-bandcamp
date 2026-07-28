import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button";
import { Input } from "./Field";
import { IconButton } from "./IconButton";
import { RangeControl } from "./RangeControl";

describe("UI primitives", () => {
  it("composes secondary button classes and preserves button semantics", () => {
    render(
      <Button
        className="context-action"
        leadingIcon={<span aria-hidden="true">+</span>}
      >
        Add to queue
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Add to queue" });

    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass(
      "ui-button",
      "ui-button--default",
      "secondary-button",
      "ui-button--secondary",
      "context-action",
    );
  });

  it("keeps icon button state and contextual classes out of the DOM props", () => {
    render(
      <IconButton active className="player-action" aria-label="Shuffle">
        ↝
      </IconButton>,
    );

    const button = screen.getByRole("button", { name: "Shuffle" });
    expect(button).toHaveClass(
      "icon-button",
      "ui-icon-button",
      "ui-icon-button--default",
      "is-active",
      "player-action",
    );
    expect(button).not.toHaveAttribute("active");
  });

  it("forwards field attributes and contextual classes", () => {
    render(
      <Input
        className="connection-username"
        aria-label="Username"
        autoComplete="username"
      />,
    );

    expect(screen.getByLabelText("Username")).toHaveClass(
      "ui-field",
      "ui-field--input",
      "connection-username",
    );
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "autocomplete",
      "username",
    );
  });

  it.each([
    [125, "100%"],
    [-10, "0%"],
    [Number.NaN, "0%"],
  ])("bounds a %s range percentage to %s", (percentage, expected) => {
    const { container } = render(
      <RangeControl
        label="Volume"
        percentage={percentage}
        min="0"
        max="1"
      />,
    );

    expect(screen.getByLabelText("Volume")).toHaveAttribute("type", "range");
    expect(container.querySelector("label")).toHaveStyle({
      "--range-value": expected,
    });
  });
});
