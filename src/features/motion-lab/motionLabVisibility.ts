const MOTION_LAB_VISIBILITY_KEY = "coda.motion-lab.open.v1";
const motionLabAvailable = import.meta.env.MODE !== "production";

export function readMotionLabOpen(): boolean {
  if (!motionLabAvailable) return false;
  try {
    return window.localStorage.getItem(MOTION_LAB_VISIBILITY_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeMotionLabOpen(open: boolean): void {
  if (!motionLabAvailable) return;
  try {
    window.localStorage.setItem(MOTION_LAB_VISIBILITY_KEY, String(open));
  } catch {
    // The shortcut remains usable when local storage is unavailable.
  }
}
