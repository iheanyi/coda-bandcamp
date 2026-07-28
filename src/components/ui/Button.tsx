import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "./cn";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "artwork"
  | "danger"
  | "text"
  | "ghost";

type ButtonSize = "compact" | "default";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: ReactNode;
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: "primary-button ui-button--primary",
  secondary: "secondary-button ui-button--secondary",
  artwork: "artwork-button ui-button--artwork",
  danger: "danger-button ui-button--danger",
  text: "text-button ui-button--text",
  ghost: "ui-button--ghost",
};

const sizeClasses: Record<ButtonSize, string> = {
  compact: "ui-button--compact",
  default: "ui-button--default",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      children,
      leadingIcon,
      size,
      type = "button",
      variant = "secondary",
      ...props
    },
    ref,
  ) {
    const resolvedSize =
      size ??
      (variant === "danger" || variant === "text" ? "compact" : "default");

    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "ui-button",
          sizeClasses[resolvedSize],
          variantClasses[variant],
          className,
        )}
        {...props}
      >
        {leadingIcon}
        {children}
      </button>
    );
  },
);
