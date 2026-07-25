export type AirPlayAudioElement = HTMLAudioElement & {
  webkitCurrentPlaybackTargetIsWireless?: boolean;
  webkitShowPlaybackTargetPicker: () => void;
};

export function supportsAirPlayPicker(
  media: HTMLAudioElement | null,
): media is AirPlayAudioElement {
  return Boolean(
    media &&
      typeof (media as AirPlayAudioElement).webkitShowPlaybackTargetPicker ===
        "function",
  );
}

export function showAirPlayPicker(media: HTMLAudioElement | null): boolean {
  if (!supportsAirPlayPicker(media)) return false;
  media.webkitShowPlaybackTargetPicker();
  return true;
}
