import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { CodaMotionProvider } from "@/MotionProvider"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip"

describe("Tooltip", () => {
  it("preserves Base UI hover behavior through the Motion exit", async () => {
    const user = userEvent.setup()
    render(
      <CodaMotionProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>Queue</TooltipTrigger>
            <TooltipContent>Show queue</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CodaMotionProvider>
    )

    const trigger = screen.getByRole("button", { name: "Queue" })
    await user.hover(trigger)
    const tooltip = await screen.findByRole("tooltip")
    await waitFor(() => expect(tooltip).toBeVisible())

    await user.unhover(trigger)
    expect(tooltip).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
    )
  })
})
