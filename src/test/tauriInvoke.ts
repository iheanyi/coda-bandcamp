import type { InvokeArgs } from "@tauri-apps/api/core";

import {
  isBooleanValue,
  isDataArray,
  isNumberValue,
  isStringValue,
  type OwnDataRecord,
  type OwnDataValue,
} from "../ownData";

export type TauriInvokeTestArguments = Readonly<{
  coverArtId?: OwnDataValue;
  cursor?: OwnDataValue;
  input?: OwnDataValue;
  name?: OwnDataValue;
  onProgress?: OwnDataValue;
  playlistId?: OwnDataValue;
  seriesId?: OwnDataValue;
  showId?: OwnDataValue;
  songIds?: OwnDataValue;
  token?: OwnDataValue;
  trackId?: OwnDataValue;
  url?: OwnDataValue;
}>;

export type DiscoverInvokeTestInput = Readonly<{
  cursor?: OwnDataValue;
  sort?: OwnDataValue;
  tag?: OwnDataValue;
}>;

function isDiscoverInvokeTestInput(
  value: OwnDataValue,
): value is OwnDataRecord {
  return value !== null && Object(value) === value && !Array.isArray(value);
}

export function readTauriInvokeArguments(
  args: InvokeArgs | undefined,
): TauriInvokeTestArguments {
  if (
    args === undefined ||
    Array.isArray(args) ||
    args instanceof ArrayBuffer ||
    args instanceof Uint8Array
  ) {
    return {};
  }
  return {
    coverArtId: ownDataInvokeField(args.coverArtId),
    cursor: ownDataInvokeField(args.cursor),
    input: ownDataInvokeField(args.input),
    name: ownDataInvokeField(args.name),
    onProgress: ownDataInvokeField(args.onProgress),
    playlistId: ownDataInvokeField(args.playlistId),
    seriesId: ownDataInvokeField(args.seriesId),
    showId: ownDataInvokeField(args.showId),
    songIds: ownDataInvokeField(args.songIds),
    token: ownDataInvokeField(args.token),
    trackId: ownDataInvokeField(args.trackId),
    url: ownDataInvokeField(args.url),
  };
}

function ownDataInvokeField<Value>(value: Value): OwnDataValue {
  // SAFETY: Tauri test invoke bags are JSON-compatible command arguments.
  return value as OwnDataValue;
}

export function installTauriEventPluginTestInternals(): void {
  Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
    configurable: true,
    value: {
      unregisterListener: () => undefined,
    },
  });
}

export function readDiscoverInvokeInput(
  args: InvokeArgs | undefined,
): DiscoverInvokeTestInput {
  const input = readTauriInvokeArguments(args).input;
  if (!isDiscoverInvokeTestInput(input)) {
    throw new TypeError("Tauri test Discover input is invalid");
  }
  return {
    cursor: input.cursor,
    sort: input.sort,
    tag: input.tag,
  };
}

export function tauriString<Value>(value: Value, field: string): string {
  if (!isStringValue(value)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return value;
}

export function tauriNumber<Value>(value: Value, field: string): number {
  if (!isNumberValue(value)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return value;
}

export function tauriBoolean<Value>(value: Value, field: string): boolean {
  if (!isBooleanValue(value)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return value;
}

export function tauriStringList<Value>(
  value: Value,
  field: string,
): string[] {
  if (!isDataArray(value)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return value.map((entry) => tauriString(entry, field));
}

export function tauriNumberList<Value>(
  value: Value,
  field: string,
): number[] {
  if (!isDataArray(value)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return value.map((entry) => tauriNumber(entry, field));
}
