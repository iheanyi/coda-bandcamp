export const INVALID_OWN_DATA_PROPERTY = Symbol("invalid own data property");
export const MISSING_OWN_DATA_PROPERTY = Symbol("missing own data property");

/**
 * Wire-compatible value produced by JSON parsing, Tauri IPC (serde JSON), and
 * structured-clone messaging of JSON-safe data. `undefined` covers absent
 * optional properties surfaced by own-property reads. Decoders must still
 * narrow every member with the guards below before trusting it.
 */
export type OwnDataValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly OwnDataValue[]
  | OwnDataRecord;

export type OwnDataRecord = { readonly [key: string]: OwnDataValue };
export type OwnDataPropertyOwner = OwnDataRecord | readonly OwnDataValue[];

export type OwnDataPropertyResult =
  | OwnDataValue
  | typeof INVALID_OWN_DATA_PROPERTY
  | typeof MISSING_OWN_DATA_PROPERTY;

type OwnDataRecordDraft = {
  [key: string]: OwnDataValue;
};

export function isStringValue<Value>(value: Value): value is Value & string {
  return typeof value === "string";
}

export function isNumberValue<Value>(value: Value): value is Value & number {
  return typeof value === "number";
}

export function isBooleanValue<Value>(value: Value): value is Value & boolean {
  return typeof value === "boolean";
}

export function isAbsent<Value>(
  value: Value,
): value is Value & (null | undefined) {
  return value === undefined || value === null;
}

export function isDataArray<Value>(
  value: Value,
): value is Value & readonly OwnDataValue[] {
  return Array.isArray(value);
}

export function isOwnDataRecord<Value>(
  value: Value,
): value is Value & OwnDataRecord {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return (
      Object.getOwnPropertyDescriptor(value, Symbol.toStringTag) === undefined
    );
  } catch {
    return false;
  }
}

/**
 * True when a string contains a Unicode C0 or C1 control scalar, including
 * DEL. Iteration uses code points so an astral-plane character such as 😀 is
 * one scalar (U+1F600) rather than a UTF-16 surrogate pair that a `charCodeAt`
 * loop would inspect as two units.
 */
export function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
    ) {
      return true;
    }
  }
  return false;
}

function emptyOwnDataRecordDraft(): OwnDataRecordDraft {
  // SAFETY: Object.create(null) is an empty null-prototype bag. Projection
  // assigns only own enumerable data properties from a validated wire record.
  return Object.create(null) as OwnDataRecordDraft;
}

/**
 * Copies own enumerable data properties onto a null-prototype record so later
 * `record.field` reads cannot walk prototypes or invoke accessors. Accessor
 * properties are omitted, never executed. Nested values are copied by
 * reference; project again at the point a nested value is decoded as a record.
 */
export function projectOwnDataRecord<Value>(
  value: Value,
): OwnDataRecord | undefined {
  if (!isOwnDataRecord(value)) return undefined;
  try {
    const projected = emptyOwnDataRecordDraft();
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      ) {
        continue;
      }
      projected[key] = descriptor.value;
    }
    return projected;
  } catch {
    return undefined;
  }
}

/**
 * Copies a dense own-data array without invoking index or length accessors.
 * Sparse entries, inherited indexes, and accessor indexes yield `undefined`.
 */
export function copyOwnDataArray<Value>(
  value: Value,
  maximum: number,
): OwnDataValue[] | undefined {
  if (!isDataArray(value)) return undefined;
  const length = ownDataProperty(value, "length");
  if (
    length === INVALID_OWN_DATA_PROPERTY ||
    length === MISSING_OWN_DATA_PROPERTY ||
    !isNumberValue(length) ||
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > maximum
  ) {
    return undefined;
  }
  const copied: OwnDataValue[] = [];
  copied.length = length;
  for (let index = 0; index < length; index += 1) {
    const entry = ownDataProperty(value, index);
    if (
      entry === INVALID_OWN_DATA_PROPERTY ||
      entry === MISSING_OWN_DATA_PROPERTY
    ) {
      return undefined;
    }
    copied[index] = entry;
  }
  return copied;
}

/**
 * Reads an own data property without touching the prototype chain or invoking
 * accessors. The descriptor value is typed as the wire union because every
 * accepted owner comes from JSON-compatible boundaries; callers narrow it with
 * the guards above before use.
 *
 * Retained for modules that still read unprojected payloads (updater,
 * cover-art, mini-player, local favorites). Prefer `projectOwnDataRecord`
 * plus ordinary field reads at decode boundaries.
 */
export function ownDataProperty<Value>(
  value: Value,
  key: PropertyKey,
): OwnDataPropertyResult {
  if (!isOwnDataPropertyOwner(value)) return INVALID_OWN_DATA_PROPERTY;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return MISSING_OWN_DATA_PROPERTY;
    return Object.hasOwn(descriptor, "value")
      ? descriptor.value
      : INVALID_OWN_DATA_PROPERTY;
  } catch {
    return INVALID_OWN_DATA_PROPERTY;
  }
}

function isOwnDataPropertyOwner<Value>(
  value: Value,
): value is Value & OwnDataPropertyOwner {
  return value !== null && Object(value) === value;
}
