import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { isDesktop } from "./lib";
import {
  type AppUpdate,
  checkForAppUpdate,
  restartAfterUpdate,
} from "./updater";

const appUpdateQueryKey = ["coda", "app-update"] as const;

type ManualCheckState = "idle" | "checking" | "current" | "error";
type InstallState = "idle" | "installing" | "installed" | "restarting" | "error";

export interface AppUpdaterController {
  readonly supported: boolean;
  readonly update?: AppUpdate;
  readonly promptVisible: boolean;
  readonly checking: boolean;
  readonly manualCheckState: ManualCheckState;
  readonly installState: InstallState;
  readonly progress: number;
  checkManually(): Promise<void>;
  dismiss(): void;
  install(): Promise<void>;
  restart(): Promise<void>;
}

export function useAppUpdater(): AppUpdaterController {
  const supported = isDesktop();
  const [dismissed, setDismissed] = useState(false);
  const [manualCheckState, setManualCheckState] =
    useState<ManualCheckState>("idle");
  const [installState, setInstallState] = useState<InstallState>("idle");
  const [progress, setProgress] = useState(0);
  const updateQuery = useQuery({
    queryKey: appUpdateQueryKey,
    queryFn: async () => (await checkForAppUpdate()) ?? null,
    enabled: supported,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const update = updateQuery.data ?? undefined;

  const checkManually = useCallback(async () => {
    if (!supported) return;

    setManualCheckState("checking");
    const result = await updateQuery.refetch();
    if (result.error) {
      setManualCheckState("error");
      return;
    }

    setDismissed(false);
    setManualCheckState(result.data ? "idle" : "current");
  }, [supported, updateQuery]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    if (update) {
      void update.close().catch(() => {
        // Dismissing the prompt should remain reliable if native cleanup fails.
      });
    }
  }, [update]);

  const install = useCallback(async () => {
    if (!update || installState === "installing") return;

    setInstallState("installing");
    setProgress(0);
    try {
      await update.downloadAndInstall(setProgress);
      setProgress(100);
      setInstallState("installed");
    } catch {
      setInstallState("error");
    }
  }, [installState, update]);

  const restart = useCallback(async () => {
    if (installState !== "installed") return;

    setInstallState("restarting");
    try {
      await restartAfterUpdate();
    } catch {
      setInstallState("error");
    }
  }, [installState]);

  return {
    supported,
    update,
    promptVisible: Boolean(update) && !dismissed,
    checking: updateQuery.isFetching,
    manualCheckState,
    installState,
    progress,
    checkManually,
    dismiss,
    install,
    restart,
  };
}

export function AppUpdateSettings({
  updater,
}: {
  updater: AppUpdaterController;
}) {
  if (!updater.supported) return null;

  return (
    <section
      className="app-update-settings"
      aria-labelledby="app-update-settings-title"
    >
      <div className="app-update-settings__heading">
        <RefreshCw size={17} />
        <div>
          <h3 id="app-update-settings-title">Coda updates</h3>
          <p>
            Check GitHub Releases for a signed update built for this computer.
          </p>
        </div>
        <span
          className={`service-status ${
            updater.update ? "service-status--live" : ""
          }`}
        >
          {updater.update ? "Update available" : "Automatic"}
        </span>
      </div>
      <div className="app-update-settings__actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => void updater.checkManually()}
          disabled={updater.checking}
        >
          {updater.checking ? (
            <RefreshCw className="spin" size={15} />
          ) : null}
          {updater.checking ? "Checking…" : "Check for updates"}
        </button>
        {updater.manualCheckState === "current" ? (
          <p role="status">Coda is up to date.</p>
        ) : null}
        {updater.manualCheckState === "error" ? (
          <p className="form-error" role="alert">
            Coda couldn’t check for updates. Check your connection and try again.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function AppUpdatePrompt({
  updater,
}: {
  updater: AppUpdaterController;
}) {
  const update = updater.update;
  if (!updater.supported || !updater.promptVisible || !update) return null;

  const busy =
    updater.installState === "installing" ||
    updater.installState === "restarting";

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="app-update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        aria-busy={busy}
      >
        <div className="app-update-dialog__icon">
          <Download size={23} />
        </div>
        <span className="eyebrow">Coda update</span>
        <h2 id="app-update-title">Coda {update.version} is ready</h2>
        {update.date ? (
          <p className="app-update-dialog__date">Released {update.date}</p>
        ) : null}
        {update.body ? (
          <div className="app-update-dialog__notes">{update.body}</div>
        ) : (
          <p className="app-update-dialog__notes">
            A new version of Coda is available from GitHub Releases.
          </p>
        )}

        {updater.installState === "installing" ? (
          <div className="app-update-dialog__progress" role="status">
            <span>Downloading update… {updater.progress}%</span>
            <progress max={100} value={updater.progress} />
          </div>
        ) : null}
        {updater.installState === "error" ? (
          <div className="form-error" role="alert">
            Coda couldn’t finish the update. Check your connection and try
            again.
          </div>
        ) : null}

        <div className="app-update-dialog__actions">
          {updater.installState === "installed" ||
          updater.installState === "restarting" ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void updater.restart()}
              disabled={updater.installState === "restarting"}
            >
              {updater.installState === "restarting" ? (
                <RefreshCw className="spin" size={16} />
              ) : null}
              {updater.installState === "restarting"
                ? "Restarting…"
                : "Restart Coda"}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => void updater.install()}
              disabled={updater.installState === "installing"}
            >
              <Download size={16} />
              {updater.installState === "installing"
                ? "Installing…"
                : updater.installState === "error"
                  ? "Try again"
                  : "Download and install"}
            </button>
          )}
          <button
            type="button"
            className="secondary-button"
            onClick={updater.dismiss}
            disabled={busy}
          >
            Later
          </button>
        </div>
      </section>
    </div>
  );
}
