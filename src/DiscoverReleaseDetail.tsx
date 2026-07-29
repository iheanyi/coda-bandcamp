import {
  ArrowLeft,
  ArrowUpRight,
  MapPin,
  Plus,
} from "lucide-react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { PlaybackIcon } from "./components/ui/playback-icon";
import { discoverPreviewTrack } from "./discover";
import { formatTime, initials, paletteFor } from "./lib";
import type { DiscoverRelease, Track } from "./types";

export function DiscoverReleaseDetail({
  release,
  currentTrackId,
  playing,
  onBack,
  onPlay,
  onQueue,
  onTogglePlayback,
  onArtist,
  onOpenBandcamp,
}: {
  release: DiscoverRelease;
  currentTrackId?: string;
  playing: boolean;
  onBack: () => void;
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onTogglePlayback: () => void;
  onArtist: (release: DiscoverRelease) => void;
  onOpenBandcamp: (url: string) => void;
}) {
  const track = discoverPreviewTrack(release);
  const active = Boolean(track && currentTrackId === track.id);
  const palette = paletteFor(release.id);

  return (
    <article
      className="mx-auto -mt-2 mb-8 w-full max-w-4xl animate-[album-page-in_180ms_ease-out] motion-reduce:animate-none"
      aria-label={`${release.title} Discover release details`}
    >
      <Button
        className="mb-4 -ml-1 h-auto gap-1.5 p-1 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={onBack}
        size="compact"
        variant="text"
      >
        <ArrowLeft size={15} />
        Back
      </Button>
      <header className="flex items-end gap-8 overflow-hidden rounded-t-xl border border-border bg-[radial-gradient(circle_at_82%_20%,rgba(221,101,73,0.13),transparent_37%),linear-gradient(135deg,#24282a,#191c1e_70%)] p-8 max-xl:items-center max-xl:gap-6 max-xl:p-6">
        <div
          className="grid size-56 shrink-0 place-items-center overflow-hidden rounded-xl bg-[linear-gradient(145deg,var(--cover-accent),transparent_72%),var(--cover-base)] text-4xl font-bold text-white/80 shadow-2xl max-xl:size-48"
          style={
            {
              "--cover-accent": palette[0],
              "--cover-base": palette[1],
            } as React.CSSProperties
          }
        >
          {release.artworkUrl ? (
            <img
              className="size-full object-cover"
              src={release.artworkUrl}
              alt=""
              draggable={false}
            />
          ) : (
            <span>{initials(release.title)}</span>
          )}
        </div>
        <div className="min-w-0 pb-1">
          <Badge variant="artwork" className="mb-3">Discover release</Badge>
          <h1 className="m-0 max-w-xl wrap-anywhere font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-4xl leading-none font-semibold tracking-tighter text-foreground max-xl:text-3xl">
            {release.title}
          </h1>
          <Button
            className="my-3 h-auto max-w-full justify-start truncate p-0 text-sm font-semibold text-primary hover:bg-transparent hover:text-primary hover:underline"
            onClick={() => onArtist(release)}
            size="compact"
            variant="text"
          >
            {release.artist}
          </Button>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {release.genre ? <span>{release.genre}</span> : null}
            {release.genre && release.location ? <span aria-hidden="true">·</span> : null}
            {release.location ? (
              <span className="inline-flex items-center gap-1">
                <MapPin size={13} />
                {release.location}
              </span>
            ) : null}
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {track ? (
              <>
                <Button
                  onClick={active ? onTogglePlayback : () => onPlay(track)}
                  aria-label={
                    active
                      ? `${playing ? "Pause" : "Resume"} ${track.title}`
                      : `Play ${track.title}`
                  }
                  aria-pressed={active && playing}
                  variant="primary"
                >
                  <PlaybackIcon playing={active && playing} />
                  {active ? (playing ? "Pause" : "Resume") : "Play preview"}
                </Button>
                <Button onClick={() => onQueue(track)}>
                  <Plus size={17} />
                  Add to queue
                </Button>
              </>
            ) : null}
            <Button onClick={() => onOpenBandcamp(release.itemUrl)}>
              <ArrowUpRight size={16} />
              Open on Bandcamp
            </Button>
          </div>
        </div>
      </header>
      <section className="rounded-b-xl border border-t-0 border-border bg-coda-field p-6">
        <div className="text-xs font-bold tracking-widest text-muted-foreground uppercase">
          Featured preview
        </div>
        {track ? (
          <div className="mt-3 flex h-14 items-center gap-4 rounded-md border border-border bg-white/2 px-4">
            <Button
              className={active ? "size-9 rounded-full bg-primary/10 text-primary" : "size-9 rounded-full"}
              onClick={active ? onTogglePlayback : () => onPlay(track)}
              aria-label={
                active
                  ? `${playing ? "Pause" : "Resume"} ${track.title}`
                  : `Play ${track.title}`
              }
              aria-pressed={active && playing}
              size="icon"
              variant="ghost"
            >
              <PlaybackIcon playing={active && playing} />
            </Button>
            <div className="min-w-0 flex-1 text-sm text-foreground">
              <strong className="block truncate">{track.title}</strong>
              <div className="truncate text-xs text-muted-foreground">{release.artist}</div>
            </div>
            <div className="text-xs tabular-nums text-muted-foreground">
              {formatTime(track.duration)}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            This release does not currently include a playable preview.
          </p>
        )}
      </section>
    </article>
  );
}
