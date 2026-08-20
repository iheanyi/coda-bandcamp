import type { ReactNode } from "react";

export function DiscoverFeedStatus({
  action,
  detail,
  icon,
  title,
}: {
  action?: ReactNode;
  detail?: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <div className="flex min-h-80 flex-col items-center justify-center text-center text-[#6e726d]">
      {icon}
      <strong className="mt-3 text-sm text-[#c8c7c1]">{title}</strong>
      {detail ? (
        <span className="mt-1 max-w-sm text-xs text-[#747873]">{detail}</span>
      ) : null}
      {action}
    </div>
  );
}
