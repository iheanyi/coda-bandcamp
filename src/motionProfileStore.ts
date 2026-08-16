import { useSyncExternalStore } from "react";
import {
  BUILTIN_MOTION_PRESETS,
  cloneMotionProfile,
  CURRENT_MOTION_PROFILE,
  isPlainMotionObject,
  parseMotionWireString,
  resolveMotionProfile,
  type MotionPreset,
  type MotionProfile,
  type ResolvedMotionProfile,
  validateMotionProfile,
} from "./motionProfile";

const STORAGE_KEY = "coda.motion-lab.v1";
const MAX_CUSTOM_PRESETS = 24;
const MAX_PRESET_NAME_LENGTH = 48;

export type MotionProfileState = Readonly<{
  activePresetId: string | null;
  profile: MotionProfile;
  customPresets: readonly MotionPreset[];
}>;

const listeners = new Set<() => void>();

function boundedName(name: string, fallback = "Untitled") {
  const trimmed = name.trim().slice(0, MAX_PRESET_NAME_LENGTH);
  return trimmed || fallback;
}

function safeStorage() {
  return globalThis.window?.localStorage;
}

function readInitialState(): MotionProfileState {
  try {
    const serialized = safeStorage()?.getItem(STORAGE_KEY);
    if (!serialized) {
      return {
        activePresetId: "current",
        profile: cloneMotionProfile(CURRENT_MOTION_PROFILE),
        customPresets: [],
      };
    }
    const parsed: unknown = JSON.parse(serialized);
    const input = isPlainMotionObject(parsed) ? parsed : undefined;
    const customPresetCandidates =
      input && "customPresets" in input ? input.customPresets : undefined;
    const customPresets = Array.isArray(customPresetCandidates)
      ? customPresetCandidates
          .slice(0, MAX_CUSTOM_PRESETS)
          .flatMap((value, index): MotionPreset[] => {
            if (!isPlainMotionObject(value)) return [];
            const id = parseMotionWireString(
              "id" in value ? value.id : undefined,
            );
            const name = parseMotionWireString(
              "name" in value ? value.name : undefined,
            );
            const profile =
              "profile" in value
                ? validateMotionProfile(value.profile)
                : cloneMotionProfile(CURRENT_MOTION_PROFILE);
            return [
              {
                id: id ? id.slice(0, 80) : `imported-${index}`,
                name: boundedName(name ?? ""),
                builtin: false,
                profile,
              },
            ];
          })
      : [];
    const parsedActivePresetId = parseMotionWireString(
      input && "activePresetId" in input ? input.activePresetId : undefined,
    );
    const activePresetId =
      parsedActivePresetId === undefined
        ? null
        : parsedActivePresetId.slice(0, 80);
    const activeBuiltin = BUILTIN_MOTION_PRESETS.find(
      (preset) => preset.id === activePresetId,
    );
    const activeCustom = customPresets.find(
      (preset) => preset.id === activePresetId,
    );
    return {
      activePresetId: activeBuiltin?.id ?? activeCustom?.id ?? null,
      profile: cloneMotionProfile(
        activeBuiltin?.profile ??
          activeCustom?.profile ??
          validateMotionProfile(
            input && "profile" in input ? input.profile : undefined,
          ),
      ),
      customPresets,
    };
  } catch {
    try {
      safeStorage()?.removeItem(STORAGE_KEY);
    } catch {
      // Settings remain usable in-memory when storage is unavailable.
    }
    return {
      activePresetId: "current",
      profile: cloneMotionProfile(CURRENT_MOTION_PROFILE),
      customPresets: [],
    };
  }
}

let state = readInitialState();

function persist() {
  try {
    safeStorage()?.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activePresetId: state.activePresetId,
        profile: state.profile,
        customPresets: state.customPresets,
      }),
    );
  } catch {
    // A full or disabled localStorage must not make animation tuning unsafe.
  }
}

function publish(next: MotionProfileState) {
  state = next;
  persist();
  listeners.forEach((listener) => listener());
}

