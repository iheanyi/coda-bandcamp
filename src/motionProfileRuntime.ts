import {
  cloneMotionProfile,
  CURRENT_MOTION_PROFILE,
  resolveMotionProfile,
  type MotionProfile,
  type ResolvedMotionProfile,
} from "./motionProfile";

const listeners = new Set<() => void>();
let profile = cloneMotionProfile(CURRENT_MOTION_PROFILE);

export function subscribeMotionProfileRuntime(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMotionProfileRuntime(): MotionProfile {
  return profile;
}

export function setMotionProfileRuntime(next: MotionProfile) {
  profile = cloneMotionProfile(next);
  listeners.forEach((listener) => listener());
}

export function snapshotMotionProfile(): ResolvedMotionProfile {
  return resolveMotionProfile(cloneMotionProfile(profile));
}

export function resetMotionProfileRuntimeForTests() {
  setMotionProfileRuntime(CURRENT_MOTION_PROFILE);
}
