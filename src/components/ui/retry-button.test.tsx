import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RetryButton } from "./retry-button";

describe("RetryButton", () => {
  it("shows the idle label and icon until the action is busy", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <RetryButton
        busy={false}
        busyLabel="Trying again…"
        label="Try again"
        onClick={onClick}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onClick).toHaveBeenCalledOnce();

    rerender(
      <RetryButton
        busy
        busyLabel="Trying again…"
        label="Try again"
        onClick={onClick}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Trying again…" }),
    ).toBeDisabled();
  });
});
