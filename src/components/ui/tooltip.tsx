"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

import { cn } from "@/lib/utils";
import { useCodaMotion } from "@/motion";

import { useMotionExitWatchdog } from "./useMotionExitWatchdog";

type TooltipPresenceContextValue = {
  actionsRef: React.RefObject<TooltipPrimitive.Root.Actions | null>;
  open: boolean;
};

const TooltipPresenceContext =
  React.createContext<TooltipPresenceContextValue | null>(null);

function TooltipProvider({
  delay = 0,
  ...props
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delay={delay}
      {...props}
    />
  );
}

function Tooltip<Payload>({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  actionsRef: actionsRefProp,
  ...props
}: TooltipPrimitive.Root.Props<Payload>) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const internalActionsRef = React.useRef<TooltipPrimitive.Root.Actions | null>(
    null,
  );
  const actionsRef = actionsRefProp ?? internalActionsRef;
  const open = openProp ?? uncontrolledOpen;

  return (
    <TooltipPresenceContext.Provider value={{ actionsRef, open }}>
      <TooltipPrimitive.Root
        data-slot="tooltip"
        actionsRef={actionsRef}
        open={open}
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen) details.preventUnmountOnClose();
          if (openProp === undefined) setUncontrolledOpen(nextOpen);
          onOpenChange?.(nextOpen, details);
        }}
        {...props}
      />
    </TooltipPresenceContext.Provider>
  );
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 4,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >) {
  const codaMotion = useCodaMotion();
  const presence = React.useContext(TooltipPresenceContext);
  const open = presence?.open ?? true;
  const completeExit = useMotionExitWatchdog({
    open,
    onExitComplete: () => presence?.actionsRef.current?.unmount(),
  });

  return (
    <AnimatePresence initial={false} onExitComplete={completeExit}>
      {open ? (
        <TooltipPrimitive.Portal key="tooltip-presence">
          <TooltipPrimitive.Positioner
            align={align}
            alignOffset={alignOffset}
            side={side}
            sideOffset={sideOffset}
            className="isolate z-50"
          >
            <TooltipPrimitive.Popup
              data-slot="tooltip-content"
              role="tooltip"
              className={cn(
                "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1 rounded-sm border border-border bg-coda-hover px-2 py-1 text-xs text-foreground shadow-[0_10px_28px_rgba(0,0,0,0.3)] has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm",
                className,
              )}
              {...props}
              render={
                <m.div
                  initial={{
                    opacity: codaMotion.profile.component.opacityFrom,
                    transform: `scale(${codaMotion.profile.component.scaleFrom})`,
                  }}
                  animate={{
                    opacity: 1,
                    transform: "scale(1)",
                    transition: codaMotion.feedback,
                  }}
                  exit={{
                    opacity: codaMotion.profile.component.opacityFrom,
                    transform: `scale(${codaMotion.profile.component.scaleFrom})`,
                    transition: codaMotion.componentExit,
                  }}
                />
              }
            >
              {children}
              <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%-2px)] rotate-45 rounded-xs bg-coda-hover fill-coda-hover data-[side=bottom]:top-1 data-[side=inline-end]:top-1/2! data-[side=inline-end]:-left-1 data-[side=inline-end]:-translate-y-1/2 data-[side=inline-start]:top-1/2! data-[side=inline-start]:-right-1 data-[side=inline-start]:-translate-y-1/2 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5" />
            </TooltipPrimitive.Popup>
          </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
