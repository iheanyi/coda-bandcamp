import { act, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CodaMotionProvider } from "@/MotionProvider"

import { Toaster } from "./toast"
import { createToastManager } from "./toastManager"

function renderToaster() {
  const toastManager = createToastManager()

  render(
    <CodaMotionProvider>
      <Toaster toastManager={toastManager} timeout={2_800} />
    </CodaMotionProvider>
  )

  return toastManager
}

describe("Toaster", () => {
  it("preserves actions, urgent announcements, and manager-owned dismissal", async () => {
    const toastManager = renderToaster()
    const onAction = vi.fn()

    let toastId = ""
    act(() => {
      toastId = toastManager.add({
        title: "Connection failed",
        description: "Try again.",
        priority: "high",
        actionProps: {
          children: "Retry",
          onClick: onAction,
        },
      })
    })

    const announcement = await screen.findByRole("alert")
    expect(announcement).toHaveTextContent("Connection failed")

    const retry = screen.getByRole("button", { name: "Retry", hidden: true })
    act(() => retry.click())
    expect(onAction).toHaveBeenCalledOnce()

    act(() => toastManager.close(toastId))
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Retry", hidden: true }))
        .not.toBeInTheDocument()
    })
  })

})
