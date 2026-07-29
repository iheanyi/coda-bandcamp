import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Progress } from "./progress"

describe("Progress", () => {
  it("updates determinate progress with a compositor-only transform", () => {
    const { rerender } = render(
      <Progress aria-label="Download progress" value={42} />
    )
    const progress = screen.getByRole("progressbar", {
      name: "Download progress",
    })
    const indicator = progress.querySelector(
      '[data-slot="progress-indicator"]'
    )

    expect(progress).toHaveAttribute("aria-valuenow", "42")
    expect(indicator).toHaveStyle({
      width: "100%",
      transform: "scaleX(0.42)",
    })
    expect(indicator).toHaveClass("origin-left")
    expect(indicator).toHaveClass("transition-transform")
    expect(indicator).not.toHaveClass("transition-all")

    rerender(<Progress aria-label="Download progress" value={84} />)

    expect(progress).toHaveAttribute("aria-valuenow", "84")
    expect(indicator).toHaveStyle({
      width: "100%",
      transform: "scaleX(0.84)",
    })
  })

  it("normalizes custom ranges without changing progressbar semantics", () => {
    render(
      <Progress
        aria-label="Import progress"
        min={20}
        max={120}
        value={70}
      />
    )
    const progress = screen.getByRole("progressbar", {
      name: "Import progress",
    })
    const indicator = progress.querySelector(
      '[data-slot="progress-indicator"]'
    )

    expect(progress).toHaveAttribute("aria-valuemin", "20")
    expect(progress).toHaveAttribute("aria-valuemax", "120")
    expect(progress).toHaveAttribute("aria-valuenow", "70")
    expect(indicator).toHaveStyle({
      width: "100%",
      transform: "scaleX(0.5)",
    })
  })

  it("keeps indeterminate progress visible without a width transition", () => {
    render(<Progress aria-label="Loading" value={null} />)
    const progress = screen.getByRole("progressbar", { name: "Loading" })
    const indicator = progress.querySelector(
      '[data-slot="progress-indicator"]'
    )

    expect(progress).not.toHaveAttribute("aria-valuenow")
    expect(progress).toHaveAttribute("data-indeterminate")
    expect(indicator).toHaveAttribute("data-indeterminate")
    expect(indicator).toHaveStyle({
      width: "100%",
      transform: "scaleX(1)",
    })
    expect(indicator).toHaveClass("data-[indeterminate]:animate-pulse")
  })
})
