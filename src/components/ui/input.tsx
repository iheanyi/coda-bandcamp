import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-sm border border-input bg-coda-field px-3 text-xs text-coda-field-foreground transition-colors duration-(--duration-coda-fast) outline-none placeholder:text-coda-field-placeholder focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-[0.38] aria-invalid:border-primary aria-invalid:ring-2 aria-invalid:ring-primary/10",
        className
      )}
      {...props}
    />
  )
}

export { Input }
