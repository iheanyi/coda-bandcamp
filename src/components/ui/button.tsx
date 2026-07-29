import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center border font-bold whitespace-nowrap transition-colors duration-(--duration-coda-fast) outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default disabled:opacity-[0.38] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "border-0 bg-primary text-primary-foreground hover:bg-coda-primary-hover",
        secondary:
          "border-input bg-secondary text-secondary-foreground hover:bg-coda-secondary-hover",
        outline:
          "border-input bg-secondary text-secondary-foreground hover:bg-coda-secondary-hover",
        artwork:
          "border-input bg-coda-artwork-action text-coda-artwork-foreground hover:bg-coda-artwork-hover hover:text-coda-artwork-hover-foreground",
        danger:
          "border-primary/35 bg-primary/10 text-coda-danger-foreground hover:bg-primary/18",
        text: "border-0 bg-transparent text-muted-foreground hover:text-foreground",
        ghost:
          "border-0 bg-transparent text-muted-foreground hover:bg-coda-button-hover hover:text-foreground",
      },
      size: {
        compact: "h-8 gap-1.5 rounded-sm px-2.5 text-xs",
        default: "h-10 gap-2 rounded-md px-4 text-xs",
        icon: "size-8 rounded-md p-0",
        "icon-compact": "size-7 rounded-sm p-0",
        "icon-sm": "size-7 rounded-sm p-0",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "secondary",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
