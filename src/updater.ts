import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";
import {
  invalidNativeResponse,
  type NativeValue,
} from "./data-bridge/native";
import {
  isNumberValue,
  isStringValue,
  MISSING_OWN_DATA_PROPERTY,
  ownDataProperty,
  projectOwnDataRecord,
  type OwnDataPropertyOwner,
  type OwnDataPropertyResult,
  type OwnDataValue,
} from "./ownData";

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
  body?: NativeValue;
  close: Update["close"];
  date?: NativeValue;
  downloadAndInstall: (
    onEvent?: (event: NativeValue) => void,
  ) => Promise<void>;
  version: NativeValue;
}>;

function isDesktopRuntime(): boolean {
  return "window" in globalThis && "__TAURI_INTERNALS__" in globalThis.window;
}

function hasControlCharacters(
  value: string,
  allowLayoutWhitespace = false,
): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (
      allowLayoutWhitespace &&
      (codeUnit === 0x09 || codeUnit === 0x0a || codeUnit === 0x0d)
    ) {
      continue;
    }
    if (codeUnit <= 0x1f || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
      return true;
    }
  }
  return false;
}

function pluginUpdateDataOwner<Value extends object>(
  update: Value,
): OwnDataPropertyOwner {
  // SAFETY: Tauri's Update instance owns version/date/body as data fields.
  // ownDataProperty reads descriptors only and never invokes methods.
  return update as OwnDataPropertyOwner;
}

function decodeRequiredMetadataText(
  value: OwnDataPropertyResult,
  context: string,
  maxLength: number,
): string {
  if (
    !isStringValue(value) ||
    value.length > maxLength ||
    value.trim().length === 0 ||
    hasControlCharacters(value)
  ) {
    return invalidNativeResponse(
      context,
      `non-empty text up to ${maxLength} characters`,
    );
  }
  return value.trim();
}

function decodeOptionalMetadataText(
  value: OwnDataPropertyResult,
  context: string,
  maxLength: number,
  emptyIsAbsent = false,
  allowLayoutWhitespace = false,
): string | undefined {
  if (
    value === MISSING_OWN_DATA_PROPERTY ||
    value === undefined ||
    value === null
  ) {
    return undefined;
  }
  const expected = `${emptyIsAbsent ? "" : "non-empty "}text up to ${maxLength} characters`;
  if (
    !isStringValue(value) ||
    value.length > maxLength ||
    hasControlCharacters(value, allowLayoutWhitespace)
  ) {
    return invalidNativeResponse(context, expected);
  }
  const text = value.trim();
  if (text.length === 0) {
    // Generated manifests publish notes as "". Decoding that to undefined
    // keeps the dialog's fallback description instead of blank copy.
    if (emptyIsAbsent) return undefined;
    return invalidNativeResponse(context, expected);
  }
  return text;
}

function decodeByteCount(value: OwnDataValue): number | undefined {
  if (!isNumberValue(value) || !Number.isSafeInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * Progress events are display-only. Malformed payloads return undefined so the
 * channel callback can stop trusting percentages without throwing.
 */
function decodeUpdaterDownloadEvent(
  value: NativeValue,
): DownloadEvent | undefined {
  const record = projectOwnDataRecord(value);
  if (record === undefined) return undefined;
  const event = record.event;
  if (event === "Started") {
    const data = projectOwnDataRecord(record.data);
    if (data === undefined) return undefined;
    const contentLengthValue = data.contentLength;
    if (contentLengthValue === undefined) {
      return { event: "Started", data: {} };
    }
    const contentLength = decodeByteCount(contentLengthValue);
    if (contentLength === undefined) return undefined;
    return { event: "Started", data: { contentLength } };
  }
  if (event === "Progress") {
    const data = projectOwnDataRecord(record.data);
    if (data === undefined) return undefined;
    const chunkLength = decodeByteCount(data.chunkLength);
    if (chunkLength === undefined) return undefined;
    return { event: "Progress", data: { chunkLength } };
  }
  if (event === "Finished") {
    return { event: "Finished" };
  }
  return undefined;
}

function normalizedPercentage(
  downloadedBytes: number,
  totalBytes: number,
): number {
  return Math.min(
    100,
    Math.max(0, Math.round((downloadedBytes / totalBytes) * 100)),
  );
}

export function normalizeAppUpdate(
  update: NativeAppUpdate,
  context = "updater check result",
): AppUpdate {
  const owner = pluginUpdateDataOwner(update);
  const version = decodeRequiredMetadataText(
    ownDataProperty(owner, "version"),
    `${context}.version`,
    MAX_VERSION_LENGTH,
  );
  const date = decodeOptionalMetadataText(
    ownDataProperty(owner, "date"),
    `${context}.date`,
    MAX_DATE_LENGTH,
  );
  const body = decodeOptionalMetadataText(
    ownDataProperty(owner, "body"),
    `${context}.body`,
    MAX_BODY_LENGTH,
    true,
    true,
  );
  return {
    version,
    date,
    body,
    async downloadAndInstall(onProgress) {
      let downloadedBytes = 0;
      let totalBytes: number | undefined;
      let trustProgress = true;

      await update.downloadAndInstall((value: NativeValue) => {
        if (!trustProgress) return;

        const event = decodeUpdaterDownloadEvent(value);
        if (event === undefined) {
          // Stop trusting display percentages. The awaited install continues.
          trustProgress = false;
          return;
        }

        switch (event.event) {
          case "Started": {
            const { contentLength } = event.data;
            totalBytes =
              contentLength !== undefined && contentLength > 0
                ? contentLength
                : undefined;
            downloadedBytes = 0;
            onProgress(0);
            return;
          }
          case "Progress":
            downloadedBytes = Math.min(
              Number.MAX_SAFE_INTEGER,
              downloadedBytes + event.data.chunkLength,
            );
            if (totalBytes !== undefined) {
              onProgress(normalizedPercentage(downloadedBytes, totalBytes));
            }
            return;
          case "Finished":
            return;
          default: {
            const unsupportedEvent: never = event;
            return unsupportedEvent;
          }
        }
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
