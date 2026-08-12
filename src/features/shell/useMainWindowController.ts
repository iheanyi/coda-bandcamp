import { useCallback, useEffect } from "react";

import { isDesktop } from "@/lib";

type MainWindow = Readonly<{
  setFocus: () => Promise<void>;
  show: () => Promise<void>;
  unminimize: () => Promise<void>;
}>;

export type MainWindowAdapter = Readonly<{
  load: () => Promise<MainWindow>;
  supported: () => boolean;
}>;

const nativeMainWindowAdapter: MainWindowAdapter = {
  load: async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  },
  supported: isDesktop,
};

async function revealMainWindow(adapter: MainWindowAdapter): Promise<void> {
  if (!adapter.supported()) return;
  const appWindow = await adapter.load();
  await appWindow.unminimize();
  await appWindow.show();
  await appWindow.setFocus();
}

export type MainWindowController = Readonly<{
  showMainWindow: () => void;
}>;

/** Owns initial WebView reveal and compact-player/tray restore behavior. */
export function useMainWindowController(
  adapter: MainWindowAdapter = nativeMainWindowAdapter,
): MainWindowController {
  const showMainWindow = useCallback(() => {
    void revealMainWindow(adapter).catch(() => {
      // The native startup hook is primary; a failed optional restore is safe.
    });
  }, [adapter]);

  useEffect(() => {
    showMainWindow();
  }, [showMainWindow]);

  return { showMainWindow };
}
