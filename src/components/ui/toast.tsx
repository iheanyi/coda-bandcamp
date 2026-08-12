import * as React from "react";
import { Toast as ToastPrimitive } from "@base-ui/react/toast";
import {
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
  X,
} from "lucide-react";
import { AnimatePresence, usePresence } from "motion/react";
import * as m from "motion/react-m";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCodaMotion } from "@/motion";
import { toast } from "@/components/ui/toastManager";
import { useMotionExitWatchdog } from "@/components/ui/useMotionExitWatchdog";

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        "pointer-events-none fixed right-4 bottom-28 z-50 w-[calc(100%-2rem)] max-w-xs outline-none",
        className,
      )}
      {...props}
    />
  );
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        "group/toast pointer-events-auto relative w-full origin-bottom rounded-md border border-(--line-strong) bg-popover text-popover-foreground shadow-[0_10px_28px_rgba(0,0,0,0.3)] outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "[--gap:0.5rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)*-1+calc(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.5rem] [--scale:calc(max(0,1-(var(--toast-index)*0.06)))] [--shrink:calc(1-var(--scale))]",
        "h-(--height) transform-[translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] [transition:transform_var(--duration-coda-view)_var(--ease-coda-enter),opacity_var(--duration-coda-standard)]",
        "after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        "data-expanded:h-(--toast-height) data-expanded:transform-[translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]",
        "data-limited:opacity-0",
        "data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(var(--toast-swipe-movement-y)+150%))]",
        "data-expanded:data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]",
        "data-expanded:data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(var(--toast-swipe-movement-y)-150%))]",
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        "flex h-full items-center gap-2 overflow-hidden px-3 py-2.5 transition-opacity duration-(--duration-coda-standard) ease-coda-enter data-behind:opacity-0 data-expanded:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn("min-w-0 flex-1 text-xs font-medium", className)}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="outline" size="compact" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn("shrink-0", className)}
      {...props}
    />
  );
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-compact" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Close toast"
      render={render}
      className={cn(
        "relative shrink-0 text-muted-foreground after:absolute after:-inset-2 after:content-[''] hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children ?? <X aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

function ToastIcon({ type }: { type: string | undefined }) {
  let icon: React.ReactNode = null;

  if (type === "success") {
    icon = <CircleCheck className="text-coda-success" aria-hidden="true" />;
  } else if (type === "info") {
    icon = <Info aria-hidden="true" />;
  } else if (type === "warning") {
    icon = <TriangleAlert aria-hidden="true" />;
  } else if (type === "error") {
    icon = (
      <OctagonX className="text-coda-danger-foreground" aria-hidden="true" />
    );
  } else if (type === "loading") {
    icon = <Loader2 className="animate-spin" aria-hidden="true" />;
  }

  if (!icon) return null;

  return (
    <span
      data-slot="toast-icon"
      className="shrink-0 text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  );
}

function ToastMotionItem({
  index,
  toastItem,
}: Readonly<{
  index: number;
  toastItem: ToastPrimitive.Root.Props["toast"];
}>) {
  const codaMotion = useCodaMotion();
  const [isPresent, safeToRemove] = usePresence();
  const completeExit = useMotionExitWatchdog({
    open: isPresent,
    onExitComplete: () => safeToRemove?.(),
  });

  return (
    <m.div
      data-slot="toast-motion"
      className="pointer-events-none absolute right-0 bottom-0 w-full origin-bottom"
      inert={!isPresent || undefined}
      aria-hidden={!isPresent || undefined}
      style={{
        pointerEvents: isPresent ? undefined : "none",
        zIndex: 1000 - index,
      }}
      initial={{
        opacity: codaMotion.profile.component.opacityFrom,
        transform: `translateY(${codaMotion.profile.component.translationPx}px) scale(${codaMotion.profile.component.scaleFrom})`,
      }}
      animate={{
        opacity: 1,
        transform: "translateY(0px) scale(1)",
        transition: codaMotion.componentEnter,
      }}
      exit={{
        opacity: codaMotion.profile.component.opacityFrom,
        transform: `translateY(${codaMotion.profile.component.translationPx * 0.7}px) scale(${codaMotion.profile.component.scaleFrom})`,
        transition: codaMotion.componentExit,
      }}
      onAnimationComplete={completeExit}
    >
      <Toast toast={toastItem}>
        <ToastContent>
          <ToastIcon type={toastItem.type} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ToastTitle />
            <ToastDescription />
          </div>
          <ToastAction />
          <ToastClose />
        </ToastContent>
      </Toast>
    </m.div>
  );
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager();

  return (
    <AnimatePresence initial={false}>
      {toasts.map((toastItem, index) => (
        <ToastMotionItem
          key={toastItem.id}
          index={index}
          toastItem={toastItem}
        />
      ))}
    </AnimatePresence>
  );
}

function Toaster({
  children,
  toastManager = toast,
  ...props
}: ToastPrimitive.Provider.Props) {
  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
};
