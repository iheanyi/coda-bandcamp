import { Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import { CoverArt } from "@/features/artwork/CoverArt";
import { ArtistTransitionName } from "@/features/navigation/ArtistTransitionName";
import { cn } from "@/lib/utils";
import { artistKey } from "@/libraryBrowse";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  validateCollectionSearch,
} from "@/routing/routeContracts";
import type { Album } from "@/types";
import { libraryArtistRouteSearch } from "./libraryLinkSearch";
import type { ArtistNavigationHandler } from "./types";

export type AlbumCardProps = {
  album: Album;
  onOpen: (album: Album, trigger: HTMLElement) => void;
  onPlay: (album: Album) => void;
  onQueue: (album: Album) => void;
  onArtist: ArtistNavigationHandler;
  active: boolean;
  loading: boolean;
  playing: boolean;
  onTogglePlayback: () => void;
  className?: string;
};

export const AlbumCard = memo(function AlbumCard({
  album,
  onOpen,
  onPlay,
  onQueue,
  onArtist,
  active,
  loading,
  playing,
  onTogglePlayback,
  className,
}: AlbumCardProps) {
  const albumId = parseAlbumIdParam(album.id);
  const albumArtistKey = parseArtistKeyParam(artistKey(album.artist));

  return (
    <article
      className={cn(
        "group relative min-w-0 [contain-intrinsic-size:170px_235px] [content-visibility:auto]",
        className,
      )}
      data-album-card={album.id}
    >
      <div className="relative block w-full">
        <CoverArt album={album} />
        <Link
          aria-busy={loading || undefined}
          aria-disabled={loading || undefined}
          aria-label={`Open ${album.title}`}
          className="absolute inset-0 z-1 w-full cursor-pointer rounded-md bg-transparent after:absolute after:inset-0 after:rounded-md after:bg-[rgba(8,9,10,0.2)] after:opacity-0 after:transition-opacity after:duration-(--duration-coda-fast) hover:after:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-60"
          data-album-open={album.id}
          data-navigation-slot="artwork"
          onClick={(event) => {
            if (loading) {
              event.preventDefault();
              return;
            }
            handleCodaLinkActivation(event, (trigger) =>
              onOpen(album, trigger),
            );
          }}
          params={{ albumId }}
          search={(previous) => validateCollectionSearch(previous)}
          to="/collection/albums/$albumId"
        />
        {loading ? (
          <span className="pointer-events-none absolute inset-0 z-3 grid place-items-center rounded-md bg-black/40">
            <Spinner
              aria-label={`Loading ${album.title}`}
              className="size-6 text-white"
            />
          </span>
        ) : null}
        <span
          className="absolute right-2 bottom-2 z-2 translate-y-1 opacity-0 transition-[opacity,transform] duration-(--duration-coda-fast) group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 data-current:translate-y-0 data-current:opacity-100"
          data-current={active || undefined}
        >
          <Button
            className={`size-10 rounded-full p-0 text-white shadow-[0_5px_15px_rgba(0,0,0,0.35)] ${
              active && playing
                ? "bg-[color-mix(in_srgb,var(--primary)_80%,#17191b)] shadow-[0_5px_15px_rgba(0,0,0,0.35),0_0_0_3px_rgba(221,101,73,0.16)]"
                : ""
            }`}
            onClick={active ? onTogglePlayback : () => onPlay(album)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${album.title}`
                : `Play ${album.title}`
            }
            aria-pressed={active && playing}
            size="icon"
            title={
              active ? (playing ? "Pause album" : "Resume album") : "Play album"
            }
            variant="primary"
          >
            <PlaybackIcon playing={active && playing} />
          </Button>
        </span>
      </div>
      <div className="flex min-w-0 flex-col pt-2.5 pr-8">
        <Link
          aria-busy={loading || undefined}
          aria-disabled={loading || undefined}
          className="w-full min-w-0 overflow-hidden text-left text-xs font-bold text-[#e5e3dd] outline-none hover:text-[#e5e3dd] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-60"
          data-album-open={album.id}
          data-navigation-slot="title"
          onClick={(event) => {
            if (loading) {
              event.preventDefault();
              return;
            }
            handleCodaLinkActivation(event, (trigger) =>
              onOpen(album, trigger),
            );
          }}
          params={{ albumId }}
          search={(previous) => validateCollectionSearch(previous)}
          to="/collection/albums/$albumId"
        >
          <span
            className="block min-w-0 max-w-full overflow-hidden"
            data-coda-album-title-target={album.id}
          >
            <OverflowMarquee className="w-full" text={album.title} />
          </span>
        </Link>
        <Link
          className="mt-1 w-full min-w-0 overflow-hidden text-left text-xs font-medium text-[#868984] outline-none hover:text-[#dc8973] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          data-artist-open={albumArtistKey}
          data-coda-artist-name-target={albumArtistKey}
          data-navigation-slot={`album-card-artist:${album.id}`}
          onClick={(event) =>
            handleCodaLinkActivation(event, (trigger) =>
              onArtist(album.artist, album.id, undefined, trigger),
            )
          }
          params={{ artistKey: albumArtistKey }}
          search={(previous) => libraryArtistRouteSearch(previous)}
          to="/collection/artists/$artistKey"
          title={`Browse ${album.artist}`}
        >
          <ArtistTransitionName artistKey={albumArtistKey} className="block">
            <OverflowMarquee className="w-full" text={album.artist} />
          </ArtistTransitionName>
        </Link>
      </div>
      <Button
        className="absolute right-0 bottom-0 items-end border-0 bg-transparent text-coda-subtle-foreground opacity-0 shadow-none group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-transparent hover:text-primary"
        onClick={() => onQueue(album)}
        size="icon-compact"
        title="Add album to queue"
        aria-label={`Add ${album.title} to queue`}
        variant="text"
      >
        <Plus size={17} />
      </Button>
    </article>
  );
});
