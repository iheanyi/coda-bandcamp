export function updaterEnabledForFlag(
  updaterFlag: string | undefined,
): boolean {
  return updaterFlag === "1";
}

export function isAppUpdaterEnabled(): boolean {
  return updaterEnabledForFlag(import.meta.env.VITE_CODA_UPDATER_ENABLED);
}
