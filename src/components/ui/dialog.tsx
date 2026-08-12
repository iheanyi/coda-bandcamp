import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { codaMotion } from "@/motion";
import { XIcon } from "lucide-react";

import { useMotionExitWatchdog } from "./useMotionExitWatchdog";

type DialogPresenceContextValue = {
  actionsRef: React.RefObject<DialogPrimitive.Root.Actions | null>;
  onExitComplete?: () => void;
  open: boolean;
};

const DialogPresenceContext =
  React.createContext<DialogPresenceContextValue | null>(null);

function Dialog({
  disablePointerDismissal = false,
  modal = true,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  onExitComplete,
  actionsRef: actionsRefProp,
  ...props
}: DialogPrimitive.Root.Props & {
  onExitComplete?: () => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const internalActionsRef = React.useRef<DialogPrimitive.Root.Actions | null>(
    null,
  );
  const actionsRef = actionsRefProp ?? internalActionsRef;
  const open = openProp ?? uncontrolledOpen;

  return (
    <DialogPresenceContext.Provider
      value={{ actionsRef, onExitComplete, open }}
    >
      <DialogPrimitive.Root
        data-slot="dialog"
        actionsRef={actionsRef}
        disablePointerDismissal={disablePointerDismissal}
        modal={modal}
        open={open}
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen) details.preventUnmountOnClose();
          if (openProp === undefined) setUncontrolledOpen(nextOpen);
          onOpenChange?.(nextOpen, details);
        }}
        {...props}
      />
    </DialogPresenceContext.Provider>
  );
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  keepMounted = true,
  ...props
}: DialogPrimitive.Portal.Props) {
  return (
    <DialogPrimitive.Portal
      data-slot="dialog-portal"
      keepMounted={keepMounted}
      {...props}
    />
  );
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-[rgba(5,6,7,0.72)] backdrop-blur-sm",
        className,
      )}
      {...props}
      render={
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: codaMotion.componentEnter }}
          exit={{ opacity: 0, transition: codaMotion.componentExit }}
        />
      }
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean;
}) {
  const presence = React.useContext(DialogPresenceContext);
  const open = presence?.open ?? true;
  const completeExit = useMotionExitWatchdog({
    open,
    onExitComplete: () => {
      presence?.actionsRef.current?.unmount();
      presence?.onExitComplete?.();
    },
  });

  return (
    <AnimatePresence onExitComplete={completeExit}>
      {open ? (
        <DialogPortal key="dialog-presence">
          <React.Fragment>
            <DialogOverlay forceRender />
            <DialogPrimitive.Popup
              data-slot="dialog-content"
              className={cn(
                "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-1/2 gap-4 rounded-lg border border-(--line-strong) bg-coda-radio p-6 text-sm text-popover-foreground shadow-[0_26px_70px_rgba(0,0,0,0.45)] outline-none",
                className,
              )}
              {...props}
              render={
                <m.div
                  initial={{
                    opacity: 0,
                    transform: "scale(0.985)",
                  }}
                  animate={{
                    opacity: 1,
                    transform: "scale(1)",
                    transition: codaMotion.componentEnter,
                  }}
                  exit={{
                    opacity: 0,
                    transform: "scale(0.985)",
                    transition: codaMotion.componentExit,
                  }}
                />
              }
            >
              {children}
              {showCloseButton && (
                <DialogPrimitive.Close
                  data-slot="dialog-close"
                  render={
                    <Button
                      variant="ghost"
                      className="absolute top-3 right-3"
                      size="icon-sm"
                    />
                  }
                >
                  <XIcon />
                  <span className="sr-only">Close</span>
                </DialogPrimitive.Close>
              )}
            </DialogPrimitive.Popup>
          </React.Fragment>
        </DialogPortal>
      ) : null}
    </AnimatePresence>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-lg border-t bg-muted/50 p-6 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
