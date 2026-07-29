import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { CodaMotionProvider } from "@/MotionProvider"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select"

function SelectHarness() {
  const [value, setValue] = useState<string | null>(null)
  return (
    <CodaMotionProvider>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger aria-label="Genre">
          <SelectValue placeholder="Choose genre" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          <SelectItem value="Ambient">Ambient</SelectItem>
          <SelectItem value="Rock">Rock</SelectItem>
        </SelectContent>
      </Select>
    </CodaMotionProvider>
  )
}

describe("Select", () => {
  it("keeps Base UI selection and keyboard semantics with a Motion popup", async () => {
    const user = userEvent.setup()
    render(<SelectHarness />)

    const trigger = screen.getByRole("combobox", { name: "Genre" })
    await user.click(trigger)
    const listbox = await screen.findByRole("listbox")
    const popup = listbox.closest<HTMLElement>('[data-slot="select-content"]')
    expect(popup).not.toBeNull()
    await waitFor(() => expect(popup).toBeVisible())

    await user.click(screen.getByRole("option", { name: "Rock" }))

    expect(trigger).toHaveTextContent("Rock")
    expect(trigger).toHaveFocus()
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument()
    )
  })
})
