import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  size?: "compact" | "default";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { active = false, className, size = "default", type = "button", ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "icon-button ui-icon-button",
          size === "compact"
            ? "ui-icon-button--compact"
            : "ui-icon-button--default",
          active && "is-active",
          className,
        )}
        {...props}
      />
    );
  },
);
