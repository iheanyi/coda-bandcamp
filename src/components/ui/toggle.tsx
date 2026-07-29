"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-1 whitespace-nowrap transition-colors duration-(--duration-coda-fast) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-[0.38] aria-pressed:bg-coda-active aria-pressed:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-0 bg-transparent text-muted-foreground hover:text-foreground",
        outline: "border border-input bg-transparent text-muted-foreground hover:bg-coda-hover hover:text-foreground",
      },
      size: {
        default: "h-8 min-w-8 rounded-sm px-3 text-xs font-semibold",
        sm: "h-7 min-w-7 rounded-sm px-2 text-xs font-semibold",
        lg: "h-10 min-w-10 rounded-md px-4 text-xs font-bold",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
