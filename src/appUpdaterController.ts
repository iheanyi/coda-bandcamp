import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { isAppUpdaterEnabled } from "./appFlavor";
import { isDesktop } from "./lib";
import {
  type AppUpdate,
  checkForAppUpdate,
  getInstalledAppVersion,
  restartAfterUpdate,
} from "./updater";

const appUpdateQueryKey = ["coda", "app-update"] as const;
const appVersionQueryKey = ["coda", "app-version"] as const;

type ManualCheckState = "idle" | "checking" | "current" | "error";
type InstallState =
  | "idle"
  | "installing"
  | "installed"
  | "restarting"
  | "install-error"
  | "restart-error";

export interface AppUpdaterController {
  readonly supported: boolean;
  readonly currentVersion?: string;
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
  const supported = isAppUpdaterEnabled() && isDesktop();
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
  const versionQuery = useQuery({
    queryKey: appVersionQueryKey,
    queryFn: async () => (await getInstalledAppVersion()) ?? null,
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
      setInstallState("install-error");
    }
  }, [installState, update]);

  const restart = useCallback(async () => {
    if (
      installState !== "installed" &&
      installState !== "restart-error"
    ) {
      return;
    }

    setInstallState("restarting");
    try {
      await restartAfterUpdate();
    } catch {
      setInstallState("restart-error");
    }
  }, [installState]);

  return {
    supported,
    currentVersion: versionQuery.data ?? undefined,
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
