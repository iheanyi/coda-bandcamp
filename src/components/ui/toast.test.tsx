import { act, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { CodaMotionProvider } from "@/MotionProvider"

import { createToastManager, Toaster } from "./toast"

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
  it("keeps Base UI on the inner swipe root and Motion on an outer presence wrapper", async () => {
    const toastManager = renderToaster()

    act(() => {
      toastManager.add({
        title: "Library updated",
        description: "Three albums were added.",
      })
    })

    const toast = await screen.findByRole("dialog", {
      name: "Library updated",
    })
    const presenceWrapper = toast.parentElement

    expect(toast).toHaveAttribute("data-slot", "toast")
    expect(toast).toHaveStyle({
      "--toast-swipe-movement-x": "0px",
      "--toast-swipe-movement-y": "0px",
    })
    expect(presenceWrapper).toHaveAttribute("data-slot", "toast-motion")
    await waitFor(() => expect(presenceWrapper).toBeVisible())
    expect(toast.className).not.toContain("will-change")
    expect(toast.className).not.toContain("height_var")
  })

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

  it("updates promise and loading content in the existing toast", async () => {
    const toastManager = renderToaster()
    let resolveSync: (() => void) | undefined
    const sync = new Promise<void>((resolve) => {
      resolveSync = resolve
    })

    let handledSync: Promise<void> | undefined
    act(() => {
      handledSync = toastManager.promise(sync, {
        loading: "Syncing library",
        success: "Library synced",
        error: "Library sync failed",
      })
    })

    const loadingTitle = await screen.findByText("Syncing library")
    const toast = loadingTitle.closest("[data-slot='toast']")
    const presenceWrapper = toast?.parentElement

    expect(toast).toHaveAttribute("data-type", "loading")
    expect(toast?.querySelector(".lucide-loader-circle")).toBeInTheDocument()

    await act(async () => {
      resolveSync?.()
      await handledSync
    })

    const successTitle = await screen.findByText("Library synced")
    expect(successTitle.closest("[data-slot='toast']")?.parentElement)
      .toBe(presenceWrapper)
    expect(successTitle.closest("[data-slot='toast']"))
      .toHaveAttribute("data-type", "success")
  })
})
