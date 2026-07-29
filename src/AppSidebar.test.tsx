import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { AppSidebar } from "./AppSidebar"

describe("Coda sidebar", () => {
  it("keeps navigation state and settings actions accessible", async () => {
    const user = userEvent.setup()
    const onView = vi.fn()
    const onConnect = vi.fn()

    render(
      <AppSidebar
        connected
        onConnect={onConnect}
        onView={onView}
        view="favorites"
      />,
    )

    expect(
      screen.getByRole("button", { name: "Favorites" }),
    ).toHaveAttribute("aria-current", "page")
    expect(screen.getByText("Bandcamp synced")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Bandcamp Radio" }))
    expect(onView).toHaveBeenCalledWith("radio")

    await user.click(screen.getByRole("button", {
      name: "Connection settings",
    }))
    expect(onConnect).toHaveBeenCalledOnce()
  })
})
