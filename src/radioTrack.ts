import { paletteFor } from "@/lib";
import { BANDCAMP_RADIO_PROVIDER, radioShowIdentity } from "@/radioIdentity";
import { boundRadioChapters } from "@/radioPlayback";
import type { RadioShow, Track } from "@/types";

export function radioTrackFromShow(show: RadioShow): Track {
  const identity = radioShowIdentity(show);
  return {
    id: `radio:${show.id}`,
    title: identity.episodeTitle,
    artist: BANDCAMP_RADIO_PROVIDER,
    album: identity.seriesTitle ?? BANDCAMP_RADIO_PROVIDER,
    albumId: `radio:${show.id}`,
    duration: show.duration,
    track: 1,
    artworkUrl: show.artworkUrl,
    streamUrl: show.streamUrl,
    radioChapters: boundRadioChapters(show.chapters),
    palette: paletteFor(`radio:${show.id}`),
  };
}
