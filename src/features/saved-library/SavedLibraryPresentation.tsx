import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

const eyebrowClassName =
  "mb-2.5 text-xs font-bold tracking-widest text-coda-subtle-foreground uppercase";

export function Eyebrow({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn(eyebrowClassName, className)} {...props} />;
}

export function SavedEmpty({
  icon,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-input bg-white/1 p-10 text-center text-muted-foreground">
      <span className="mb-4 grid size-14 place-items-center rounded-full border border-border bg-white/2.5 text-[#8d908b]">
        {icon}
      </span>
      <h2 className="m-0 font-display text-lg/tight font-semibold text-[#d7d6d0]">
        {title}
      </h2>
      <p className="mt-2 mb-4 max-w-sm text-xs/relaxed text-coda-subtle-foreground">
        {detail}
      </p>
      {action}
    </div>
  );
}

export function SavedSectionHeader({
  title,
  count,
}: {
  title: string;
  count: string;
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between">
      <h2 className="m-0 font-display text-base leading-none font-semibold tracking-tight">
        {title}
      </h2>
      <span className="text-xs text-[#6f736e]">{count}</span>
    </div>
  );
}
