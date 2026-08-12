import { ArrowLeft, ListPlus, Shuffle } from "lucide-react";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { CoverArt } from "@/features/artwork/CoverArt";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import type { ArtistGroup } from "@/libraryBrowse";

export type ArtistHeroProps = {
  group: ArtistGroup;
  loading?: "play" | "shuffle" | "queue";
  onBack: () => void;
  onPlay: (group: ArtistGroup) => void;
  onShuffle: (group: ArtistGroup) => void;
  onQueue: (group: ArtistGroup) => void;
  active: boolean;
  playing: boolean;
  onTogglePlayback: () => void;
  className?: string;
};

export const ArtistHero = memo(function ArtistHero({
  group,
  loading,
  onBack,
  onPlay,
  onShuffle,
  onQueue,
  active,
  playing,
  onTogglePlayback,
  className,
}: ArtistHeroProps) {
  return (
    <section
      className={cn(
        "relative -mt-2 mb-6 grid grid-cols-[7.5rem_minmax(0,1fr)] items-end gap-4 overflow-hidden rounded-lg border border-border bg-[radial-gradient(circle_at_88%_20%,rgba(221,101,73,0.13),transparent_38%),linear-gradient(135deg,#202426,#171a1c_72%)] p-4 select-none *:data-[slot=cover]:size-30 *:data-[slot=cover]:rounded-lg xl:grid-cols-[9.5rem_minmax(0,1fr)] xl:gap-6 xl:p-5 xl:*:data-[slot=cover]:size-38",
        className,
      )}
      data-coda-artist-detail-surface=""
    >
      <CoverArt
        album={group.representative}
        size="large"
        artistArtworkDetail={group.key}
      />
      <div className="relative z-1 min-w-0" data-coda-artist-metadata-detail="">
        <Button
          className="mb-3 -ml-1 h-auto gap-1 p-1 text-xs text-[#8b8f89] hover:bg-transparent hover:text-[#f0eee8] xl:mb-4"
          onClick={onBack}
          size="compact"
          variant="text"
        >
          <ArrowLeft size={14} />
          Back
        </Button>
        <span className="mb-2.5 block text-xs font-bold tracking-widest text-coda-subtle-foreground uppercase">
          Artist
        </span>
        <h2
          id="artist-detail-heading"
          className="mt-1 mb-2 truncate font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-2xl leading-none font-semibold tracking-tighter text-[#f2f0e9] outline-none xl:text-3xl"
          tabIndex={-1}
        >
          <span
            className="inline-block max-w-full truncate align-top"
            data-coda-artist-name-detail={group.key}
          >
            {group.name}
          </span>
        </h2>
        <p className="m-0 text-xs text-[#858983]">
          {countLabel(group.releaseCount, "release")}
          {" · "}
          {countLabel(group.trackCount, "track")}
          {" · "}
          {formatTime(group.duration)}
        </p>
        <div className="mt-3.5 flex gap-2 xl:mt-5">
          <Button
            className={`${active ? "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18),0_8px_24px_rgba(221,101,73,0.16)]" : ""} ${active && playing ? "bg-[color-mix(in_srgb,var(--primary)_82%,#17191b)]" : ""}`}
            onClick={active ? onTogglePlayback : () => onPlay(group)}
            disabled={Boolean(loading)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${group.name}`
                : "Play all"
            }
            aria-pressed={active && playing}
            variant="primary"
          >
            {loading === "play" ? (
              <Spinner aria-hidden="true" className="size-4 text-current" />
            ) : (
              <PlaybackIcon className="size-4" playing={active && playing} />
            )}
            {loading === "play"
              ? "Loading…"
              : active
                ? playing
                  ? "Pause"
                  : "Resume"
                : "Play all"}
          </Button>
          <Button onClick={() => onShuffle(group)} disabled={Boolean(loading)}>
            {loading === "shuffle" ? (
              <Spinner aria-hidden="true" className="size-4" />
            ) : (
              <Shuffle size={16} />
            )}
            {loading === "shuffle" ? "Shuffling…" : "Shuffle"}
          </Button>
          <Button onClick={() => onQueue(group)} disabled={Boolean(loading)}>
            {loading === "queue" ? (
              <Spinner aria-hidden="true" className="size-4" />
            ) : (
              <ListPlus size={16} />
            )}
            {loading === "queue" ? "Adding…" : "Add all"}
          </Button>
        </div>
      </div>
    </section>
  );
});
