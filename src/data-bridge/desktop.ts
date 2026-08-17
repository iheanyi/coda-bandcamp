export const isDesktop = () => "__TAURI_INTERNALS__" in window;

export const isWindowsDesktop = () =>
  isDesktop() && navigator.userAgent.includes("Windows");
