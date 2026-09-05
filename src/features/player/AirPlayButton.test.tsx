import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AirPlayButton } from "./AirPlayButton";

describe("AirPlay output control", () => {
  it("opens the picker directly only when a track can be played", () => {
    const openPicker = vi.fn();
    const { rerender } = render(
      <AirPlayButton onClick={openPicker} compact disabled />,
    );

    const button = screen.getByRole("button", {
      name: "Choose AirPlay device",
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(openPicker).not.toHaveBeenCalled();

    rerender(<AirPlayButton onClick={openPicker} />);
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(openPicker).toHaveBeenCalledOnce();
  });
});
