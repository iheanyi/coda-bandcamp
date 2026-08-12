import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId, type Ref } from "react";
import { LayoutGroup } from "motion/react";
import * as m from "motion/react-m";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDistanceAwareSelectionPill } from "@/selectionMotion";

export type ScrollableSelectionRailItem = Readonly<{
  disabled?: boolean;
  label: string;
  value: string;
}>;

export type ScrollableSelectionRailProps = Readonly<{
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  edges: Readonly<{
    end: boolean;
    start: boolean;
  }>;
  items: readonly ScrollableSelectionRailItem[];
  navClassName?: string;
  nextLabel?: string;
  onScroll: (rail: HTMLElement) => void;
  onScrollByDirection: (direction: -1 | 1) => void;
  onValueChange: (value: string) => void;
  previousLabel?: string;
  railRef?: Ref<HTMLElement>;
  value: string;
}>;

const INDICATOR_STYLE = {
  borderRadius: "var(--radius-sm)",
  boxShadow: "0 1px 4px rgba(0, 0, 0, 0.22)",
} as const;

/** A controlled, horizontally scrollable group of semantic toggle buttons. */
export function ScrollableSelectionRail({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  edges,
  items,
  navClassName,
  nextLabel = "Show more options",
  onScroll,
  onScrollByDirection,
  onValueChange,
  previousLabel = "Show previous options",
  railRef,
  value,
}: ScrollableSelectionRailProps) {
  const reactId = useId();
  const layoutGroupId = `selection-rail-${reactId}`;
  const indicatorLayoutId = `${layoutGroupId}-selected`;
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const indicatorMotion = useDistanceAwareSelectionPill(selectedIndex);

  return (
    <div className={cn("relative min-w-0", className)}>
      <LayoutGroup id={layoutGroupId}>
        <nav
          ref={railRef}
          aria-label={ariaLabel}
          className={cn(
            "flex items-center gap-1 overflow-x-auto overscroll-x-contain pr-10 scroll-px-10 scrollbar-none [&::-webkit-scrollbar]:hidden",
            navClassName,
          )}
          onScroll={(event) => onScroll(event.currentTarget)}
        >
          {items.map((item) => {
            const selected = item.value === value;

            return (
              <Button
                type="button"
                key={item.value}
                className="relative isolate h-8 shrink-0 px-3 text-xs font-semibold text-coda-selection-muted transition-colors duration-150 ease-out hover:bg-transparent hover:text-coda-selection-hover aria-pressed:text-coda-selection-foreground"
                onClick={() => onValueChange(item.value)}
                aria-pressed={selected}
                disabled={disabled || item.disabled}
                size="compact"
                variant="ghost"
              >
                {selected ? (
                  <m.div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 z-0 rounded-sm bg-coda-active"
                    data-selection-rail-indicator=""
                    data-selection-travel-steps={indicatorMotion.travelSteps}
                    layoutId={indicatorLayoutId}
                    style={INDICATOR_STYLE}
                    transition={indicatorMotion.transition}
                  />
                ) : null}
                <span className="relative z-10 transition-colors duration-150 ease-out">
                  {item.label}
                </span>
              </Button>
            );
          })}
        </nav>
      </LayoutGroup>
      {edges.start ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-background to-transparent"
          />
          <Button
            type="button"
            aria-label={previousLabel}
            className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-full border-border bg-[#1b1e20] text-[#9a9d98] shadow-md hover:bg-[#26292b] hover:text-[#efede7]"
            onClick={() => onScrollByDirection(-1)}
            size="icon-compact"
            variant="secondary"
          >
            <ChevronLeft aria-hidden="true" className="size-3.5" />
          </Button>
        </>
      ) : null}
      {edges.end ? (
        <>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-linear-to-l from-background to-transparent"
          />
          <Button
            type="button"
            aria-label={nextLabel}
            className="absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-full border-border bg-[#1b1e20] text-[#9a9d98] shadow-md hover:bg-[#26292b] hover:text-[#efede7]"
            onClick={() => onScrollByDirection(1)}
            size="icon-compact"
            variant="secondary"
          >
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </Button>
        </>
      ) : null}
    </div>
  );
}
