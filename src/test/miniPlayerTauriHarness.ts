import type { InvokeArgs } from "@tauri-apps/api/core";
import {
  isNumberValue,
  isOwnDataRecord,
  isStringValue,
  type OwnDataRecord,
  type OwnDataValue,
} from "../ownData";

/**
 * Payload a test pushes through the fake IPC seam: a JSON-safe wire value, or
 * a deliberately hostile tagged object regression tests use to prove renderer
 * parsers reject spoofed structured-clone payloads.
 */
export type MiniPlayerTauriTestPayload =
  | OwnDataValue
  | Readonly<{ [Symbol.toStringTag]: string }>;

type MiniPlayerTauriEventMessage = Readonly<{
  event: string;
  id: number;
  payload: MiniPlayerTauriTestPayload;
}>;

type TauriCallback = (message: MiniPlayerTauriEventMessage) => void;

type MiniPlayerTauriTarget = Readonly<{
  kind: string;
  label?: string;
}>;

export type MiniPlayerTauriEmission = Readonly<{
  target: MiniPlayerTauriTarget;
  event: string;
  payload: OwnDataValue;
}>;

export type MiniPlayerTauriHarness = Readonly<{
  emissions: readonly MiniPlayerTauriEmission[];
  hiddenWindowLabels: readonly string[];
  install: () => void;
  uninstall: () => void;
  dispatch: (event: string, payload: MiniPlayerTauriTestPayload) => void;
  emittedPayloads: (event: string, targetLabel: string) => OwnDataValue[];
  listenerCount: (event: string) => number;
  unlistenCount: (event: string) => number;
}>;

function invokeRecord(args: InvokeArgs | undefined): OwnDataRecord {
  return isOwnDataRecord(args) ? args : {};
}

function requiredString(value: OwnDataValue, name: string): string {
  if (!isStringValue(value)) {
    throw new TypeError(`Invalid Tauri ${name}`);
  }
  return value;
}

function requiredInteger(value: OwnDataValue, name: string): number {
  if (!isNumberValue(value) || !Number.isSafeInteger(value)) {
    throw new TypeError(`Invalid Tauri ${name}`);
  }
  return value;
}

function eventTarget(value: OwnDataValue): MiniPlayerTauriTarget {
  if (!isOwnDataRecord(value)) {
    throw new TypeError("Invalid Tauri event target");
  }
  const kind = requiredString(value.kind, "event target kind");
  const label =
    value.label === undefined
      ? undefined
      : requiredString(value.label, "event target label");
  return label === undefined ? { kind } : { kind, label };
}

function restoreProperty(
  key: "__TAURI_INTERNALS__" | "__TAURI_EVENT_PLUGIN_INTERNALS__",
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(window, key, descriptor);
    return;
  }
  Reflect.deleteProperty(window, key);
}

export function createMiniPlayerTauriHarness(
  currentWindowLabel: "main" | "mini-player",
): MiniPlayerTauriHarness {
  const callbacks = new Map<number, TauriCallback>();
  const emissions: MiniPlayerTauriEmission[] = [];
  const hiddenWindowLabels: string[] = [];
  const listeners = new Map<string, Set<number>>();
  const unlistened = new Map<string, number>();
  let installed = false;
  let nextCallbackId = 1;
  let previousEventInternals: PropertyDescriptor | undefined;
  let previousInternals: PropertyDescriptor | undefined;

  const removeListener = (event: string, callbackId: number): void => {
    const eventListeners = listeners.get(event);
    eventListeners?.delete(callbackId);
    if (eventListeners?.size === 0) listeners.delete(event);
    callbacks.delete(callbackId);
  };

  const invoke = async (
    command: string,
    args?: InvokeArgs,
  ): Promise<OwnDataValue> => {
    const record = invokeRecord(args);
    switch (command) {
      case "plugin:event|listen": {
        const event = requiredString(record.event, "event name");
        const callbackId = requiredInteger(record.handler, "event handler");
        const eventListeners = listeners.get(event) ?? new Set<number>();
        eventListeners.add(callbackId);
        listeners.set(event, eventListeners);
        return callbackId;
      }
      case "plugin:event|unlisten": {
        const event = requiredString(record.event, "event name");
        const callbackId = requiredInteger(record.eventId, "event id");
        removeListener(event, callbackId);
        unlistened.set(event, (unlistened.get(event) ?? 0) + 1);
        return undefined;
      }
      case "plugin:event|emit_to": {
        emissions.push({
          target: eventTarget(record.target),
          event: requiredString(record.event, "event name"),
          payload: record.payload,
        });
        return undefined;
      }
      case "plugin:window|hide": {
        hiddenWindowLabels.push(
          requiredString(record.label, "window label"),
        );
        return undefined;
      }
      default:
        throw new Error(`Unexpected mini-player Tauri command: ${command}`);
    }
  };

  const install = (): void => {
    if (installed) return;
    installed = true;
    previousInternals = Object.getOwnPropertyDescriptor(
      window,
      "__TAURI_INTERNALS__",
    );
    previousEventInternals = Object.getOwnPropertyDescriptor(
      window,
      "__TAURI_EVENT_PLUGIN_INTERNALS__",
    );
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        convertFileSrc: (path: string, protocol: string) =>
          `${protocol}://localhost/${encodeURIComponent(path)}`,
        invoke,
        metadata: {
          currentWindow: { label: currentWindowLabel },
          currentWebview: {
            label: currentWindowLabel,
            windowLabel: currentWindowLabel,
          },
        },
        runCallback: (
          callbackId: number,
          message: MiniPlayerTauriEventMessage,
        ) => {
          callbacks.get(callbackId)?.(message);
        },
        transformCallback: (callback: TauriCallback) => {
          const callbackId = nextCallbackId++;
          callbacks.set(callbackId, callback);
          return callbackId;
        },
        unregisterCallback: (callbackId: number) => {
          callbacks.delete(callbackId);
        },
      },
    });
    Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
      configurable: true,
      value: {
        unregisterListener: removeListener,
      },
    });
  };

  const uninstall = (): void => {
    if (!installed) return;
    installed = false;
    callbacks.clear();
    listeners.clear();
    restoreProperty("__TAURI_INTERNALS__", previousInternals);
    restoreProperty(
      "__TAURI_EVENT_PLUGIN_INTERNALS__",
      previousEventInternals,
    );
  };

  const dispatch = (
    event: string,
    payload: MiniPlayerTauriTestPayload,
  ): void => {
    const callbackIds = [...(listeners.get(event) ?? [])];
    for (const callbackId of callbackIds) {
      callbacks.get(callbackId)?.({
        event,
        id: callbackId,
        payload,
      });
    }
  };

  const emittedPayloads = (
    event: string,
    targetLabel: string,
  ): OwnDataValue[] =>
    emissions
      .filter(
        (emission) =>
          emission.event === event && emission.target.label === targetLabel,
      )
      .map((emission) => emission.payload);

  return Object.freeze({
    emissions,
    hiddenWindowLabels,
    install,
    uninstall,
    dispatch,
    emittedPayloads,
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    unlistenCount: (event: string) => unlistened.get(event) ?? 0,
  });
}
