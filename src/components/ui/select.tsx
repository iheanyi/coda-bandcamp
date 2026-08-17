import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import * as m from "motion/react-m"

import { cn } from "@/lib/utils"
import { useCodaMotion } from "@/motion"
import { ChevronDownIcon, CheckIcon, ChevronUpIcon } from "lucide-react"

const SelectPresenceContext = React.createContext(false)

type SelectMotionElements = Readonly<{
  div: React.JSXElementConstructor<React.ComponentProps<typeof m.div>>
  span: React.JSXElementConstructor<React.ComponentProps<typeof m.span>>
}>

const DEFAULT_SELECT_MOTION_ELEMENTS = {
  div: m.div,
  span: m.span,
} satisfies SelectMotionElements

const SelectMotionElementsContext = React.createContext<SelectMotionElements>(
  DEFAULT_SELECT_MOTION_ELEMENTS
)

type SelectProps<Value, Multiple extends boolean | undefined> =
  SelectPrimitive.Root.Props<Value, Multiple> & {
    motionElements?: SelectMotionElements
  }

function Select<Value, Multiple extends boolean | undefined = false>({
  open: openProp,
  defaultOpen = false,
  motionElements = DEFAULT_SELECT_MOTION_ELEMENTS,
  onOpenChange,
  ...props
}: SelectProps<Value, Multiple>) {
  const [uncontrolledOpen, setUncontrolledOpen] =
    React.useState(defaultOpen)
  const open = openProp ?? uncontrolledOpen

  return (
    <SelectMotionElementsContext.Provider value={motionElements}>
      <SelectPresenceContext.Provider value={open}>
        <SelectPrimitive.Root
          open={open}
          onOpenChange={(nextOpen, details) => {
            if (openProp === undefined) setUncontrolledOpen(nextOpen)
            onOpenChange?.(nextOpen, details)
          }}
          {...props}
        />
      </SelectPresenceContext.Provider>
    </SelectMotionElementsContext.Provider>
  )
}

function SelectGroup({ className, ...props }: SelectPrimitive.Group.Props) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn("scroll-my-1 p-1", className)}
      {...props}
    />
  )
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      data-slot="select-value"
      className={cn("flex flex-1 text-left", className)}
      {...props}
    />
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  const open = React.useContext(SelectPresenceContext)
  const { span: MotionSpan } = React.useContext(SelectMotionElementsContext)
  const codaMotion = useCodaMotion()

  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)] *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon
        className="grid size-4 shrink-0 place-items-center self-center leading-none"
        data-slot="select-icon"
      >
        <MotionSpan
          aria-hidden="true"
          className="pointer-events-none grid size-full place-items-center text-muted-foreground"
          data-slot="select-chevron-motion"
          initial={false}
          animate={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)"
          }}
          transition={codaMotion.feedback}
        >
          <ChevronDownIcon className="size-4" />
        </MotionSpan>
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  alignItemWithTrigger = true,
  ...props
}: SelectPrimitive.Popup.Props &
  Pick<
    SelectPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
  >) {
  const open = React.useContext(SelectPresenceContext)
  const { div: MotionDiv } = React.useContext(SelectMotionElementsContext)
  const codaMotion = useCodaMotion()
  const animatePopup = !alignItemWithTrigger

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        alignItemWithTrigger={alignItemWithTrigger}
        className="isolate z-50"
      >
        <SelectPrimitive.Popup
          data-slot="select-content"
          data-align-trigger={alignItemWithTrigger}
          className={cn(
            "relative isolate z-50 max-h-(--available-height) w-(--anchor-width) min-w-36 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
            className
          )}
          {...props}
          render={
            <MotionDiv
              initial={{
                opacity: codaMotion.profile.component.opacityFrom,
                transform: animatePopup
                  ? `scale(${codaMotion.profile.component.scaleFrom})`
                  : "scale(1)"
              }}
              animate={{
                opacity: open ? 1 : codaMotion.profile.component.opacityFrom,
                transform:
                  open || !animatePopup
                    ? "scale(1)"
                    : `scale(${codaMotion.profile.component.scaleFrom})`
              }}
              transition={
                open ? codaMotion.componentEnter : codaMotion.componentExit
              }
              style={{
                pointerEvents: open ? "auto" : "none"
              }}
            />
          }
        >
          <SelectScrollUpButton />
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
          <SelectScrollDownButton />
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      data-slot="select-label"
      className={cn("px-1.5 py-1 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText className="flex flex-1 shrink-0 gap-2 whitespace-nowrap">
        {children}
      </SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator
        render={
          <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
        }
      >
        <CheckIcon className="pointer-events-none" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpArrow>) {
  return (
    <SelectPrimitive.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "top-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronUpIcon
      />
    </SelectPrimitive.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownArrow>) {
  return (
    <SelectPrimitive.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "bottom-0 z-10 flex w-full cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <ChevronDownIcon
      />
    </SelectPrimitive.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}

export type { SelectMotionElements }
