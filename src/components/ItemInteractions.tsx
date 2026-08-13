import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { cn } from "@/lib/utils";

type CardActionOverlayProps = Readonly<{
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  scrim?: boolean;
  visible?: boolean;
}>;

/**
 * A compositor-only card scrim and action reveal. The card root owns layout
 * through `group/card`; this layer stays absolute so revealing it never moves
 * the card's content.
 */
export function CardActionOverlay({
  children,
  className,
  contentClassName,
  scrim = true,
  visible = false,
}: CardActionOverlayProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-2 flex items-end justify-end rounded-[inherit] p-2",
        scrim &&
          "bg-[linear-gradient(to_bottom,transparent_42%,rgba(7,8,9,0.72)_100%)]",
        className,
      )}
      data-slot="card-action-overlay"
      data-visible={visible || undefined}
    >
      <div
        className={cn(
          "pointer-events-none origin-bottom-right",
          contentClassName,
        )}
        data-slot="card-action-overlay-content"
        data-visible={visible || undefined}
      >
        {children}
      </div>
    </div>
  );
}

type RowPlaybackActionProps = Readonly<{
  active: boolean;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
  playing: boolean;
  position: ReactNode;
}>;

/**
 * Keeps the row position and playback glyph in the same fixed box, then fades
 * between them on hover or keyboard focus without toggling display or layout.
 */
export function RowPlaybackAction({
  active,
  ariaLabel,
  className,
  disabled,
  onClick,
  playing,
  position,
}: RowPlaybackActionProps) {
  return (
    <Button
      aria-label={ariaLabel}
      aria-pressed={active && playing}
      className={cn(
        "group/playback relative size-full rounded-none p-0 text-xs font-normal text-[#777a76] hover:bg-transparent focus-visible:z-1 focus-visible:outline-offset-0",
        active && "text-[#e88c75]",
        className,
      )}
      data-slot="row-playback-action"
      data-active={active || undefined}
      disabled={disabled}
      onClick={onClick}
      variant="ghost"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center"
        data-slot="row-position"
      >
        {position}
      </span>
      <PlaybackIcon
        className="absolute inset-0 m-auto size-3.5"
        playing={active && playing}
      />
    </Button>
  );
}

type RowActionGroupProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

/** A stable action slot with the same restrained press/hover choreography. */
export function RowActionGroup({ children, className }: RowActionGroupProps) {
  return (
    <div
      className={cn(
        "grid grid-flow-col auto-cols-[2rem] justify-end",
        className,
      )}
      data-slot="row-action-group"
    >
      {children}
    </div>
  );
}
