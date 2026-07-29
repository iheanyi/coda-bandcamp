import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { CodaMotionProvider } from "@/MotionProvider"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog"

function AlertDialogHarness() {
  return (
    <CodaMotionProvider>
      <AlertDialog>
        <AlertDialogTrigger>Delete playlist</AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogTitle>Delete Night drive?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the playlist from Bandcamp.
          </AlertDialogDescription>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Delete</AlertDialogAction>
        </AlertDialogContent>
      </AlertDialog>
    </CodaMotionProvider>
  )
}

describe("AlertDialog", () => {
  it("refuses Escape but exits through an explicit action", async () => {
    const user = userEvent.setup()
    render(<AlertDialogHarness />)

    const trigger = screen.getByRole("button", { name: "Delete playlist" })
    await user.click(trigger)
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete Night drive?",
    })
    await waitFor(() => expect(dialog).toBeVisible())
    expect(dialog).toHaveClass("top-1/2", "left-1/2", "-translate-1/2")
    expect(dialog.style.transform).toMatch(/^scale\(/)
    expect(dialog.style.transform).not.toContain("translate")
    expect(document.querySelector('[data-slot="alert-dialog-overlay"]'))
      .toHaveClass("inset-0")
    expect(document.querySelector('[data-slot="alert-dialog-overlay"]'))
      .not.toHaveClass("bottom-23")

    await user.keyboard("{Escape}")
    expect(dialog).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(dialog).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", {
        name: "Delete Night drive?",
      })).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()
  })
})
