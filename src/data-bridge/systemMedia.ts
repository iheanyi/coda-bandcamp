import { isWindowsDesktop } from "./desktop";
import { decodeNativeVoid, invokeNative } from "./native";

export type SystemMediaMetadataInput = {
  title: string;
  artist: string;
  album: string;
  artwork?:
    { kind: "cover"; coverArtId: string } | { kind: "remote"; url: string };
  canPrevious: boolean;
  canNext: boolean;
};

export type SystemMediaControlEvent = {
  action: "play" | "pause" | "previous" | "next" | "seek";
  positionSeconds?: number;
};

export async function updateSystemMediaMetadata(
  input?: SystemMediaMetadataInput,
): Promise<void> {
  if (!isWindowsDesktop()) return;
  decodeNativeVoid(
    await invokeNative("update_system_media_metadata", { input }),
    "update_system_media_metadata",
  );
}

export async function updateSystemMediaPlayback(
  playing: boolean,
): Promise<void> {
  if (!isWindowsDesktop()) return;
  decodeNativeVoid(
    await invokeNative("update_system_media_playback", { playing }),
    "update_system_media_playback",
  );
}

export async function updateSystemMediaTimeline(
  positionSeconds: number,
  durationSeconds: number,
): Promise<void> {
  if (!isWindowsDesktop()) return;
  decodeNativeVoid(
    await invokeNative("update_system_media_timeline", {
      positionSeconds,
      durationSeconds,
    }),
    "update_system_media_timeline",
  );
}
