import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type LibrarySkeletonProps = {
  label?: string;
  className?: string;
};

export function LibrarySkeleton({
  label = "Loading your collection",
  className,
}: LibrarySkeletonProps) {
  const shimmerClassName =
    "relative overflow-hidden rounded-sm bg-[#202325] animate-none after:block after:h-full after:w-[45%] after:translate-x-[-120%] after:bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.045),transparent)] after:animate-[skeleton-shimmer_1.4s_ease-in-out_infinite] after:content-[''] motion-reduce:after:animate-none";

  return (
    <section
      aria-busy="true"
      aria-label={label}
      className={className}
      role="status"
    >
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-3 gap-y-5 pt-7 lg:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] lg:gap-x-4 lg:gap-y-6 xl:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]"
        aria-hidden="true"
      >
        {Array.from({ length: 10 }, (_, index) => (
          <div className="flex flex-col gap-2" key={index}>
            <Skeleton className={`${shimmerClassName} aspect-square w-full`} />
            <Skeleton className={`${shimmerClassName} h-2.5 w-[72%]`} />
            <Skeleton className={`${shimmerClassName} h-2 w-[48%]`} />
          </div>
        ))}
      </div>
    </section>
  );
}

export type LibraryEmptyStateProps = {
  icon: ReactNode;
  title: string;
  detail: string;
  action?: ReactNode;
  className?: string;
};

export function LibraryEmptyState({
  icon,
  title,
  detail,
  action,
  className,
}: LibraryEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-72 flex-col items-center justify-center text-center text-[#696d68]",
        className,
      )}
    >
      <span className="grid size-14 place-items-center rounded-full border border-border bg-white/[0.018] text-[#787c77]">
        {icon}
      </span>
      <h3 className="mt-4 mb-1 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base/tight font-semibold text-[#c7c8c2]">
        {title}
      </h3>
      <p className="m-0 max-w-xs text-xs text-[#777a76]">{detail}</p>
      {action}
    </div>
  );
}
