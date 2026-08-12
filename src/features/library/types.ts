import type { Track } from "@/types";

export type ArtistNavigationHandler = (
  artist: string,
  albumId?: string,
  sourceTrack?: Track,
  sourceTrigger?: HTMLElement,
) => void;
