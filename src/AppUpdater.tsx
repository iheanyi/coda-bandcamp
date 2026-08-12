import { Download, RefreshCw } from "lucide-react";
import { useRef } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import type { AppUpdaterController } from "./appUpdaterController";

// Keep this module component-only so Fast Refresh preserves updater UI state.
export function AppUpdateSettings({
  updater,
}: {
  updater: AppUpdaterController;
}) {
  if (!updater.supported) return null;

  return (
    <section
      className="grid gap-3"
      aria-labelledby="app-update-settings-title"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
        <RefreshCw className="mt-px text-[#d4d2cc]" size={17} />
        <div>
          <h3
            id="app-update-settings-title"
            className="m-0 text-sm font-semibold text-[#deddd7]"
          >
            Coda updates
          </h3>
          <p className="mt-1 mb-0 text-xs/normal text-[#858984]">
            Check GitHub Releases for a signed update built for this computer.
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-xs font-bold whitespace-nowrap before:size-1.5 before:rounded-full before:content-[''] ${
            updater.update
              ? "text-[#9fbaa7] before:bg-coda-success"
              : "text-[#7d817c] before:bg-[#656965]"
          }`}
        >
          {updater.update ? "Update available" : "Automatic"}
        </span>
      </div>
      <div className="flex items-center gap-3 pl-7">
        <Button
          type="button"
          onClick={() => void updater.checkManually()}
          disabled={updater.checking}
        >
          {updater.checking ? (
            <Spinner
              aria-hidden="true"
              className="size-4 text-current motion-reduce:animate-none"
            />
          ) : null}
          {updater.checking ? "Checking…" : "Check for updates"}
        </Button>
        {updater.manualCheckState === "current" ? (
          <p
            className="mt-1 mb-0 text-xs/normal text-[#858984]"
            role="status"
          >
            Coda is up to date.
          </p>
        ) : null}
        {updater.manualCheckState === "error" ? (
          <Alert className="w-auto" variant="danger">
            Coda couldn’t check for updates. Check your connection and try again.
          </Alert>
        ) : null}
      </div>
    </section>
  );
}

export function AppUpdatePrompt({
  updater,
  suppressed = false,
}: {
  updater: AppUpdaterController;
  suppressed?: boolean;
}) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const update = updater.update;
  if (!updater.supported || !update) return null;

  const busy =
    updater.installState === "installing" ||
    updater.installState === "restarting";

  return (
    <Dialog
      open={updater.promptVisible && !suppressed}
      onOpenChange={(open, details) => {
        if (open) return;
        if (busy) {
          details.cancel();
          return;
        }
        updater.dismiss();
      }}
    >
      <DialogContent
        className="max-h-[calc(100%-(--spacing(8)))] max-w-120 scrollbar-thin [scrollbar-color:#3e4142_transparent] gap-0 overflow-auto p-8"
        showCloseButton={false}
        aria-busy={busy}
        initialFocus={primaryActionRef}
      >
        <div className="mb-5 grid size-12 place-items-center rounded-full bg-accent text-[#e77b60]">
          <Download size={24} />
        </div>
        <span className="mb-2.5 text-xs font-bold tracking-widest text-coda-subtle-foreground uppercase">
          Coda update
        </span>
        <DialogTitle
          id="app-update-title"
          className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-3xl leading-none font-semibold tracking-tighter"
        >
          Coda {update.version} is ready
        </DialogTitle>
        {update.date ? (
          <p className="mt-2 mb-0 text-xs text-coda-subtle-foreground">
            Released {update.date}
          </p>
        ) : null}
        <DialogDescription className="mt-4 mb-5 max-h-48 overflow-auto text-xs/normal whitespace-pre-wrap text-[#a4a6a1]">
          {update.body ??
            "A new version of Coda is available from GitHub Releases."}
        </DialogDescription>

        {updater.installState === "installing" ? (
          <div
            className="mb-4 grid gap-2 text-xs text-[#a6a8a2]"
            role="status"
          >
            <span id="app-update-progress-label">
              Downloading update… {updater.progress}%
            </span>
            <Progress
              aria-labelledby="app-update-progress-label"
              className="block w-full [&_[data-slot=progress-track]]:h-1.5"
              value={updater.progress}
            />
          </div>
        ) : null}
        {updater.installState === "install-error" ||
        updater.installState === "restart-error" ? (
          <Alert variant="danger">
            Coda couldn’t finish the update. Check your connection and try
            again.
          </Alert>
        ) : null}

        <div className="flex items-center gap-2">
          {updater.installState === "installed" ||
          updater.installState === "restarting" ||
          updater.installState === "restart-error" ? (
            <Button
              ref={primaryActionRef}
              type="button"
              onClick={() => void updater.restart()}
              disabled={updater.installState === "restarting"}
              variant="primary"
            >
              {updater.installState === "restarting" ? (
                <Spinner
                  aria-hidden="true"
                  className="size-4 text-current motion-reduce:animate-none"
                />
              ) : updater.installState === "restart-error" ? (
                <RefreshCw size={16} />
              ) : null}
              {updater.installState === "restarting"
                ? "Restarting…"
                : updater.installState === "restart-error"
                  ? "Try again"
                  : "Restart Coda"}
            </Button>
          ) : (
            <Button
              ref={primaryActionRef}
              type="button"
              onClick={() => void updater.install()}
              disabled={updater.installState === "installing"}
              variant="primary"
            >
              {updater.installState === "installing" ? (
                <Spinner
                  aria-hidden="true"
                  className="size-4 text-current motion-reduce:animate-none"
                />
              ) : (
                <Download size={16} />
              )}
              {updater.installState === "installing"
                ? "Installing…"
                : updater.installState === "install-error"
                  ? "Try again"
                  : "Update now"}
            </Button>
          )}
          <Button
            type="button"
            onClick={updater.dismiss}
            disabled={busy}
          >
            Later
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
