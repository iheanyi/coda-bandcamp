import { render, screen, within } from "@testing-library/react"
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
    const connectionSettings = screen.getByRole("button", {
      name: "Connection settings",
    })
    expect(connectionSettings).toHaveAttribute(
      "data-sidebar-connection",
      "",
    )
    expect(connectionSettings).toHaveClass(
      "h-auto",
      "w-full",
      "justify-start",
      "gap-2",
      "rounded-lg",
    )
    expect(
      within(connectionSettings).getByText("Bandcamp"),
    ).toBeInTheDocument()
    expect(
      within(connectionSettings).getByText("Synced"),
    ).toBeInTheDocument()
    expect(
      connectionSettings.querySelector('[data-slot="connection-status-icon"]'),
    ).toBeInTheDocument()
    expect(
      connectionSettings.querySelector('[data-slot="connection-settings-icon"]'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Bandcamp Radio" }))
    expect(onView).toHaveBeenCalledWith("radio")

    await user.click(connectionSettings)
    expect(onConnect).toHaveBeenCalledOnce()
  })
})
