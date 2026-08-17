import { describe, expect, it } from "vitest";
import {
  copyOwnDataArray,
  hasControlCharacter,
  isDataArray,
  isOwnDataRecord,
  ownDataArrayLength,
  projectOwnDataRecord,
} from "./ownData";

describe("own data record projection", () => {
  it("copies own enumerable data onto a null prototype", () => {
    const projected = projectOwnDataRecord({
      id: "album-1",
      nested: { title: "Soft Focus" },
    });

    expect(projected).toEqual({
      id: "album-1",
      nested: { title: "Soft Focus" },
    });
    expect(Object.getPrototypeOf(projected)).toBeNull();
    expect(Object.getPrototypeOf(projected?.nested)).toBe(Object.prototype);
  });

  it("omits inherited fields including Object.prototype pollution", () => {
    Object.defineProperty(Object.prototype, "id", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: "polluted-id",
    });
    try {
      const inherited = Object.create({ id: "inherited" });
      inherited.title = "Soft Focus";
      const polluted = { title: "Soft Focus" };
      const projected = projectOwnDataRecord(polluted);

      expect(isOwnDataRecord(inherited)).toBe(false);
      expect(projectOwnDataRecord(inherited)).toBeUndefined();
      expect(Object.hasOwn(polluted, "id")).toBe(false);
      expect(isOwnDataRecord(polluted) ? polluted.id : undefined).toBe(
        "polluted-id",
      );
      expect(projected?.id).toBeUndefined();
      expect(Object.getPrototypeOf(projected)).toBeNull();
    } finally {
      Reflect.deleteProperty(Object.prototype, "id");
    }
  });

  it("omits accessor properties without invoking them", () => {
    let getterCalls = 0;
    const payload = { id: "album-1" };
    Object.defineProperty(payload, "title", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("title getter must not run");
      },
    });

    const projected = projectOwnDataRecord(payload);
    expect(projected).toEqual({ id: "album-1" });
    expect(projected?.title).toBeUndefined();
    expect(getterCalls).toBe(0);
  });

  it("rejects spoofed tags, boxed primitives, and arrays", () => {
    const tagged = { id: "album-1" };
    Object.defineProperty(tagged, Symbol.toStringTag, {
      configurable: true,
      get() {
        throw new Error("tag getter must not run");
      },
    });

    expect(projectOwnDataRecord(tagged)).toBeUndefined();
    expect(projectOwnDataRecord([])).toBeUndefined();
    expect(isDataArray([])).toBe(true);
    expect(projectOwnDataRecord(
      Object("boxed"),
    )).toBeUndefined();
    expect(projectOwnDataRecord(
      Object(1),
    )).toBeUndefined();
    expect(projectOwnDataRecord(
      Object(true),
    )).toBeUndefined();
    expect(projectOwnDataRecord(null)).toBeUndefined();
    expect(projectOwnDataRecord(undefined)).toBeUndefined();
  });
});

describe("own data array copy", () => {
  it("reads a bounded length without walking indexes", () => {
    let indexReads = 0;
    const entries = new Proxy(["album-1", "album-2"], {
      getOwnPropertyDescriptor(target, property) {
        if (property !== "length") indexReads += 1;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
    });

    expect(ownDataArrayLength(entries, 4)).toBe(2);
    expect(ownDataArrayLength(entries, 1)).toBeUndefined();
    expect(ownDataArrayLength({ 0: "album-1", length: 1 }, 4)).toBeUndefined();
    expect(indexReads).toBe(0);
  });

  it("copies dense own data entries and rejects unsafe indexes", () => {
    let getterCalls = 0;
    const accessorEntries = ["safe"];
    Object.defineProperty(accessorEntries, "0", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("array getter must not run");
      },
    });
    const inheritedEntries: string[] = [];
    inheritedEntries.length = 1;
    const inheritedPrototype = Object.create(Array.prototype);
    Object.defineProperty(inheritedPrototype, "0", {
      configurable: true,
      value: "inherited",
    });
    Object.setPrototypeOf(inheritedEntries, inheritedPrototype);

    expect(copyOwnDataArray(["album-1", "album-2"], 4)).toEqual([
      "album-1",
      "album-2",
    ]);
    expect(copyOwnDataArray(["album-1", "album-2"], 1)).toBeUndefined();
    expect(copyOwnDataArray(accessorEntries, 4)).toBeUndefined();
    expect(copyOwnDataArray(inheritedEntries, 4)).toBeUndefined();
    expect(copyOwnDataArray({ 0: "album-1", length: 1 }, 4)).toBeUndefined();
    expect(getterCalls).toBe(0);
  });
});

describe("control character detection", () => {
  it("flags C0 and C1 controls without treating astral-plane characters as controls", () => {
    expect(hasControlCharacter("soft\u0000focus")).toBe(true);
    expect(hasControlCharacter("soft\u007ffocus")).toBe(true);
    expect(hasControlCharacter("soft\u009ffocus")).toBe(true);
    expect(hasControlCharacter("soft focus")).toBe(false);
    expect(hasControlCharacter("😀")).toBe(false);
    expect(hasControlCharacter("😀\u0001")).toBe(true);
  });
});
