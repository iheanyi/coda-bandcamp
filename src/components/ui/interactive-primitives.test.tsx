import * as React from "react"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function DialogHarness() {
  return (
    <Dialog>
      <DialogTrigger>Open settings</DialogTrigger>
      <DialogContent>
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Playback options</DialogDescription>
        <button type="button">First setting</button>
        <button type="button">Second setting</button>
      </DialogContent>
    </Dialog>
  )
}

function BusyDialogHarness() {
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(true)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && busy) {
          details.cancel()
          return
        }
        setOpen(nextOpen)
      }}
    >
      <DialogTrigger>Open saving dialog</DialogTrigger>
      <DialogContent>
        <DialogTitle>Saving playlist</DialogTitle>
        <button type="button" onClick={() => setBusy(false)}>
          Finish saving
        </button>
      </DialogContent>
    </Dialog>
  )
}

function AlertDialogHarness({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>Delete playlist</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Delete playlist?</AlertDialogTitle>
        <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel deletion</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete permanently</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function SliderHarness({
  className,
  disabled = false,
}: {
  className?: string
  disabled?: boolean
}) {
  const [value, setValue] = React.useState([0.72])
  const onValueChange = vi.fn((nextValue: readonly number[]) => setValue([...nextValue]))

  return (
    <>
      <Slider
        aria-label="Volume"
        className={className}
        disabled={disabled}
        max={1}
        min={0}
        onValueChange={onValueChange}
        step={0.01}
        value={value}
      />
      <output aria-label="Reported volume">{onValueChange.mock.calls.at(-1)?.[0]?.[0] ?? value[0]}</output>
    </>
  )
}

function RangeSliderHarness() {
  const [value, setValue] = React.useState([0.25, 0.75])

  return (
    <>
      <Slider
        aria-label="Playback segment"
        max={1}
        min={0}
        onValueChange={(nextValue) => setValue([...nextValue])}
        step={0.01}
        value={value}
      />
      <output aria-label="Reported segment">{value.join("–")}</output>
    </>
  )
}

describe("Coda interactive primitives", () => {
  it("restores focus after a dialog closes when playback settings is dismissed", async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    const trigger = screen.getByRole("button", { name: "Open settings" })
    await user.click(trigger)
    expect(screen.getByRole("dialog")).toBeVisible()

    await user.keyboard("{Escape}")

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("contains Tab and Shift+Tab navigation while a dialog is open", async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.click(screen.getByRole("button", { name: "Open settings" }))
    const first = screen.getByRole("button", { name: "First setting" })
    const second = screen.getByRole("button", { name: "Second setting" })
    const close = screen.getByRole("button", { name: "Close" })

    await waitFor(() => expect(first).toHaveFocus())
    await user.tab()
    expect(second).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab()
    await waitFor(() => expect(first).toHaveFocus())
    await user.tab({ shift: true })
    await waitFor(() => expect(close).toHaveFocus())
  })

  it("closes a dialog from its backdrop and Escape key", async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.click(screen.getByRole("button", { name: "Open settings" }))
    await user.click(document.body)
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    await user.click(screen.getByRole("button", { name: "Open settings" }))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("renders dialogs with Coda's backdrop, surface, density, and motion language", async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.click(screen.getByRole("button", { name: "Open settings" }))

    expect(document.querySelector("[data-slot=dialog-overlay]")).toHaveClass(
      "bottom-[92px]",
      "bg-[rgba(5,6,7,0.72)]",
      "backdrop-blur-[6px]",
      "duration-[130ms]",
      "motion-reduce:animate-none",
    )
    expect(screen.getByRole("dialog")).toHaveClass(
      "rounded-[11px]",
      "border",
      "border-[var(--line-strong)]",
      "bg-coda-radio",
      "p-6",
      "shadow-[0_26px_70px_rgba(0,0,0,0.45)]",
      "duration-[160ms]",
      "data-open:slide-in-from-bottom-2",
      "motion-reduce:animate-none",
    )
    expect(screen.getByRole("dialog")).not.toHaveClass(
      "rounded-xl",
      "duration-100",
      "data-open:zoom-in-95",
    )
  })

  it("positions the default dialog close control at Coda's legacy offset", async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)

    await user.click(screen.getByRole("button", { name: "Open settings" }))

    expect(screen.getByRole("button", { name: "Close" })).toHaveClass(
      "top-[13px]",
      "right-[13px]",
    )
  })

  it("keeps a controlled busy dialog open until its close change is allowed", async () => {
    const user = userEvent.setup()
    render(<BusyDialogHarness />)

    await user.click(screen.getByRole("button", { name: "Open saving dialog" }))
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeVisible()

    await user.click(screen.getByRole("button", { name: "Finish saving" }))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("calls alert cancel and confirm actions exactly once and closes after confirmation", async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<AlertDialogHarness onCancel={onCancel} onConfirm={onConfirm} />)

    await user.click(screen.getByRole("button", { name: "Delete playlist" }))
    await user.click(screen.getByRole("button", { name: "Cancel deletion" }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())

    await user.click(screen.getByRole("button", { name: "Delete playlist" }))
    await user.click(screen.getByRole("button", { name: "Delete permanently" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("renders alert dialogs with Coda's compact surface and motion language", async () => {
    const user = userEvent.setup()
    render(<AlertDialogHarness onCancel={() => undefined} onConfirm={() => undefined} />)

    await user.click(screen.getByRole("button", { name: "Delete playlist" }))

    expect(document.querySelector("[data-slot=alert-dialog-overlay]")).toHaveClass(
      "bottom-[92px]",
      "bg-[rgba(5,6,7,0.72)]",
      "backdrop-blur-[6px]",
      "duration-[130ms]",
      "motion-reduce:animate-none",
    )
    expect(screen.getByRole("alertdialog")).toHaveClass(
      "rounded-[11px]",
      "border",
      "border-[var(--line-strong)]",
      "bg-coda-radio",
      "p-6",
      "shadow-[0_26px_70px_rgba(0,0,0,0.45)]",
      "duration-[160ms]",
      "data-open:slide-in-from-bottom-2",
      "motion-reduce:animate-none",
    )
    expect(screen.getByRole("alertdialog")).not.toHaveClass(
      "rounded-xl",
      "duration-100",
      "data-open:zoom-in-95",
    )
  })

  it("reports continuous scalar slider changes and honors keyboard bounds", () => {
    render(<SliderHarness />)

    const slider = screen.getByRole("slider", { hidden: true })
    expect(slider).toHaveAttribute("aria-label", "Volume")
    slider.focus()
    fireEvent.keyDown(slider, { key: "ArrowRight" })
    expect(screen.getByRole("status", { name: "Reported volume" })).toHaveTextContent("0.73")

    fireEvent.keyDown(slider, { key: "End" })
    expect(slider).toHaveAttribute("aria-valuenow", "1")
    fireEvent.keyDown(slider, { key: "ArrowRight" })
    expect(slider).toHaveAttribute("aria-valuenow", "1")

    fireEvent.keyDown(slider, { key: "Home" })
    expect(slider).toHaveAttribute("aria-valuenow", "0")
  })

  it("lets a compact consumer width override the horizontal default", () => {
    const style = document.createElement("style")
    style.textContent = `
      .w-20 { width: 5rem; }
      .data-horizontal\\:w-full:where([data-orientation="horizontal"]) {
        width: 100%;
      }
    `
    document.head.append(style)

    try {
      render(<SliderHarness className="w-20" />)

      const root = screen.getByRole("group", { name: "Volume" })
      expect(getComputedStyle(root).width).toBe("5rem")
    } finally {
      style.remove()
    }
  })

  it("reports continuous array values while pointer-dragging the control", () => {
    render(<SliderHarness />)

    const root = screen.getByRole("group", { name: "Volume" })
    const control = root.querySelector<HTMLElement>(
      "[data-base-ui-slider-control]",
    )
    if (!control) throw new Error("Missing slider control")
    const thumb = root.querySelector<HTMLElement>("[data-slot=slider-thumb]")
    if (!thumb) throw new Error("Missing slider thumb")
    vi.spyOn(control, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 0, 100, 20))
    vi.spyOn(thumb, "getBoundingClientRect")
      .mockReturnValue(new DOMRect(0, 5, 10, 10))

    fireEvent.pointerDown(control, {
      button: 0,
      buttons: 1,
      clientX: 72,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    })
    fireEvent.pointerMove(document, {
      buttons: 1,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    })
    fireEvent.pointerUp(document, {
      button: 0,
      buttons: 0,
      clientX: 36.5,
      clientY: 10,
      pointerId: 1,
      pointerType: "mouse",
    })

    expect(screen.getByRole("status", { name: "Reported volume" }))
      .toHaveTextContent("0.35")
  })

  it("preserves multi-thumb array values for range sliders", () => {
    render(<RangeSliderHarness />)

    const [start] = screen.getAllByRole("slider", { hidden: true })
    start.focus()
    fireEvent.keyDown(start, { key: "ArrowRight" })

    expect(screen.getByRole("status", { name: "Reported segment" }))
      .toHaveTextContent("0.26–0.75")
  })

  it("renders the legacy Coda range density and visible focus treatment", () => {
    render(<SliderHarness />)

    expect(document.querySelector("[data-slot=slider-track]")).toHaveClass(
      "data-horizontal:h-[3px]",
      "bg-[#3a3d3f]",
    )
    expect(document.querySelector("[data-slot=slider-thumb]")).toHaveClass(
      "size-[10px]",
      "bg-[#e9e7e1]",
      "opacity-0",
      "group-hover/slider:opacity-100",
      "has-[input:focus-visible]:outline-2",
      "has-[input:focus-visible]:outline-ring",
      "has-[input:focus-visible]:outline-offset-2",
      "duration-(--duration-coda-fast)",
      "motion-reduce:transition-none",
    )
    expect(document.querySelector("[data-slot=slider-thumb]")).not.toHaveClass(
      "size-3",
      "focus-visible:ring-3",
    )
  })

  it("does not accept keyboard focus or changes while disabled", async () => {
    const user = userEvent.setup()
    render(<SliderHarness disabled />)

    const slider = screen.getByRole("slider", { hidden: true })
    slider.focus()
    expect(slider).not.toHaveFocus()
    await user.keyboard("{ArrowRight}")

    expect(slider).toHaveAttribute("aria-valuenow", "0.72")
    expect(screen.getByRole("status", { name: "Reported volume" })).toHaveTextContent("0.72")
  })

  it("keeps an icon tooltip trigger's accessible name independent from its tooltip", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger aria-label="Show queue">☰</TooltipTrigger>
          <TooltipContent>Queue</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    const trigger = screen.getByRole("button", { name: "Show queue" })
    await user.hover(trigger)

    expect(trigger).toHaveAttribute("aria-label", "Show queue")
    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip).toHaveTextContent("Queue")
    expect(tooltip).toHaveClass(
      "rounded-sm",
      "border",
      "border-border",
      "bg-coda-hover",
      "px-2",
      "py-1",
      "text-[10px]",
      "text-foreground",
      "duration-(--duration-coda-fast)",
      "motion-reduce:animate-none",
    )
    expect(tooltip).not.toHaveClass(
      "rounded-md",
      "px-3",
      "py-1.5",
      "text-xs",
      "data-open:zoom-in-95",
    )
  })
})
