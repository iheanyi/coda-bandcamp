"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { AnimatePresence } from "motion/react"
import * as m from "motion/react-m"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { codaMotion } from "@/motion"

type AlertDialogPresenceContextValue = {
  actionsRef: React.RefObject<AlertDialogPrimitive.Root.Actions | null>
  open: boolean
}

const AlertDialogPresenceContext =
  React.createContext<AlertDialogPresenceContextValue | null>(null)

function AlertDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  actionsRef: actionsRefProp,
  ...props
}: AlertDialogPrimitive.Root.Props) {
  const [uncontrolledOpen, setUncontrolledOpen] =
    React.useState(defaultOpen)
  const internalActionsRef =
    React.useRef<AlertDialogPrimitive.Root.Actions | null>(null)
  const actionsRef = actionsRefProp ?? internalActionsRef
  const open = openProp ?? uncontrolledOpen

  return (
    <AlertDialogPresenceContext.Provider value={{ actionsRef, open }}>
      <AlertDialogPrimitive.Root
        data-slot="alert-dialog"
        actionsRef={actionsRef}
        open={open}
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen && details.reason === "escape-key") {
            details.cancel()
            return
          }
          if (!nextOpen) details.preventUnmountOnClose()
          if (openProp === undefined) setUncontrolledOpen(nextOpen)
          onOpenChange?.(nextOpen, details)
        }}
        {...props}
      />
    </AlertDialogPresenceContext.Provider>
  )
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  )
}

function AlertDialogPortal({
  keepMounted = true,
  ...props
}: AlertDialogPrimitive.Portal.Props) {
  return (
    <AlertDialogPrimitive.Portal
      data-slot="alert-dialog-portal"
      keepMounted={keepMounted}
      {...props}
    />
  )
}

function AlertDialogOverlay({
  className,
  ...props
}: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-[rgba(5,6,7,0.72)] backdrop-blur-sm",
        className
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
  )
}

function AlertDialogContent({
  className,
  size = "default",
  ...props
}: AlertDialogPrimitive.Popup.Props & {
  size?: "default" | "sm"
}) {
  const presence = React.useContext(AlertDialogPresenceContext)
  const open = presence?.open ?? true

  return (
    <AlertDialogPortal>
      <AnimatePresence
        onExitComplete={() => presence?.actionsRef.current?.unmount()}
      >
        {open ? (
          <React.Fragment key="alert-dialog-presence">
            <AlertDialogOverlay forceRender />
            <AlertDialogPrimitive.Popup
              data-slot="alert-dialog-content"
              data-size={size}
              className={cn(
                "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-md -translate-1/2 gap-4 rounded-lg border border-(--line-strong) bg-coda-radio p-6 text-popover-foreground shadow-[0_26px_70px_rgba(0,0,0,0.45)] outline-none",
                className
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
            />
          </React.Fragment>
        ) : null}
      </AnimatePresence>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-lg border-t bg-muted/50 p-6 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogMedia({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        "mb-2 inline-flex size-10 items-center justify-center rounded-md bg-muted sm:group-data-[size=default]/alert-dialog-content:row-span-2 *:[svg:not([class*='size-'])]:size-6",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function AlertDialogAction({
  className,
  ...props
}: AlertDialogPrimitive.Close.Props &
  React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      className={cn(className)}
      render={<Button />}
      {...props}
    />
  )
}

function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      className={cn(className)}
      render={<Button variant={variant} size={size} />}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
}
