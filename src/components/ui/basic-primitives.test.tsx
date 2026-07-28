import * as React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

describe("Coda foundational primitives", () => {
  it("keeps the primary button's high-emphasis Coda action treatment when its primary variant regresses", () => {
    render(<Button variant="primary">Save changes</Button>)

    expect(screen.getByRole("button", { name: "Save changes" })).toHaveClass(
      "h-[39px]",
      "rounded-md",
      "bg-primary",
      "text-primary-foreground",
      "font-bold",
      "focus-visible:outline-2",
      "focus-visible:outline-ring",
      "focus-visible:outline-offset-2",
      "duration-(--duration-coda-fast)",
    )
  })

  it("keeps the secondary button's bordered low-emphasis treatment when its secondary variant regresses", () => {
    render(<Button variant="secondary">Cancel</Button>)

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass(
      "border-input",
      "bg-secondary",
      "text-secondary-foreground",
    )
  })

  it("keeps the danger button's warning treatment when its danger variant regresses", () => {
    render(<Button variant="danger">Delete playlist</Button>)

    expect(screen.getByRole("button", { name: "Delete playlist" })).toHaveClass(
      "border-primary/35",
      "bg-primary/10",
      "text-coda-danger-foreground",
    )
  })

  it("keeps text and ghost buttons visually quiet when their low-emphasis variants regress", () => {
    render(
      <>
        <Button variant="text">View all</Button>
        <Button variant="ghost">More options</Button>
      </>,
    )

    expect(screen.getByRole("button", { name: "View all" })).toHaveClass(
      "bg-transparent",
      "text-muted-foreground",
    )
    expect(screen.getByRole("button", { name: "More options" })).toHaveClass(
      "hover:bg-coda-button-hover",
      "text-muted-foreground",
    )
  })

  it("renders the exact Coda artwork button contract when its album-action treatment regresses", () => {
    render(<Button variant="artwork">Shuffle all</Button>)

    expect(screen.getByRole("button", { name: "Shuffle all" })).toHaveClass(
      "h-[39px]",
      "rounded-md",
      "bg-coda-artwork-action",
      "text-coda-artwork-foreground",
    )
  })

  it("keeps icon, compact, icon-compact, and default button sizing distinct when control density regresses", () => {
    render(
      <>
        <Button size="icon" aria-label="Open queue" />
        <Button size="compact">Filter</Button>
        <Button size="icon-compact" aria-label="Close queue" />
        <Button>Default action</Button>
      </>,
    )

    expect(screen.getByRole("button", { name: "Open queue" })).toHaveClass(
      "size-8",
      "rounded-md",
    )
    expect(screen.getByRole("button", { name: "Filter" })).toHaveClass(
      "h-8",
      "rounded-sm",
      "text-[11px]",
    )
    expect(screen.getByRole("button", { name: "Close queue" })).toHaveClass(
      "size-7",
      "rounded-sm",
    )
    expect(screen.getByRole("button", { name: "Default action" })).toHaveClass(
      "h-[39px]",
      "px-[15px]",
      "border-input",
      "bg-secondary",
      "text-secondary-foreground",
    )
  })

  it("forwards a button ref to the interactive control when a consumer needs imperative focus", () => {
    const ref = React.createRef<HTMLButtonElement>()

    render(<Button ref={ref}>Focus me</Button>)

    expect(ref.current).toBe(screen.getByRole("button", { name: "Focus me" }))
  })

  it("keeps labels and fields explicitly associated when form relationships regress", () => {
    render(
      <>
        <Label htmlFor="username">Username</Label>
        <Input id="username" />
      </>,
    )

    expect(screen.getByLabelText("Username")).toHaveAttribute("id", "username")
  })

  it("preserves single-line and multiline native editing semantics when form primitives regress", async () => {
    const user = userEvent.setup()
    render(
      <>
        <Input aria-label="Playlist name" />
        <Textarea aria-label="Playlist description" />
      </>,
    )

    await user.type(screen.getByRole("textbox", { name: "Playlist name" }), "Road trip")
    await user.type(
      screen.getByRole("textbox", { name: "Playlist description" }),
      "Driving music",
    )

    expect(screen.getByRole("textbox", { name: "Playlist name" })).toHaveValue("Road trip")
    expect(screen.getByRole("textbox", { name: "Playlist description" })).toHaveValue(
      "Driving music",
    )
  })

  it("keeps the native select in keyboard tab order when sort navigation regresses", async () => {
    const user = userEvent.setup()
    render(
      <NativeSelect aria-label="Sort releases" defaultValue="recent">
        <NativeSelectOption value="recent">Recently added</NativeSelectOption>
        <NativeSelectOption value="artist">Artist</NativeSelectOption>
      </NativeSelect>,
    )

    await user.tab()
    const select = screen.getByRole("combobox", { name: "Sort releases" })
    expect(select).toHaveFocus()
  })

  it("preserves native select value changes when sort selection regresses", async () => {
    const user = userEvent.setup()
    render(
      <NativeSelect aria-label="Sort releases" defaultValue="recent">
        <NativeSelectOption value="recent">Recently added</NativeSelectOption>
        <NativeSelectOption value="artist">Artist</NativeSelectOption>
      </NativeSelect>,
    )

    const select = screen.getByRole("combobox", { name: "Sort releases" })
    await user.selectOptions(select, "artist")
    expect(select).toHaveValue("artist")
  })

  it("changes a toggle's pressed state when its filter action is activated", async () => {
    const user = userEvent.setup()
    render(<Toggle aria-label="Favorites filter">Favorites</Toggle>)

    const toggle = screen.getByRole("button", { name: "Favorites filter" })
    expect(toggle).toHaveClass(
      "focus-visible:outline-2",
      "focus-visible:outline-ring",
      "focus-visible:outline-offset-2",
    )
    expect(toggle).toHaveAttribute("aria-pressed", "false")

    await user.click(toggle)
    expect(toggle).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps a toggle group item's selected state when segmented filters regress", async () => {
    const user = userEvent.setup()
    render(
      <ToggleGroup aria-label="Release type" defaultValue={["albums"]}>
        <ToggleGroupItem value="albums">Albums</ToggleGroupItem>
        <ToggleGroupItem value="singles">Singles</ToggleGroupItem>
      </ToggleGroup>,
    )

    const albums = screen.getByRole("button", { name: "Albums" })
    const singles = screen.getByRole("button", { name: "Singles" })
    expect(albums).toHaveAttribute("aria-pressed", "true")
    expect(singles).toHaveAttribute("aria-pressed", "false")

    await user.click(singles)
    expect(singles).toHaveAttribute("aria-pressed", "true")
  })

  it("keeps a toggle group's configured item spacing when segmented layout density regresses", () => {
    render(
      <ToggleGroup aria-label="Release type" spacing={8}>
        <ToggleGroupItem value="albums">Albums</ToggleGroupItem>
        <ToggleGroupItem value="singles">Singles</ToggleGroupItem>
      </ToggleGroup>,
    )

    expect(screen.getByRole("group", { name: "Release type" })).toHaveStyle({
      gap: "8px",
    })
  })

  it("renders a compact status badge without inventing a control when metadata badges regress", () => {
    render(<Badge variant="success">Downloaded</Badge>)

    expect(screen.getByText("Downloaded")).toHaveClass(
      "rounded-sm",
      "bg-coda-success",
      "text-background",
    )
    expect(screen.queryByRole("button", { name: "Downloaded" })).not.toBeInTheDocument()
  })

  it("keeps loading primitives semantically exposed when loading feedback regresses", () => {
    render(
      <>
        <Skeleton aria-label="Album artwork loading" />
        <Spinner />
      </>,
    )

    expect(screen.getByLabelText("Album artwork loading")).toHaveClass(
      "animate-pulse",
      "bg-muted",
    )
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument()
  })

  it("preserves structural separator orientation when list dividers regress", () => {
    render(<Separator orientation="vertical" aria-label="Queue divider" />)

    expect(screen.getByRole("separator", { name: "Queue divider" })).toHaveAttribute(
      "data-orientation",
      "vertical",
    )
  })

  it("exposes inline error content through alert semantics when connection feedback regresses", () => {
    render(
      <Alert variant="danger">
        <AlertTitle>Could not connect</AlertTitle>
        <AlertDescription>Check the server URL and try again.</AlertDescription>
      </Alert>,
    )

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not connectCheck the server URL and try again.",
    )
    expect(screen.getByRole("alert")).toHaveClass(
      "border-primary/35",
      "text-coda-danger-foreground",
    )
  })
})
