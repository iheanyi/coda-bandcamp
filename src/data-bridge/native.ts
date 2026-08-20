import { Channel, invoke, type InvokeArgs } from "@tauri-apps/api/core";
import {
  INVALID_OWN_DATA_PROPERTY,
  MISSING_OWN_DATA_PROPERTY,
  hasControlCharacter,
  isBooleanValue,
  isDataArray,
  isNumberValue,
  isStringValue,
  ownDataProperty,
  projectOwnDataRecord,
  type OwnDataRecord,
  type OwnDataValue,
} from "../ownData";

/**
 * Wire value crossing the Tauri IPC boundary. Responses are serde-serialized
 * JSON, so this named union is the honest transport contract; each command's
 * decoder still validates every field before it becomes a domain type.
 */
export type NativeValue = OwnDataValue;
export type NativeRecord = OwnDataRecord;
export type NativeDecoder<Value> = (
  value: NativeValue,
  context: string,
) => Value;

export const MAX_NATIVE_IDENTIFIER_BYTES = 512;
export const MAX_NATIVE_METADATA_BYTES = 1_024;
export const MAX_NATIVE_URL_BYTES = 8_192;

function hasAtMostUtf8Bytes(value: string, maximum: number): boolean {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes +=
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
    if (bytes > maximum) return false;
  }
  return true;
}

export function invalidNativeResponse(
  context: string,
  expected: string,
): never {
  throw new TypeError(
    `Invalid native response for ${context}: expected ${expected}.`,
  );
}

export function decodeNativeRecord(
  value: NativeValue,
  context: string,
): NativeRecord {
  const record = projectOwnDataRecord(value);
  if (record === undefined) {
    return invalidNativeResponse(context, "an object");
  }
  return record;
}

export function decodeNativeArray<Value>(
  value: NativeValue,
  context: string,
  maximum: number,
  decode: NativeDecoder<Value>,
): Value[] {
  if (!isDataArray(value)) {
    return invalidNativeResponse(
      context,
      `an array with at most ${maximum} entries`,
    );
  }
  const length = ownDataProperty(value, "length");
  if (
    length === INVALID_OWN_DATA_PROPERTY ||
    length === MISSING_OWN_DATA_PROPERTY ||
    !isNumberValue(length) ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximum
  ) {
    return invalidNativeResponse(
      context,
      `an array with at most ${maximum} entries`,
    );
  }
  const decoded: Value[] = [];
  decoded.length = length;
  for (let index = 0; index < length; index += 1) {
    const entry = ownDataProperty(value, index);
    if (
      entry === INVALID_OWN_DATA_PROPERTY ||
      entry === MISSING_OWN_DATA_PROPERTY
    ) {
      return invalidNativeResponse(
        `${context}[${index}]`,
        "an own data array entry",
      );
    }
    decoded[index] = decode(entry, `${context}[${index}]`);
  }
  return decoded;
}

export function decodeNativeString(
  value: NativeValue,
  context: string,
  maximumBytes: number,
  required = true,
): string {
  if (
    !isStringValue(value) ||
    (required && value.trim().length === 0) ||
    hasControlCharacter(value) ||
    !hasAtMostUtf8Bytes(value, maximumBytes)
  ) {
    return invalidNativeResponse(
      context,
      `${required ? "non-empty " : ""}text up to ${maximumBytes} bytes`,
    );
  }
  return value;
}

export function decodeNativeOptionalString(
  value: NativeValue,
  context: string,
  maximumBytes: number,
  required = false,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  return decodeNativeString(value, context, maximumBytes, required);
}

export function decodeNativeBoolean(
  value: NativeValue,
  context: string,
): boolean {
  if (!isBooleanValue(value)) {
    return invalidNativeResponse(context, "a boolean");
  }
  return value;
}

export function decodeNativeOptionalBoolean(
  value: NativeValue,
  context: string,
): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return decodeNativeBoolean(value, context);
}

export function decodeNativeInteger(
  value: NativeValue,
  context: string,
  maximum = Number.MAX_SAFE_INTEGER,
  minimum = 0,
): number {
  if (
    !isNumberValue(value) ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidNativeResponse(
      context,
      `an integer from ${minimum} through ${maximum}`,
    );
  }
  return value;
}

export function decodeNativeOptionalInteger(
  value: NativeValue,
  context: string,
  maximum = Number.MAX_SAFE_INTEGER,
  minimum = 0,
): number | undefined {
  if (value === null || value === undefined) return undefined;
  return decodeNativeInteger(value, context, maximum, minimum);
}

export function decodeNativeBandcampUrl(
  value: NativeValue,
  context: string,
): string {
  const candidate = decodeNativeString(value, context, MAX_NATIVE_URL_BYTES);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return invalidNativeResponse(context, "a valid Bandcamp HTTPS URL");
  }
  const host = url.hostname.toLowerCase();
  const allowedHost =
    host === "bandcamp.com" ||
    host.endsWith(".bandcamp.com") ||
    host === "bcbits.com" ||
    host.endsWith(".bcbits.com");
  // Mirror src-tauri/src/url_policy.rs: `port().is_some_and(|port| port != 443)`.
  // WHATWG `URL.port` is "" for the HTTPS default, including explicit `:443`.
  // Allow `"443"` as well so a runtime that preserves the explicit default still
  // matches Rust, which accepts port 443.
  const port = url.port;
  if (
    url.protocol !== "https:" ||
    !allowedHost ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (port !== "" && port !== "443")
  ) {
    return invalidNativeResponse(context, "a verified Bandcamp HTTPS URL");
  }
  return candidate;
}

export function decodeNativeOptionalBandcampUrl(
  value: NativeValue,
  context: string,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  return decodeNativeBandcampUrl(value, context);
}

export function decodeNativeVoid(value: NativeValue, context: string): void {
  if (value !== null && value !== undefined) {
    invalidNativeResponse(context, "no response value");
  }
}

export async function invokeNative(
  command: string,
  args?: InvokeArgs,
): Promise<NativeValue> {
  return args === undefined
    ? await invoke<NativeValue>(command)
    : await invoke<NativeValue>(command, args);
}

export function nativeChannel(
  onmessage: (event: NativeValue) => void,
): Channel<NativeValue> {
  return new Channel<NativeValue>(onmessage);
}
