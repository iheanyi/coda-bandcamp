import {
  forwardRef,
  type CSSProperties,
  type InputHTMLAttributes,
} from "react";
import { cn } from "./cn";

export type RangeControlProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "type"
> & {
  className?: string;
  label: string;
  percentage: number;
};

export const RangeControl = forwardRef<HTMLInputElement, RangeControlProps>(
  function RangeControl({ className, label, percentage, ...inputProps }, ref) {
    const boundedPercentage = Number.isFinite(percentage)
      ? Math.min(100, Math.max(0, percentage))
      : 0;

    return (
      <label
        className={cn("range", className)}
        style={
          {
            "--range-value": `${boundedPercentage}%`,
          } as CSSProperties
        }
      >
        <span className="sr-only">{label}</span>
        <input ref={ref} type="range" {...inputProps} />
      </label>
    );
  },
);
