import { lazy, Suspense } from "react";

import { AppUpdatePrompt } from "@/AppUpdater";
import type { AppUpdaterController } from "@/appUpdaterController";
import { Spinner } from "@/components/ui/spinner";
import { Toaster } from "@/components/ui/toast";
import type { ToastNotifier } from "@/components/ui/toastManager";
import type { Album } from "@/types";

import { ConnectionDialog } from "./ConnectionDialog";
import type { PersistentOverlaysController } from "./usePersistentOverlaysController";

const AddToPlaylistDialog = lazy(() =>
  import("@/features/saved-library/AddToPlaylistDialog").then((module) => ({
    default: module.AddToPlaylistDialog,
  })),
);

function PlaylistDialogFallback() {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-popover px-4 py-3 text-xs text-popover-foreground shadow-xl">
        <Spinner aria-label="Loading playlists" className="size-5" />
        <span aria-hidden="true">Loading playlists…</span>
      </div>
    </div>
  );
}

export type PersistentAppOverlaysProps = Readonly<{
  connected: boolean;
  controller: PersistentOverlaysController;
  notify: ToastNotifier;
  onConnected: (albums: Album[]) => void;
  onDisconnected: () => Promise<void>;
  updater: AppUpdaterController;
}>;

/** Renders root dialogs and toasts outside route lifetimes. */
export function PersistentAppOverlays({
  connected,
  controller,
  notify,
  onConnected,
  onDisconnected,
  updater,
}: PersistentAppOverlaysProps) {
  const { commands, state } = controller;
  const playlist = state.playlist;

  return (
    <>
      <ConnectionDialog
        appUpdater={updater}
        connected={connected}
        lastFmStatus={state.lastFmStatus}
        open={state.connectionOpen}
        onClose={commands.closeConnection}
        onConnected={onConnected}
        onDisconnected={onDisconnected}
        onLastFmStatus={commands.setLastFmStatus}
      >
        <AppUpdatePrompt updater={updater} />
      </ConnectionDialog>
      {playlist ? (
        <Suspense fallback={<PlaylistDialogFallback />}>
          <AddToPlaylistDialog
            key={playlist.generation}
            open={playlist.open}
            tracks={playlist.tracks}
            onClose={commands.closePlaylist}
            onExited={() =>
              commands.completePlaylistExit(playlist.generation)
            }
            onNotify={notify}
          />
        </Suspense>
      ) : null}
      <Toaster timeout={2_800} />
    </>
  );
}
