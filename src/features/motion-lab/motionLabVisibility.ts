const MOTION_LAB_VISIBILITY_KEY = "coda.motion-lab.open.v1";

export function readMotionLabOpen(): boolean {
  try {
    return window.localStorage.getItem(MOTION_LAB_VISIBILITY_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeMotionLabOpen(open: boolean): void {
  try {
    window.localStorage.setItem(MOTION_LAB_VISIBILITY_KEY, String(open));
  } catch {
    // The shortcut remains usable when local storage is unavailable.
  }
}