function uniquePresetName(name: string, excludedId?: string) {
  const base = boundedName(name);
  const existing = new Set(
    [...BUILTIN_MOTION_PRESETS, ...state.customPresets]
      .filter((preset) => preset.id !== excludedId)
      .map((preset) => preset.name.toLocaleLowerCase()),
  );
  if (!existing.has(base.toLocaleLowerCase())) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = boundedName(`${base} ${suffix}`);
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return boundedName(`${base} copy`);
}

function presetById(id: string) {
  return [...BUILTIN_MOTION_PRESETS, ...state.customPresets].find(
    (preset) => preset.id === id,
  );
}

export function subscribeMotionProfile(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMotionProfileState() {
  return state;
}

export function useMotionProfileState() {
  return useSyncExternalStore(
    subscribeMotionProfile,
    getMotionProfileState,
    getMotionProfileState,
  );
}

export function getAllMotionPresets() {
  return [...BUILTIN_MOTION_PRESETS, ...state.customPresets];
}

export function setMotionProfile(profile: MotionProfile) {
  publish({
    ...state,
    activePresetId: null,
    profile: validateMotionProfile(profile),
  });
}

export function updateMotionProfile(
  update: (profile: MotionProfile) => MotionProfile,
) {
  setMotionProfile(update(cloneMotionProfile(state.profile)));
}

export function selectMotionPreset(id: string) {
  const preset = presetById(id);
  if (!preset) return false;
  publish({
    ...state,
    activePresetId: preset.id,
    profile: cloneMotionProfile(preset.profile),
  });
  return true;
}

function newPresetId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function saveMotionPreset(name: string) {
  const preset: MotionPreset = {
    id: newPresetId(),
    name: uniquePresetName(name),
    builtin: false,
    profile: cloneMotionProfile(state.profile),
  };
  publish({
    ...state,
    activePresetId: preset.id,
    customPresets: [...state.customPresets, preset].slice(-MAX_CUSTOM_PRESETS),
  });
  return preset;
}

export function renameMotionPreset(id: string, name: string) {
  if (BUILTIN_MOTION_PRESETS.some((preset) => preset.id === id)) return false;
  let renamed = false;
  const customPresets = state.customPresets.map((preset) => {
    if (preset.id !== id) return preset;
    renamed = true;
    return { ...preset, name: uniquePresetName(name, id) };
  });
  if (renamed) publish({ ...state, customPresets });
  return renamed;
}

export function duplicateMotionPreset(id: string) {
  const preset = presetById(id);
  if (!preset) return undefined;
  const duplicate: MotionPreset = {
    id: newPresetId(),
    name: uniquePresetName(`${preset.name} Copy`),
    builtin: false,
    profile: cloneMotionProfile(preset.profile),
  };
  publish({
    profile: cloneMotionProfile(duplicate.profile),
    activePresetId: duplicate.id,
    customPresets: [...state.customPresets, duplicate].slice(
      -MAX_CUSTOM_PRESETS,
    ),
  });
  return duplicate;
}

export function resetMotionProfile() {
  selectMotionPreset("current");
}

export function exportMotionProfile() {
  return JSON.stringify(
    { version: 1, type: "coda-motion-profile", profile: state.profile },
    null,
    2,
  );
}

export function importMotionProfile(serialized: string) {
  const parsed: unknown = JSON.parse(serialized);
  const input =
    isPlainMotionObject(parsed) && "profile" in parsed
      ? parsed.profile
      : parsed;
  if (
    !isPlainMotionObject(input) ||
    !("version" in input) ||
    input.version !== 1
  ) {
    throw new Error("Invalid Coda Motion profile");
  }
  const profile = validateMotionProfile(input);
  setMotionProfile(profile);
  return profile;
}

export function snapshotMotionProfile(): ResolvedMotionProfile {
  return resolveMotionProfile(cloneMotionProfile(state.profile));
}

export function resetMotionProfileStoreForTests() {
  state = readInitialState();
  listeners.forEach((listener) => listener());
}
