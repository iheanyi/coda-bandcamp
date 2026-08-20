import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function EmbeddedRouteStatus({
  action,
  className,
  detail,
  role,
  title,
  titleId,
}: {
  action?: ReactNode;
  className?: string;
  detail: string;
  role?: "alert" | "status";
  title: string;
  titleId: string;
}) {
  return (
    <section
      aria-labelledby={titleId}
      className={cn(
        "mx-auto grid min-h-72 max-w-xl place-items-center px-6 py-12 text-center",
        className,
      )}
      role={role}
    >
      <div>
        <h1
          className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-2xl font-semibold tracking-tight"
          id={titleId}
        >
          {title}
        </h1>
        <p className="mt-2 mb-0 text-sm text-muted-foreground">{detail}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </section>
  );
}
