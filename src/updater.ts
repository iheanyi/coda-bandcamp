import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

const MAX_VERSION_LENGTH = 64;
const MAX_DATE_LENGTH = 64;
const MAX_BODY_LENGTH = 16_000;

export type UpdateProgressHandler = (percentage: number) => void;

export interface AppUpdate {
  readonly version: string;
  readonly date?: string;
  readonly body?: string;
  downloadAndInstall(onProgress: UpdateProgressHandler): Promise<void>;
  close(): Promise<void>;
}

export type NativeAppUpdate = Readonly<{
  body?: unknown;
  close: Update["close"];
  date?: unknown;
  downloadAndInstall: Update["downloadAndInstall"];
  version: unknown;
}>;

function isDesktopRuntime(): boolean {
  return "window" in globalThis && "__TAURI_INTERNALS__" in globalThis.window;
}

function boundedText<Value>(
  value: Value,
  maxLength: number,
): string | undefined {
  if (
    Object.prototype.toString.call(value) !== "[object String]" ||
    Object(value) === value
  ) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function normalizedPercentage(downloadedBytes: number, totalBytes: number): number {
  return Math.min(100, Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)));
}

export function normalizeAppUpdate(update: NativeAppUpdate): AppUpdate {
  return {
    version: boundedText(update.version, MAX_VERSION_LENGTH) ?? "",
    date: boundedText(update.date, MAX_DATE_LENGTH),
    body: boundedText(update.body, MAX_BODY_LENGTH),
    async downloadAndInstall(onProgress) {
      let downloadedBytes = 0;
      let totalBytes: number | undefined;

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          const contentLength = event.data.contentLength;
          totalBytes =
            contentLength !== undefined &&
            Number.isFinite(contentLength) &&
            contentLength > 0
              ? contentLength
              : undefined;
          downloadedBytes = 0;
          onProgress(0);
          return;
        }

        if (event.event === "Progress") {
          const chunkLength = event.data.chunkLength;
          if (Number.isFinite(chunkLength) && chunkLength > 0) {
            downloadedBytes = Math.min(
              Number.MAX_SAFE_INTEGER,
              downloadedBytes + chunkLength,
            );
          }
          if (totalBytes !== undefined) {
            onProgress(normalizedPercentage(downloadedBytes, totalBytes));
          }
          return;
        }

        onProgress(100);
      });
    },
    close: () => update.close(),
  };
}

export async function checkForAppUpdate(): Promise<AppUpdate | undefined> {
  if (!isDesktopRuntime()) return undefined;

  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  return update ? normalizeAppUpdate(update) : undefined;
}

export async function restartAfterUpdate(): Promise<void> {
  if (!isDesktopRuntime()) return;

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
