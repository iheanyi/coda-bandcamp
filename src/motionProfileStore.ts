import { useSyncExternalStore } from "react";
import type { MotionProfile } from "./motionProfile";
import {
  createMotionProfileStore,
  type MotionProfileStorage,
  type MotionProfileStore,
} from "./motionProfileStoreService";

export type { MotionProfileState } from "./motionProfileStoreService";

type MotionProfileHotData = {
  motionProfileStore?: MotionProfileStore;
};

type MotionProfileImportMeta = ImportMeta & {
  hot?: { data: MotionProfileHotData };
};

function safeStorage(): MotionProfileStorage | undefined {
  try {
    return globalThis.window?.localStorage;
  } catch {
    return undefined;
  }
}

// SAFETY: Vite adds this optional shape in development; production omits it.
const hotData = (import.meta as MotionProfileImportMeta).hot?.data;
const productionMotionProfileStore =
  hotData?.motionProfileStore ??
  createMotionProfileStore({ storage: safeStorage() });
if (hotData) hotData.motionProfileStore = productionMotionProfileStore;

export const subscribeMotionProfile = productionMotionProfileStore.subscribe;
export const getMotionProfileState = productionMotionProfileStore.getState;

export function useMotionProfileState() {
  return useSyncExternalStore(
    subscribeMotionProfile,
    getMotionProfileState,
    getMotionProfileState,
  );
}

export const getAllMotionPresets =
  productionMotionProfileStore.getAllPresets;
export const setMotionProfile: (profile: MotionProfile) => void =
  productionMotionProfileStore.setProfile;
export const updateMotionProfile =
  productionMotionProfileStore.updateProfile;
export const selectMotionPreset =
  productionMotionProfileStore.selectPreset;
export const saveMotionPreset = productionMotionProfileStore.savePreset;
export const renameMotionPreset = productionMotionProfileStore.renamePreset;
export const duplicateMotionPreset =
  productionMotionProfileStore.duplicatePreset;
export const resetMotionProfile = productionMotionProfileStore.resetProfile;
export const exportMotionProfile = productionMotionProfileStore.exportProfile;
export const importMotionProfile = productionMotionProfileStore.importProfile;
export const snapshotMotionProfile =
  productionMotionProfileStore.snapshotProfile;
