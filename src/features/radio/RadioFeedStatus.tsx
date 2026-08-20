import type { ReactNode } from "react";

export function RadioFeedStatus({
  action,
  detail,
  icon,
  role,
  title,
}: {
  action?: ReactNode;
  detail: string;
  icon: ReactNode;
  role?: "alert" | "status";
  title: string;
}) {
  return (
    <div
      className="flex min-h-108 flex-col items-center justify-center text-center text-[#6e726d]"
      role={role}
    >
      {icon}
      <strong className="mt-3 text-base text-[#cac9c3]">{title}</strong>
      <span className="mt-1.5 max-w-md text-xs/normal text-coda-subtle-foreground">
        {detail}
      </span>
      {action}
    </div>
  );
}
