import * as React from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-1.5 text-xs leading-none font-semibold text-coda-label select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-[0.38]",
        className
      )}
      {...props}
    />
  )
}

export { Label }
