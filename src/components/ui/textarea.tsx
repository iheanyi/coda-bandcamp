import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-24 w-full rounded-sm border border-input bg-coda-field px-[11px] py-2 text-xs text-coda-field-foreground outline-none transition-colors duration-(--duration-coda-fast) placeholder:text-coda-field-placeholder focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-[0.38] aria-invalid:border-primary aria-invalid:ring-2 aria-invalid:ring-primary/10",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
