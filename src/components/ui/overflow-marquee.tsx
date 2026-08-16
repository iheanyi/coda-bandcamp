import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ComponentPropsWithoutRef,
} from "react";
import { cn } from "@/lib/utils";

type OverflowMarqueeStaticTextProps = ComponentPropsWithoutRef<"span"> & {
  [attribute: `data-${string}`]: string | number | undefined;
};

type OverflowMarqueeStyle = CSSProperties & {
  "--marquee-duration": string;
};

export function OverflowMarquee({
  className,
  staticTextProps,
  text,
}: {
  className?: string;
  staticTextProps?: OverflowMarqueeStaticTextProps;
  text: string;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const measure = useCallback(() => {
    const element = textRef.current;
    setOverflowing(Boolean(
      element && element.scrollWidth > element.clientWidth + 1,
    ));
  }, []);

  useLayoutEffect(() => {
    measure();
    if (!globalThis.ResizeObserver || !textRef.current) return;
    const observer = new globalThis.ResizeObserver(measure);
    observer.observe(textRef.current);
    return () => observer.disconnect();
  }, [measure, text]);

  const marqueeStyle: OverflowMarqueeStyle = {
    "--marquee-duration": `${Math.max(6, text.length / 7)}s`,
  };

  return (
    <span
      className={cn(
        "group/marquee relative block min-w-0 max-w-full overflow-hidden whitespace-nowrap",
        className,
      )}
      data-overflowing={overflowing || undefined}
      data-testid="overflow-marquee"
      style={marqueeStyle}
    >
      <span
        {...staticTextProps}
        ref={textRef}
        className={cn(
          "block truncate",
          overflowing && "group-hover/marquee:opacity-0 group-focus-within/marquee:opacity-0",
          staticTextProps?.className,
        )}
        data-slot="overflow-marquee-text"
        title={overflowing ? text : undefined}
      >
        {text}
      </span>
      {overflowing ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-max opacity-0 group-hover/marquee:animate-[coda-title-marquee_var(--marquee-duration)_linear_infinite] group-hover/marquee:opacity-100 group-focus-within/marquee:animate-[coda-title-marquee_var(--marquee-duration)_linear_infinite] group-focus-within/marquee:opacity-100"
          data-slot="overflow-marquee-track"
          data-testid="overflow-marquee-track"
        >
          <span className="pr-8">{text}</span>
          <span className="pr-8">{text}</span>
        </span>
      ) : null}
    </span>
  );
}
