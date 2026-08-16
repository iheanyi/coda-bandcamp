import type { InvokeArgs } from "@tauri-apps/api/core";

export type TauriInvokeTestArguments = Readonly<{
  coverArtId?: unknown;
  cursor?: unknown;
  input?: unknown;
  name?: unknown;
  onProgress?: unknown;
  playlistId?: unknown;
  seriesId?: unknown;
  showId?: unknown;
  songIds?: unknown;
  token?: unknown;
  trackId?: unknown;
  url?: unknown;
}>;

export type DiscoverInvokeTestInput = Readonly<{
  cursor?: unknown;
  sort?: unknown;
  tag?: unknown;
}>;

function isDiscoverInvokeTestInput<Value>(
  value: Value,
): value is Value & DiscoverInvokeTestInput {
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
    coverArtId: args.coverArtId,
    cursor: args.cursor,
    input: args.input,
    name: args.name,
    onProgress: args.onProgress,
    playlistId: args.playlistId,
    seriesId: args.seriesId,
    showId: args.showId,
    songIds: args.songIds,
    token: args.token,
    trackId: args.trackId,
    url: args.url,
  };
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
  if (
    Object.prototype.toString.call(value) !== "[object String]" ||
    Object(value) === value
  ) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return String(value);
}

export function tauriNumber<Value>(value: Value, field: string): number {
  if (
    Object.prototype.toString.call(value) !== "[object Number]" ||
    Object(value) === value
  ) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return number;
}

export function tauriBoolean<Value>(value: Value, field: string): boolean {
  if (
    Object.prototype.toString.call(value) !== "[object Boolean]" ||
    Object(value) === value
  ) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return Boolean(value);
}

export function tauriStringList<Value>(
  value: Value,
  field: string,
): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return value.map((entry) => tauriString(entry, field));
}

export function tauriNumberList<Value>(
  value: Value,
  field: string,
): number[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Tauri test argument ${field} is invalid`);
  }
  return value.map((entry) => tauriNumber(entry, field));
}
