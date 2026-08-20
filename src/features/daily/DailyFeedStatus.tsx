import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function DailyFeedStatus({
  action,
  className,
  detail,
  icon,
  muted,
  role,
  title,
}: {
  action?: ReactNode;
  className?: string;
  detail?: string;
  icon: ReactNode;
  muted?: boolean;
  role?: "status";
  title: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-72 place-items-center text-center",
        muted && "text-muted-foreground",
        className,
      )}
      role={role}
    >
      <div>
        {icon}
        <strong
          className={cn("mt-3 block text-sm", muted && "text-foreground")}
        >
          {title}
        </strong>
        {detail ? (
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            {detail}
          </p>
        ) : null}
        {action}
      </div>
    </div>
  );
}
