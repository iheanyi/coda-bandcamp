import { RefreshCw } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function RetryButton({
  busy,
  busyLabel,
  className,
  iconSize = 14,
  label,
  onClick,
  variant,
}: {
  busy: boolean;
  busyLabel: string;
  className?: string;
  iconSize?: number;
  label: string;
  onClick: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
}) {
  return (
    <Button
      className={className}
      disabled={busy}
      onClick={onClick}
      size="compact"
      variant={variant}
    >
      {busy ? (
        <Spinner
          aria-hidden="true"
          className={
            iconSize > 14
              ? "size-4 text-current motion-reduce:animate-none"
              : "size-3.5 text-current motion-reduce:animate-none"
          }
        />
      ) : (
        <RefreshCw size={iconSize} />
      )}
      {busy ? busyLabel : label}
    </Button>
  );
}
