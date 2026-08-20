import { parseVerifiedBandcampPageUrl } from "../bandcampUrl";

export const isDesktop = () => "__TAURI_INTERNALS__" in window;

export const isWindowsDesktop = () =>
  isDesktop() && navigator.userAgent.includes("Windows");

export function requireDesktop(feature: string): void {
  if (!isDesktop()) {
    throw new Error(`${feature} is available in the Coda desktop app.`);
  }
}

export async function openBandcampUrl(value: string): Promise<void> {
  const url = parseVerifiedBandcampPageUrl(value);
  if (!url) {
    throw new Error("Coda only opens verified Bandcamp links.");
  }
  if (isDesktop()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url.toString());
  } else {
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }
}
