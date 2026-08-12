import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useRef, useState } from "react"
import { describe, expect, it } from "vitest"

import { CodaMotionProvider } from "@/MotionProvider"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog"

function AlertDialogHarness() {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <CodaMotionProvider>
      <button ref={triggerRef} type="button" onClick={() => setOpen(true)}>
        Delete playlist
      </button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent finalFocus={triggerRef}>
          <AlertDialogTitle>Delete this playlist?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone.
          </AlertDialogDescription>
          <AlertDialogCancel>Keep playlist</AlertDialogCancel>
        </AlertDialogContent>
      </AlertDialog>
    </CodaMotionProvider>
  )
}

describe("AlertDialog", () => {
  it("keeps its portal mounted through exit, then restores trigger focus", async () => {
    const user = userEvent.setup()
    render(<AlertDialogHarness />)

    const trigger = screen.getByRole("button", { name: "Delete playlist" })
    await user.click(trigger)
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete this playlist?",
    })
    const portal = document.querySelector(
      '[data-slot="alert-dialog-portal"]'
    )

    expect(portal).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep playlist" }))

    expect(dialog).toBeInTheDocument()
    expect(portal).toBeInTheDocument()
    await waitFor(() => {
      expect(
        screen.queryByRole("alertdialog", { name: "Delete this playlist?" })
      ).not.toBeInTheDocument()
    })
    expect(document.querySelector('[data-slot="alert-dialog-portal"]'))
      .not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("keeps a rapidly reopened dialog mounted when a stale exit settles", async () => {
    const user = userEvent.setup()
    render(<AlertDialogHarness />)

    const trigger = screen.getByRole("button", { name: "Delete playlist" })
    await user.click(trigger)
    await user.click(
      await screen.findByRole("button", { name: "Keep playlist" })
    )
    await user.click(trigger)

    await waitFor(() =>
      expect(
        screen.getByRole("alertdialog", { name: "Delete this playlist?" })
      ).toBeVisible()
    )
    expect(document.querySelector('[data-slot="alert-dialog-portal"]'))
      .toBeInTheDocument()
  })
})
