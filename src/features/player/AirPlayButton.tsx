import { Airplay } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function AirPlayButton({
  onClick,
  disabled = false,
  compact = false,
}: {
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const label = "Choose AirPlay device";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="secondary"
            size="compact"
            className={cn(
              "h-9 gap-2 rounded-md border-input bg-transparent font-medium text-muted-foreground hover:bg-coda-button-hover hover:text-foreground",
              compact && "w-9 px-0 xl:w-auto xl:px-2.5",
            )}
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
          />
        }
      >
        <Airplay className="size-4.5" aria-hidden="true" />
        <span className={compact ? "hidden xl:inline" : undefined}>
          AirPlay
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
