import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefCallback,
} from "react";
import { LayoutGroup, useReducedMotionConfig } from "motion/react";
import * as m from "motion/react-m";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDistanceAwareSelectionPill } from "@/selectionMotion";

export type ScrollableLinkSelectionRailItem<
  Value extends string | number = string,
> = Readonly<{
  label: string;
  value: Value;
}>;

type LinkRenderState = Readonly<{
  children: ReactNode;
  className: string;
  ref: RefCallback<HTMLAnchorElement>;
  selected: boolean;
}>;

export type ScrollableLinkSelectionRailProps<
  Value extends string | number = string,
> = Readonly<{
  "aria-label": string;
  busy?: boolean;
  className?: string;
  indicatorClassName?: string;
  indicatorDataAttributes?: Readonly<
    Record<`data-${string}`, string | number | undefined>
  >;
  indicatorMotionDataAttribute?: `data-${string}`;
  items: readonly ScrollableLinkSelectionRailItem<Value>[];
  layoutGroupId?: string;
  linkClassName?: string;
  navClassName?: string;
  navDataAttributes?: Readonly<
    Record<`data-${string}`, string | number | undefined>
  >;
  nextLabel?: string;
  previousLabel?: string;
  renderLink: (
    item: ScrollableLinkSelectionRailItem<Value>,
    state: LinkRenderState,
  ) => ReactNode;
  value?: Value;
  travelSteps?: number;
}>;

const INITIAL_EDGES = Object.freeze({ end: false, start: false });

function reducedMotionPreferred(): boolean {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

/** A horizontally scrollable route-link rail with a shared traveling pill. */
export function ScrollableLinkSelectionRail<Value extends string | number>({
  "aria-label": ariaLabel,
  busy = false,
  className,
  indicatorClassName,
  indicatorDataAttributes,
  indicatorMotionDataAttribute,
  items,
  layoutGroupId: suppliedLayoutGroupId,
  linkClassName,
  navClassName,
  navDataAttributes,
  nextLabel = "Show more destinations",
  previousLabel = "Show previous destinations",
  renderLink,
  value,
  travelSteps,
}: ScrollableLinkSelectionRailProps<Value>) {
  const reactId = useId();
  const layoutGroupId =
    suppliedLayoutGroupId ?? `link-selection-rail-${reactId}`;
  const indicatorLayoutId = `${layoutGroupId}-selected`;
  const railRef = useRef<HTMLElement>(null);
  const selectedLinkRef = useRef<HTMLAnchorElement | null>(null);
  const [edges, setEdges] = useState<
    Readonly<{
      end: boolean;
      start: boolean;
    }>
  >(INITIAL_EDGES);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const indicatorMotion = useDistanceAwareSelectionPill(
    selectedIndex,
    travelSteps,
  );
  const reduceMotion = useReducedMotionConfig() === true;

  const updateEdges = useCallback((rail: HTMLElement) => {
    const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const nextEdges = {
      start: rail.scrollLeft > 1,
      end: rail.scrollLeft < maxScrollLeft - 1,
    };
    setEdges((current) =>
      current.start === nextEdges.start && current.end === nextEdges.end
        ? current
        : nextEdges,
    );
  }, []);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const syncEdges = () => updateEdges(rail);
    syncEdges();
    window.addEventListener("resize", syncEdges);
    return () => window.removeEventListener("resize", syncEdges);
  }, [items, updateEdges]);

  useLayoutEffect(() => {
    selectedLinkRef.current?.scrollIntoView({
      behavior: reducedMotionPreferred() ? "auto" : "smooth",
      block: "nearest",
      inline: "nearest",
    });
  }, [value]);

  const scroll = useCallback(
    (direction: -1 | 1) => {
      const rail = railRef.current;
      if (!rail) return;
      const left =
        rail.scrollLeft +
        direction * Math.max(160, Math.round(rail.clientWidth * 0.7));
      const supportsScrollTo = Boolean(rail.scrollTo);
      if (supportsScrollTo) {
        rail.scrollTo({
          behavior: reducedMotionPreferred() ? "auto" : "smooth",
          left,
        });
        return;
      }
      rail.scrollLeft = left;
      updateEdges(rail);
    },
    [updateEdges],
  );

  return (
    <div className={cn("relative min-w-0", className)}>
      <LayoutGroup id={layoutGroupId}>
        <nav
          {...navDataAttributes}
          ref={railRef}
          aria-busy={busy || undefined}
          aria-label={ariaLabel}
          className={cn(
            "isolate flex min-w-0 items-center gap-1 overflow-x-auto overscroll-x-contain pr-10 scroll-px-10 scrollbar-none [&::-webkit-scrollbar]:hidden",
            navClassName,
          )}
          onScroll={(event) => updateEdges(event.currentTarget)}
        >
          {items.map((item) => {
            const selected = item.value === value;
            const children = (
              <>
                {selected ? (
                  <m.span
                    {...(indicatorMotionDataAttribute
                      ? {
                          [indicatorMotionDataAttribute]: reduceMotion
                            ? "snap"
                            : "spring",
                        }
                      : {})}
                    {...indicatorDataAttributes}
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-0 z-10 rounded-md border border-primary/20 bg-accent",
                      indicatorClassName,
                    )}
                    data-selection-link-rail-indicator=""
                    data-selection-indicator-motion={
                      reduceMotion ? "snap" : "spring"
                    }
                    data-selection-travel-steps={indicatorMotion.travelSteps}
                    layoutId={indicatorLayoutId}
                    transition={indicatorMotion.transition}
                  />
                ) : null}
                <span className="relative z-20 transition-colors duration-150 ease-out">
                  {item.label}
                </span>
              </>
            );
            return renderLink(item, {
              children,
              className: cn(
                buttonVariants({ variant: "ghost", size: "compact" }),
                // The shared indicator must escape the selected link while its
                // layout transform crosses sibling links. The rail isolates its
                // z-index, while every label stays above the traveling tint.
                "relative h-8 shrink-0 rounded-md border border-transparent px-2.5 text-xs text-coda-selection-muted hover:border-(--line) hover:bg-white/2.5 hover:text-coda-selection-hover",
                selected &&
                  "border-transparent text-coda-selection-foreground hover:border-transparent hover:bg-transparent hover:text-coda-selection-foreground",
                linkClassName,
              ),
              ref: (node) => {
                if (selected) selectedLinkRef.current = node;
              },
              selected,
            });
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
            onClick={() => scroll(-1)}
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
            onClick={() => scroll(1)}
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
